/**
 * Core annotation machinery: resolve identifier occurrences in rendered
 * code tokens against an API symbol index and stamp them with `apiId`,
 * which the Token theme component renders as `data-api-id`.
 *
 * Mirrors Verso's approach for Lean docs: every known API identifier
 * rendered in a code block gets a stable id, which the hover runtime uses
 * to highlight all instances on the page and show an IDE-style
 * signature/docstring tooltip.
 *
 * Language-agnostic: the per-language binding structure (imports, inferred
 * locals, bound names) comes from pluggable language modules (see
 * python.ts). Python is built in; the active set is narrowed by the
 * plugin's `languages` option.
 *
 * The names JSON is aliased by the plugin's webpack config to the
 * consumer's generated index. Resolved lazily because no alias exists in
 * plain-Node contexts (unit harness, SSR edge cases): there the fallback
 * empty index keeps the module loadable and annotates nothing.
 */
function loadData(): {
  ids: string[];
  bases: Record<string, string[]>;
  version?: string;
} {
  try {
    return require('docusaurus-plugin-api-hover/data') as {
      ids: string[];
      bases: Record<string, string[]>;
      version?: string;
    };
  } catch {
    return { ids: [], bases: {} };
  }
}

let dataCache: ReturnType<typeof loadData> | undefined;

function data(): ReturnType<typeof loadData> {
  dataCache ??= loadData();
  return dataCache;
}
import {
  isPythonLanguage,
  parsePythonBinds,
  parsePythonImports,
  parsePythonLocals,
} from './python';

/** Fallback config when the aliased module is absent (e.g. unit tests). */
const FALLBACK_CONFIG = {
  infoUrl: '/data/api-hover-info.json',
  preferPrefixes: [] as string[],
  languages: ['python'],
};

interface HoverConfig {
  infoUrl: string;
  preferPrefixes: string[];
  languages: string[];
}

function loadConfig(): HoverConfig {
  try {
    return require('docusaurus-plugin-api-hover/config') as HoverConfig;
  } catch {
    return FALLBACK_CONFIG;
  }
}

let configCache: HoverConfig | undefined;

function activeConfig(): HoverConfig {
  configCache ??= loadConfig();
  return configCache;
}

export interface ApiHoverIndex {
  /** All ids, in index order; the prose resolver scans them for suffixes. */
  ids: string[];
  /** Full dotted ids, e.g. "max.graph.Graph". */
  idSet: Set<string>;
  /** Final segment -> ids ending with it. */
  shortMap: Map<string, string[]>;
  /** Parent id -> (member name -> defining id), for documented parents only. */
  members: Map<string, Map<string, string>>;
  /** Class id -> direct documented base class ids. */
  bases: Map<string, string[]>;
  /** Memo for inherited-member lookups. */
  memberMemo: Map<string, string | undefined>;
  /**
   * Id prefixes that win a short-name collision (e.g. "max." for a MAX
   * docs site that also indexes Python stdlib ids), so extra id sources
   * can never change an existing annotation.
   */
  preferPrefixes: string[];
}

export interface PrismToken {
  types: string[] | string;
  content: string;
  /** Set by annotateLines when the token resolves to an API symbol. */
  apiId?: string;
  [key: string]: unknown;
}

