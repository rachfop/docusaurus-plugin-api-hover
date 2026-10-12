/**
 * Python language module for the annotator: snippet-aware resolution of
 * identifiers against the API index.
 *
 * The parse functions read a whole code snippet and extract binding
 * structure (imports, inferred local types, bound names) so each identifier
 * token can be resolved with real context: `from pathlib import Path`
 * makes bare `Path` mean `pathlib.Path`, and `config = Path("app.toml")`
 * makes `config.name` mean `pathlib.PurePath.name`.
 */

/** Does this language tag mean Python? Doctest (`pycon`) included. */
export function isPythonLanguage(language: string | undefined): boolean {
  return !!language && /^(py3?|python3?|pycon|ipython3?)$/i.test(language);
}

/**
 * Character offsets of comment and string regions in a snippet, as
 * [start, end) pairs. The build-time annotator skips comment and string
 * tokens prism types for it; the DOM annotator has no token types to read
 * (Shiki colors spans inline), so it asks this scanner instead. Line
 * based, like the binding parsers: a comment runs from `#` to end of
 * line, single-quoted strings are matched to their closing quote on the
 * same line, and triple-quoted strings may span lines.
 */
export function pythonSkipRegions(code: string): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  let offset = 0;
  let triple: string | null = null;
  for (const line of code.split('\n')) {
    let i = 0;
    if (triple) {
      const end = line.indexOf(triple);
      if (end === -1) {
        regions.push([offset, offset + line.length]);
        offset += line.length + 1;
        continue;
      }
      regions.push([offset, offset + end + 3]);
      i = end + 3;
      triple = null;
    }
    while (i < line.length) {
      const ch = line[i]!;
      if (ch === '#') {
        regions.push([offset + i, offset + line.length]);
        break;
      }
      if (ch === '"' || ch === "'") {
        if (line.startsWith(ch.repeat(3), i)) {
          const end = line.indexOf(ch.repeat(3), i + 3);
          if (end === -1) {
            regions.push([offset + i, offset + line.length]);
            triple = ch.repeat(3);
            i = line.length;
            break;
          }
          regions.push([offset + i, offset + end + 3]);
          i = end + 3;
          continue;
        }
        let j = i + 1;
        while (j < line.length) {
          if (line[j] === '\\') {
            j += 2;
            continue;
          }
          if (line[j] === ch) break;
          j++;
        }
        const end = Math.min(j, line.length - 1);
        regions.push([offset + i, offset + end + 1]);
        i = end + 1;
        continue;
      }
      i++;
    }
    offset += line.length + 1;
  }
  return regions;
}

/**
 * The snippet as logical lines: comment and string regions blanked to
 * spaces (so their contents never parse as bindings), and physical lines
 * joined while brackets are open or a line ends in a backslash. Lets the
 * line-based parsers below see `from m import (\n    A,\n    B,\n)` and
 * a `def` whose parameters span several lines as one statement.
 */
function logicalLines(code: string): string[] {
  // Doctest prompts (`>>> `, `... `) are blanked so the statements behind
  // them parse like plain source.
  const chars = code.replace(/^(>>>|\.\.\.)( |$)/gm, (m) => ' '.repeat(m.length)).split('');
  for (const [start, end] of pythonSkipRegions(code)) {
    for (let k = start; k < end; k++) if (chars[k] !== '\n') chars[k] = ' ';
  }
  const lines: string[] = [];
  let buffer: string | undefined;
  let depth = 0;
  for (const raw of chars.join('').split('\n')) {
    // A statement at column 0 can't continue an open bracket in real
    // code, so an unclosed bracket (a truncated snippet) closes here and the
    // rest of the block parses on its own.
    if (buffer !== undefined && depth > 0 && /^[^\s)\]}]/.test(raw)) {
      lines.push(buffer);
      buffer = undefined;
      depth = 0;
    }
    const continued = /\\\s*$/.test(raw);
    const line = continued ? raw.replace(/\\\s*$/, '') : raw;
    for (const ch of line) {
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    }
    buffer = buffer === undefined ? line : `${buffer} ${line.trim()}`;
    if (depth === 0 && !continued) {
      lines.push(buffer);
      buffer = undefined;
    }
  }
  if (buffer !== undefined) lines.push(buffer);
  return lines;
}

