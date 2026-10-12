/**
 * The resolution engine: resolve identifier occurrences in code and prose
 * against an API symbol index. Pure functions over a `SymbolIndex`; every
 * adapter shares them (Docusaurus theme components and rehype pass at
 * build time, the browser annotator on every other site).
 *
 * Mirrors Verso's approach for Lean docs: every known API identifier
 * rendered in a code block gets a stable id, which the hover runtime uses
 * to highlight all instances on the page and show an IDE-style
 * signature/docstring tooltip.
 *
 * Language-agnostic: the per-language binding structure (imports, inferred
 * locals, bound names) comes from pluggable language modules (see
 * python.ts). Python is built in.
 */
import {
  isPythonLanguage,
  parsePythonBinds,
  parsePythonImports,
  parsePythonLocals,
  pythonSkipRegions,
} from './python';

/**
 * The resolution index built from the names JSON. Every resolver takes
 * one; build it with `buildIndex`.
 */
export interface SymbolIndex {
  /** All ids, in index order; the prose resolver scans them for suffixes. */
  ids: string[];
  /** Full dotted ids, e.g. "pathlib.Path". */
  idSet: Set<string>;
  /** Final segment -> ids ending with it. */
  shortMap: Map<string, string[]>;
  /**
   * Dotted suffix (two or more segments) -> the one id ending with it, or
   * `null` when several ids share the suffix. Built on the first prose
   * lookup: code annotation never needs it.
   */
  suffixes?: Map<string, string | null>;
  /** Parent id -> (member name -> defining id), for documented parents only. */
  members: Map<string, Map<string, string>>;
  /** Class id -> direct documented base class ids. */
  bases: Map<string, string[]>;
  /** Memo for inherited-member lookups. */
  memberMemo: Map<string, string | undefined>;
  /**
   * Id prefixes that win a short-name collision (e.g. "mypkg." for a site
   * that indexes its own package and Python stdlib ids), so extra id
   * sources can never change an existing annotation.
   */
  preferPrefixes: string[];
}

/** One prism token on a rendered code line, as theme-classic passes it. */
export interface PrismToken {
  /** Prism token types; comment and string tokens are never annotated. */
  types: string[] | string;
  /** The token's source text. */
  content: string;
  /** Set by annotateLines when the token resolves to an API symbol. */
  apiId?: string;
  [key: string]: unknown;
}

/**
 * Builds the resolution index from the names JSON's fields.
 *
 * @param ids Every documented symbol id, as full dotted names.
 * @param basesRecord Class id to its direct documented base class ids,
 *   for inherited-member lookups.
 * @param preferPrefixes Id prefixes that win a short-name collision.
 * @returns The index every resolver takes.
 */
export function buildIndex(
  ids: string[],
  basesRecord: Record<string, string[]> = {},
  preferPrefixes: string[] = [],
): SymbolIndex {
  const idSet = new Set(ids);
  const shortMap = new Map<string, string[]>();
  const members = new Map<string, Map<string, string>>();
  for (const id of ids) {
    const last = id.split('.').pop()!;
    const bucket = shortMap.get(last);
    if (bucket) bucket.push(id);
    else shortMap.set(last, [id]);

    // Own member: "pathlib.PurePath.name" under parent "pathlib.PurePath",
    // only when the parent is itself documented.
    const dot = id.lastIndexOf('.');
    if (dot > 0) {
      const parent = id.slice(0, dot);
      if (idSet.has(parent)) {
        let byName = members.get(parent);
        if (!byName) {
          byName = new Map();
          members.set(parent, byName);
        }
        byName.set(id.slice(dot + 1), id);
      }
    }
  }
  const bases = new Map(Object.entries(basesRecord));
  return {
    ids,
    idSet,
    shortMap,
    members,
    bases,
    memberMemo: new Map(),
    preferPrefixes,
  };
}

/**
 * Find a member's defining id on a class, walking the documented base
 * classes when the class doesn't define the member itself: `name` accessed
 * on a `Path` resolves to `pathlib.PurePath.name`. Memoized with a
 * pre-set undefined result as the cycle guard.
 *
 * @param index The resolution index.
 * @param classId The class the member is accessed on.
 * @param member The member's bare name.
 * @returns The defining id, or `undefined` when no class in the chain
 *   documents the member.
 */
export function resolveMember(
  index: SymbolIndex,
  classId: string,
  member: string,
): string | undefined {
  const memoKey = `${classId}.${member}`;
  if (index.memberMemo.has(memoKey)) return index.memberMemo.get(memoKey);
  index.memberMemo.set(memoKey, undefined);
  const own = index.members.get(classId)?.get(member);
  let found: string | undefined = own;
  if (!found) {
    for (const base of index.bases.get(classId) ?? []) {
      found = resolveMember(index, base, member);
      if (found) break;
    }
  }
  index.memberMemo.set(memoKey, found);
  return found;
}