export function buildApiHoverIndex(
  ids: string[],
  basesRecord: Record<string, string[]> = {},
  preferPrefixes: string[] = [],
): ApiHoverIndex {
  const idSet = new Set(ids);
  const shortMap = new Map<string, string[]>();
  const members = new Map<string, Map<string, string>>();
  for (const id of ids) {
    const last = id.split('.').pop()!;
    const bucket = shortMap.get(last);
    if (bucket) bucket.push(id);
    else shortMap.set(last, [id]);

    // Own member: "max.driver.Device.id" under parent "max.driver.Device",
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

let cachedIndex: ApiHoverIndex | undefined;

export function getApiHoverIndex(): ApiHoverIndex {
  cachedIndex ??= buildApiHoverIndex(data().ids, data().bases, activeConfig().preferPrefixes);
  return cachedIndex;
}

/** Version string from the names JSON; the runtime appends it to its info
 * fetch as a cache-busting query. */
export function getInfoVersion(): string {
  return data().version ?? '';
}

/** Where the runtime fetches the info JSON (signatures/docstrings). */
export function getInfoUrl(): string {
  return activeConfig().infoUrl;
}

/**
 * Find a member's defining id on a class, walking the documented base
 * classes when the class doesn't define the member itself: `id` accessed
 * on an Accelerator resolves to `max.driver.Device.id`. Memoized with a
 * pre-set undefined result as the cycle guard.
 */
export function resolveMember(
  index: ApiHoverIndex,
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
 */
export function resolveApiName(
  name: string,
  aliases: Record<string, string>,
  index: ApiHoverIndex,
): string | undefined {
  if (!name || name.length > 120 || !/^[A-Za-z_]/.test(name)) return undefined;
  if (index.idSet.has(name)) return name;
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
  const shortHits = index.shortMap.get(head);
  let base: string | undefined;
  if (shortHits) {
    if (shortHits.length === 1) base = shortHits[0]!;
    else {
      const preferred = shortHits.filter((h) => index.preferPrefixes.some((p) => h.startsWith(p)));
      if (preferred.length === 1) base = preferred[0];
    }
  }
  if (!base) return undefined;
  const candidate = parts.length === 1 ? base : `${base}.${parts.slice(1).join('.')}`;
  return index.idSet.has(candidate) ? candidate : undefined;
}

/**
 * Resolve a prose mention of a symbol against the index: an exact dotted
 * name, a unique dotted suffix, or a globally-unique bare name (with the
 * preferred prefix breaking ties). Anything else stays cold. Shared by
 * the rehype pass (build time, Docusaurus) and the DOM annotator (browser
 * time, Astro/Blume), which must resolve mentions identically.
 */
export function resolveProseMention(text: string, index: ApiHoverIndex): string | undefined {
  const name = text.trim().replace(/\(\)$/, '');
  if (!name || name.length > 80 || /\s/.test(name)) return undefined;
  if (index.idSet.has(name)) return name;
  if (name.includes('.')) {
    const suffix = `.${name}`;
    let hit: string | undefined;
    let count = 0;
    for (const id of index.ids) {
      if (id.endsWith(suffix)) {
        hit = id;
        count++;
        if (count > 1) return undefined;
      }
    }
    return hit;
  }
  const hits = index.shortMap.get(name);
  if (!hits) return undefined;
  if (hits.length === 1) return hits[0]!;
  const preferred = hits.filter((h) => index.preferPrefixes.some((p) => h.startsWith(p)));
  return preferred.length === 1 ? preferred[0] : undefined;
}

/**
 * Resolve a dotted occurrence for annotation. Import aliases resolve as in
 * resolveApiName; inferred local variables resolve member access through
 * the inheritance chain, so `device.id` annotates as `max.driver.Device.id`
 * once `device = driver.Accelerator()` is seen. Any other name bound in
 * the snippet stays cold: it's the user's variable, not an API mention,
 * even when it matches a unique short name.
 */
export function resolveDotted(
  name: string,
  aliases: Record<string, string>,
  locals: Record<string, string>,
  binds: Set<string>,
  index: ApiHoverIndex,
): string | undefined {
  const parts = name.split('.');
  const head = parts[0]!;
  // Aliases keep their API meaning even if the name is also bound in the
  // snippet (`import max.driver as driver` then `driver.CPU()`).
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

export interface SnippetContext {
  aliases: Record<string, string>;
  locals: Record<string, string>;
  binds: Set<string>;
}

/** Per-snippet parse memo: each code block's bindings are parsed once, no
 * matter how many lines its Line components annotate. */
const snippetMemo = new Map<string, SnippetContext>();

function snippetContext(code: string, index: ApiHoverIndex): SnippetContext {
  let ctx = snippetMemo.get(code);
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
  if (snippetMemo.size > 64) snippetMemo.clear();
  snippetMemo.set(code, ctx);
  return ctx;
}

/** Can this prism language tag be annotated at all? */
export function isAnnotatedLanguage(language: string | undefined): boolean {
  if (!language) return false;
  const { languages } = activeConfig();
  return isPythonLanguage(language) && languages.includes('python');
}

function annotateLineTokens(
  line: PrismToken[],
  ctx: SnippetContext,
  index: ApiHoverIndex,
): PrismToken[] {
  // 1. Split each renderable token into pieces (identifiers isolated).
  const pieces: TokenPiece[] = [];
  for (const token of line) {
    if (
      typeof token.content !== 'string' ||
      token.content.length === 0 ||
      (Array.isArray(token.types) ? token.types : [token.types]).some((t) => SKIP_TYPE_RE.test(t))
    ) {
      pieces.push({ content: '', token, skip: true });
      continue;
    }
    const parts = token.content.split(IDENT_RE);
    if (parts.length === 1) {
      pieces.push({ content: token.content, token, skip: false });
    } else {
      for (const part of parts) {
        if (part) pieces.push({ content: part, token, skip: false });
      }
    }
  }

  // 2. Reassemble dotted chains and resolve each identifier piece.
  const result: PrismToken[] = [];
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i]!;
    if (piece.skip) {
      result.push(piece.token);
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
 * `apiId` when it resolves against the index, so `CPU` in `driver.CPU()`
 * resolves to `max.driver.CPU` once `from max import driver` is seen, and
 * `id` in `device.id` resolves to the inherited `max.driver.Device.id`
 * once `device = driver.Accelerator()` is. Returns a new array; never
 * mutates the input.
 */
export function annotateLines(
  line: PrismToken[],
  code: string,
  language: string | undefined,
  index: ApiHoverIndex = getApiHoverIndex(),
): PrismToken[] {
  if (!isAnnotatedLanguage(language)) return line;
  const ctx = snippetContext(code, index);
  return annotateLineTokens(line, ctx, index);
}

/**
 * The binding context (imports, inferred locals, bound names) for a
 * Python snippet, parsed once and memoized no matter how many times the
 * snippet's pieces are resolved. The DOM annotator consumes this on
 * Astro/Blume sites, where there is no prism token stream to carry it.
 */
export function getSnippetContext(code: string, index: ApiHoverIndex): SnippetContext {
  return snippetContext(code, index);
}