/** Local-name -> dotted path, built from a snippet's import statements. */
export function parsePythonImports(code: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const line of logicalLines(code)) {
    const fromMatch = line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s+(.+?)\s*(?:#.*)?$/);
    if (fromMatch) {
      const mod = fromMatch[1]!;
      for (const raw of fromMatch[2]!.replace(/[()]/g, ' ').split(',')) {
        const item = raw.trim();
        if (!item) continue;
        const asMatch = item.match(/^([A-Za-z_]\w*)\s+as\s+([A-Za-z_]\w*)$/);
        if (asMatch) {
          aliases[asMatch[2]] = `${mod}.${asMatch[1]}`;
        } else if (/^[A-Za-z_]\w*$/.test(item)) {
          aliases[item] = `${mod}.${item}`;
        }
      }
      continue;
    }
    const importAs = line.match(/^\s*import\s+([A-Za-z_][\w.]*)\s+as\s+([A-Za-z_]\w*)\s*(?:#.*)?$/);
    if (importAs) {
      aliases[importAs[2]] = importAs[1];
    }
  }
  return aliases;
}

/**
 * Local-name -> documented class id, inferred from constructor-call
 * bindings in the snippet: `device = driver.Accelerator()` and
 * `with Graph() as graph:` both give the local a class type. Names that
 * collide with an import alias or a known symbol are skipped so they keep
 * their API meaning.
 */
export function parsePythonLocals(
  code: string,
  aliases: Record<string, string>,
  resolveCall: (name: string) => string | undefined,
  idSet: Set<string>,
): Record<string, string> {
  const locals: Record<string, string> = {};
  for (const line of logicalLines(code)) {
    let varName: string | undefined;
    let call: string | undefined;
    const assign = line.match(/^\s*([A-Za-z_]\w*)\s*(?::[^=]+)?=\s*([A-Za-z_][\w.]*)\s*\(/);
    if (assign) {
      varName = assign[1]!;
      call = assign[2]!;
    } else {
      const withAs = line.match(
        /^\s*(?:async\s+)?with\s+([A-Za-z_][\w.]*)\s*\(.*\)\s*as\s+([A-Za-z_]\w*)\s*:/,
      );
      if (withAs) {
        call = withAs[1]!;
        varName = withAs[2]!;
      }
    }
    if (!varName || !call) continue;
    if (aliases[varName] || idSet.has(varName)) continue;
    const typeId = resolveCall(call);
    if (typeId) locals[varName] = typeId;
  }
  return locals;
}

/**
 * Names bound anywhere in the snippet: assignment targets, `with`/`except`
 * `as` targets, `for` targets, and function parameters. These are the
 * snippet's own variables, so the bare-name fallback must never annotate
 * them as an API symbol on a short-name match alone (`graph` would
 * otherwise resolve to an unrelated same-named property).
 * Import aliases also appear here (`import x as y`), but the resolver
 * checks aliases first, so they keep their API meaning.
 */
export function parsePythonBinds(code: string): Set<string> {
  const binds = new Set<string>();
  const addNames = (text: string) => {
    for (const m of text.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
      binds.add(m[1]!);
    }
  };
  for (const line of logicalLines(code)) {
    const assign = line.match(/^\s*((?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/);
    if (assign) {
      addNames(assign[1]!);
      continue;
    }
    const forTarget = line.match(/^\s*(?:async\s+)?for\s+([^:]+?)\s+in\s/);
    if (forTarget) {
      addNames(forTarget[1]!.replace(/\(|\)|,/g, ' '));
      continue;
    }
    const params = line.match(/^\s*(?:async\s+)?def\s+\w+\s*\(([^)]*)\)/);
    if (params) {
      for (const param of params[1]!.split(',')) {
        const name = param
          .trim()
          .replace(/^\*{1,2}/, '')
          .match(/^([A-Za-z_]\w*)\s*[:=]|^([A-Za-z_]\w*)$/);
        if (name) binds.add(name[1] ?? name[2]!);
      }
      continue;
    }
    for (const m of line.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) {
      binds.add(m[1]!);
    }
  }
  return binds;
}