/**
 * Resolve a dotted name against the index using import aliases first,
 * then a unique global short name. Ambiguous names resolve to undefined
 * and stay cold: the mention renders without an id.
 *
 * @param name The dotted name as written, e.g. `driver.CPU`.
 * @param aliases Local name to dotted path, from the snippet's imports.
 * @param index The resolution index.
 * @returns The symbol id, or `undefined` when the name is unknown or
 *   ambiguous.
 */
export function resolveApiName(
  name: string,
  aliases: Record<string, string>,
  index: SymbolIndex,
): string | undefined {
  if (!name || name.length > 120 || !/^[A-Za-z_]/.test(name)) return undefined;
  if (name.includes('.') && index.idSet.has(name)) return name;
  const parts = name.split('.');
  const head = parts[0]!;
  const aliasTarget = aliases[head];
  if (aliasTarget) {
    const candidate =
      parts.length === 1 ? aliasTarget : `${aliasTarget}.${parts.slice(1).join('.')}`;
    return index.idSet.has(candidate) ? candidate : undefined;
  }
  // No import alias: only annotate when the bare name is unambiguous, and
  // try to extend it with the remaining segments (e.g. `TensorValue.reshape`).
  // Ids from secondary sources can collide with first-party ids (`Buffer`
  // matching both a MAX class and collections.abc.Buffer); the preferred
  // prefix wins so secondary sources never change an existing annotation.
  // First-party collisions stay cold.
  const base = pickShortName(head, index);
  if (!base) return undefined;
  const candidate = parts.length === 1 ? base : `${base}.${parts.slice(1).join('.')}`;
  return index.idSet.has(candidate) ? candidate : undefined;
}

/**
 * The one id a bare name stands for: the only id ending in it, or else the
 * only one carrying a preferred prefix. A bare id that is itself in the
 * index (a stdlib `type` or `bool`) competes like any other, so a
 * preferred-prefix id still wins over it.
 */
function pickShortName(name: string, index: SymbolIndex): string | undefined {
  const hits = index.shortMap.get(name);
  if (!hits) return undefined;
  if (hits.length === 1) return hits[0];
  const preferred = hits.filter((h) => index.preferPrefixes.some((p) => h.startsWith(p)));
  return preferred.length === 1 ? preferred[0] : undefined;
}

function proseSuffixes(index: SymbolIndex): Map<string, string | null> {
  if (!index.suffixes) {
    const suffixes = new Map<string, string | null>();
    for (const id of index.ids) {
      const segments = id.split('.');
      for (let k = 1; k < segments.length - 1; k++) {
        const suffix = segments.slice(k).join('.');
        suffixes.set(suffix, suffixes.has(suffix) ? null : id);
      }
    }
    index.suffixes = suffixes;
  }
  return index.suffixes;
}

/**
 * Resolve a prose mention of a symbol against the index: an exact dotted
 * name, a unique dotted suffix, or a globally-unique bare name (with the
 * preferred prefix breaking ties). Anything else stays cold. Shared by
 * the rehype pass (build time, Docusaurus) and the DOM annotator (browser
 * time, Astro/Blume), which must resolve mentions identically.
 *
 * @param text The mention's text; a trailing `()` is ignored.
 * @param index The resolution index.
 * @returns The symbol id, or `undefined` when the mention is unknown or
 *   ambiguous.
 */
export function resolveProseMention(text: string, index: SymbolIndex): string | undefined {
  const name = text.trim().replace(/\(\)$/, '');
  if (!name || name.length > 80 || /\s/.test(name)) return undefined;
  if (!name.includes('.')) return pickShortName(name, index);
  if (index.idSet.has(name)) return name;
  return proseSuffixes(index).get(name) ?? undefined;
}

/** decodeURIComponent that returns the input for a malformed escape. */
export function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Extract a symbol id from a link to an API page on the same site. A
 * fragment naming a symbol wins (`pathlib.html#pathlib.Path`, the shape
 * Sphinx and mkdocstrings emit); otherwise the page path's last segment
 * names it when it reads as a symbol page: a dotted id (`pathlib.Path/`)
 * or a Markdown file (`Path.md`). A plain path segment (`/quickinfo/`, a
 * site's own base path) is a page, not a symbol. Links with a scheme or
 * host (`https://docs.python.org/...#int`) point at another site's symbols
 * and never resolve, and only ids in the index count.
 *
 * @param href The link's `href` as written.
 * @param index The resolution index.
 * @returns The symbol id, or `undefined` for any other link.
 */
export function resolveHref(href: string, index: SymbolIndex): string | undefined {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return undefined;
  const hash = safeDecode((href.split('#')[1] || '').split('?')[0]!);
  if (hash && index.idSet.has(hash)) return hash;
  if (href.startsWith('#')) return undefined;
  const pathPart = href.split(/[?#]/)[0]!.replace(/\/$/, '');
  const segment = pathPart.split('/').pop() || '';
  const last = segment.match(/^([\w.]+?)(\.mdx?)?$/);
  if (!last || (!last[2] && !last[1]!.includes('.'))) return undefined;
  return index.idSet.has(last[1]!) ? last[1] : undefined;
}

/** Whether a link leaves the site: it has a scheme or a host. */
export function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

/**
 * Resolve a dotted occurrence for annotation. Import aliases resolve as in
 * resolveApiName; inferred local variables resolve member access through
 * the inheritance chain, so `config.name` annotates as
 * `pathlib.PurePath.name` once `config = Path("app.toml")` is seen. Any
 * other name bound in the snippet stays cold: it's the user's variable,
 * not an API mention, even when it matches a unique short name.
 *
 * @param name The dotted occurrence as written, e.g. `config.name`.
 * @param aliases Local name to dotted path, from the snippet's imports.
 * @param locals Local name to class id, inferred from constructor calls.
 * @param binds Every name the snippet binds.
 * @param index The resolution index.
 * @returns The symbol id, or `undefined` when the occurrence stays cold.
 */
export function resolveDotted(
  name: string,
  aliases: Record<string, string>,
  locals: Record<string, string>,
  binds: Set<string>,
  index: SymbolIndex,
): string | undefined {
  const parts = name.split('.');
  const head = parts[0]!;
  // Aliases keep their API meaning even if the name is also bound in the
  // snippet (`import json as j` then `j.dumps()`).
  if (aliases[head]) return resolveApiName(name, aliases, index);
  const localType = locals[head];
  if (localType) {
    if (parts.length === 1) return undefined;
    const rest = parts.slice(1).join('.');
    const direct = `${localType}.${rest}`;
    if (index.idSet.has(direct)) return direct;
    return rest.includes('.') ? undefined : resolveMember(index, localType, rest);
  }
  if (binds.has(head)) return undefined;
  return resolveApiName(name, aliases, index);
}

// Splits on bare identifier segments; dots become standalone pieces so that
// dotted chains are always assembled by the chain walk below, whether prism
// emits `driver`, `.`, `CPU` or one `driver.CPU` token.
const IDENT_RE = /([A-Za-z_][A-Za-z0-9_]*)/;
const PIECE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SKIP_TYPE_RE = /comment|string/;

interface TokenPiece {
  content: string;
  token: PrismToken;
  /** Comment/string pieces (and non-string tokens) pass through untouched. */
  skip: boolean;
}

/** A Python snippet's binding structure, parsed once per snippet. */
export interface SnippetContext {
  /** Local name to dotted path, from import statements. */
  aliases: Record<string, string>;
  /** Local name to class id, inferred from constructor-call bindings. */
  locals: Record<string, string>;
  /** Every name the snippet binds: assignments, parameters, `as` targets. */
  binds: Set<string>;
}

/** Per-snippet parse memo: each code block's bindings are parsed once, no
 * matter how many lines its Line components annotate. */
const snippetMemo = new WeakMap<SymbolIndex, Map<string, SnippetContext>>();

function snippetContext(code: string, index: SymbolIndex): SnippetContext {
  let memo = snippetMemo.get(index);
  if (!memo) {
    memo = new Map();
    snippetMemo.set(index, memo);
  }
  let ctx = memo.get(code);
  if (ctx) return ctx;
  const aliases = parsePythonImports(code);
  const locals = parsePythonLocals(
    code,
    aliases,
    (call) => resolveApiName(call, aliases, index),
    index.idSet,
  );
  const binds = parsePythonBinds(code);
  ctx = { aliases, locals, binds };
  // Bounded: a long docs page can hold many distinct snippets, and the
  // parse is cheap to redo for one that falls out of the memo.
  if (memo.size > 64) memo.clear();
  memo.set(code, ctx);
  return ctx;
}

/**
 * Whether code blocks in a prism language get annotated: the language
 * has a built-in module and is enabled in the `languages` option.
 *
 * @param language The code block's language tag, e.g. `py`.
 * @param languages The enabled language modules.
 */
export function isAnnotatedLanguage(
  language: string | undefined,
  languages: string[] = ['python'],
): boolean {
  if (!language) return false;
  return isPythonLanguage(language) && languages.includes('python');
}

function annotateLineTokens(
  line: PrismToken[],
  ctx: SnippetContext,
  index: SymbolIndex,
  untyped = false,
): PrismToken[] {
  // A language Prism doesn't tokenize (pycon, ipython) arrives as plain
  // tokens with no comment/string types; find those regions by scanning
  // the line text instead.
  const regions = untyped
    ? pythonSkipRegions(line.map((t) => String(t.content ?? '')).join(''))
    : [];
  const inRegion = (start: number, end: number) => regions.some(([a, b]) => start < b && a < end);
  let offset = 0;

  // 1. Split each renderable token into pieces (identifiers isolated).
  const pieces: TokenPiece[] = [];
  for (const token of line) {
    const tokenStart = offset;
    offset += typeof token.content === 'string' ? token.content.length : 0;
    if (
      typeof token.content !== 'string' ||
      token.content.length === 0 ||
      (Array.isArray(token.types) ? token.types : [token.types]).some((t) => SKIP_TYPE_RE.test(t))
    ) {
      pieces.push({ content: '', token, skip: true });
      continue;
    }
    let pos = tokenStart;
    for (const part of token.content.split(IDENT_RE)) {
      if (part) pieces.push({ content: part, token, skip: inRegion(pos, pos + part.length) });
      pos += part.length;
    }
  }

  // 2. Reassemble dotted chains and resolve each identifier piece.
  const result: PrismToken[] = [];
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i]!;
    if (piece.skip) {
      // A whole comment/string token, or a part inside a scanned region.
      result.push(piece.content ? { ...piece.token, content: piece.content } : piece.token);
      i++;
      continue;
    }
    if (!PIECE_IDENT_RE.test(piece.content)) {
      result.push({ ...piece.token, content: piece.content });
      i++;
      continue;
    }
    // Collect ident (. ident)* as far as the pieces allow.
    const identIdx: number[] = [i];
    let j = i + 1;
    while (
      j + 1 < pieces.length &&
      !pieces[j]!.skip &&
      pieces[j]!.content === '.' &&
      !pieces[j + 1]!.skip &&
      PIECE_IDENT_RE.test(pieces[j + 1]!.content)
    ) {
      identIdx.push(j + 1);
      j += 2;
    }
    // Resolve every prefix, annotating each identifier piece with the
    // longest prefix ending at it that resolves to a symbol.
    let name = '';
    let k = 0;
    for (const idx of identIdx) {
      const part = pieces[idx]!.content;
      name = name ? `${name}.${part}` : part;
      const id = resolveDotted(name, ctx.aliases, ctx.locals, ctx.binds, index);
      result.push({
        ...pieces[idx]!.token,
        content: part,
        ...(id ? { apiId: id } : {}),
      });
      // Emit the dot piece before the next identifier, if any.
      k++;
      if (k < identIdx.length) {
        result.push({ ...pieces[idx + 1]!.token, content: '.' });
      }
    }
    i = j;
  }
  return result;
}

/**
 * Annotate one prism-rendered line of tokens: each identifier piece gets
 * `apiId` when it resolves against the index, so `dumps` in `json.dumps()`
 * resolves to `json.dumps` once `import json` is seen, and `name` in
 * `config.name` resolves to the inherited `pathlib.PurePath.name` once
 * `config = Path("app.toml")` is. Returns a new array; never
 * mutates the input.
 *
 * @param line The line's prism tokens.
 * @param code The whole code block, for import and binding context.
 * @param language The code block's prism language tag.
 * @param index The resolution index.
 * @param languages The enabled language modules.
 * @returns The line's tokens with `apiId` set on resolved identifiers.
 */
export function annotateLines(
  line: PrismToken[],
  code: string,
  language: string | undefined,
  index: SymbolIndex,
  languages: string[] = ['python'],
): PrismToken[] {
  if (!isAnnotatedLanguage(language, languages)) return line;
  const ctx = snippetContext(code, index);
  return annotateLineTokens(line, ctx, index, !/^(py|python)$/i.test(language ?? ''));
}

/**
 * The binding context (imports, inferred locals, bound names) for a
 * Python snippet, parsed once and memoized no matter how many times the
 * snippet's pieces are resolved. The DOM annotator consumes this on
 * Astro/Blume sites, where there is no prism token stream to carry it.
 *
 * @param code The whole code block.
 * @param index The resolution index; constructor calls resolve against it.
 */
export function getSnippetContext(code: string, index: SymbolIndex): SnippetContext {
  return snippetContext(code, index);
}
