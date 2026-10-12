/**
 * Rehype plugin that marks inline code mentions of API symbols with
 * `data-api-id`, so the hover runtime can highlight all instances of a
 * symbol on a page and show its signature in a tooltip, including prose
 * mentions outside code blocks, like Verso does for Lean docs.
 *
 * Resolution is conservative: a mention is only annotated when it maps to
 * exactly one API symbol (exact dotted name, unique dotted suffix, or a
 * globally-unique bare name).
 *
 * Mentions inside a link to an API page take their id from the href, which
 * is authoritative even when the bare name is ambiguous.
 */
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';
import { checkCommonOptions } from './lib/options';
import {
  buildIndex,
  isExternalHref,
  resolveHref,
  resolveProseMention,
  type SymbolIndex,
} from './lib/annotate';

/** Options for the rehype pass, passed in the markdown config. */
interface RehypeQuickinfoOptions {
  /**
   * Path to the names JSON your index generator writes. A relative path
   * resolves against the site directory (the nearest folder above each
   * page holding a `docusaurus.config.*`), the same base the plugin uses.
   * @default 'static/quickinfo/names.json'
   */
  dataFile?: string;
  /**
   * Id prefixes that win a short-name collision, e.g. `["max."]` on a site
   * that indexes both MAX symbols and Python stdlib ids.
   * @default []
   */
  preferPrefixes?: string[];
  /**
   * Pages to leave unannotated: a string matches when the page's source
   * path contains it, a RegExp when it matches the path. Use it for
   * reference pages of another language or another version of the API
   * than the index describes, e.g. `['/api/mojo/', 'versioned_docs/']`.
   * @default []
   */
  exclude?: Array<string | RegExp>;
}

interface HastElement extends Node {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

/** The page being transformed, as unified passes it. */
interface PageFile {
  path?: string;
}

const CONFIG_NAMES = ['js', 'ts', 'mjs', 'cjs', 'mts', 'cts'].map(
  (ext) => `docusaurus.config.${ext}`,
);

/** The nearest directory above `file` holding a Docusaurus config. */
function findSiteDir(file: string): string | undefined {
  let dir = path.dirname(file);
  for (;;) {
    if (CONFIG_NAMES.some((name) => existsSync(path.join(dir, name)))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Inline mentions of identifiers: <code>, or class="code" <em> spans. */
function isMentionElement(node: HastElement | undefined): boolean {
  if (!node) return false;
  if (node.tagName === 'code') return true;
  if (node.tagName !== 'em') return false;
  const cls = node.properties && node.properties.className;
  return (Array.isArray(cls) ? cls.join(' ') : String(cls || '')).includes('code');
}

function plainText(node: HastElement): string {
  if (!node.children) return '';
  return node.children
    .map((c) =>
      c.type === 'text'
        ? ((c as { value?: string }).value ?? '')
        : c.type === 'element'
          ? plainText(c as HastElement)
          : '',
    )
    .join('');
}

/**
 * The rehype pass. Stamps `data-api-id` onto prose mentions of API symbols
 * at build time: inline code, and links to API pages. A mention annotates
 * only when it resolves to one symbol; a link to an API page names its
 * symbol even when the bare name is ambiguous.
 *
 * @param options Rehype pass options.
 * @returns The rehype transformer. It annotates nothing when `dataFile`
 *   is missing or empty, so a build before the index exists still passes.
 * @example
 * ```js
 * const quickinfoRehype = require('quickinfo/rehype');
 * const dataFile = path.resolve(__dirname, 'generated/quickinfo-names.json');
 *
 * // In the docs plugin or preset options:
 * rehypePlugins: [[quickinfoRehype, { dataFile }]],
 * ```
 */
function rehypeQuickinfo(
  options: RehypeQuickinfoOptions = {},
): (tree: Node, file?: PageFile) => void {
  if (typeof options !== 'object' || options === null) {
    throw new Error('quickinfo: rehype options must be an object');
  }
  checkCommonOptions(options as Record<string, unknown>);
  if (options.dataFile !== undefined && typeof options.dataFile !== 'string') {
    throw new Error('quickinfo: rehype "dataFile" must be a path');
  }
  const exclude = options.exclude ?? [];
  if (
    !Array.isArray(exclude) ||
    exclude.some((e) => typeof e !== 'string' && !(e instanceof RegExp))
  ) {
    throw new Error('quickinfo: rehype "exclude" must be an array of strings or RegExps');
  }
  const dataFile = options.dataFile ?? 'static/quickinfo/names.json';

  // One index per resolved data path, loaded on first use: a relative path
  // can only be resolved once a page reveals where the site lives.
  const indexes = new Map<string, SymbolIndex | null>();
  const indexFor = (file: PageFile | undefined): SymbolIndex | null => {
    const base = path.isAbsolute(dataFile)
      ? ''
      : ((file?.path && findSiteDir(path.resolve(file.path))) ?? process.cwd());
    const resolved = path.resolve(base, dataFile);
    if (!indexes.has(resolved)) {
      let ids: unknown;
      try {
        ids = JSON.parse(readFileSync(resolved, 'utf-8')).ids;
      } catch {
        // Index not generated yet (e.g. first run before the docs
        // prebuild): annotate nothing; the build must not fail on it.
        console.warn(
          `quickinfo: rehype dataFile "${resolved}" not readable; ` +
            'prose mentions stay unannotated until the index is generated.',
        );
      }
      indexes.set(
        resolved,
        Array.isArray(ids) && ids.length > 0
          ? buildIndex(ids as string[], {}, options.preferPrefixes ?? [])
          : null,
      );
    }
    return indexes.get(resolved) ?? null;
  };
  const excluded = (file: PageFile | undefined): boolean => {
    const page = file?.path?.split(path.sep).join('/');
    return (
      !!page &&
      exclude.some((rule) => (typeof rule === 'string' ? page.includes(rule) : rule.test(page)))
    );
  };

  return (tree: Node, file?: PageFile) => {
    if (excluded(file)) return;
    const index = indexFor(file);
    if (!index) return;
    // A link to a symbol's page names it even when the bare name is
    // ambiguous. A link to another site means the mention is that site's
    // symbol, so its inline code stays plain; inline code in other
    // same-site links resolves by name in pass 2.
    const linked = new WeakSet<HastElement>();

    // Pass 1: links.
    visit(tree, 'element', (node: HastElement) => {
      if (!node || node.tagName !== 'a') return;
      const href = node.properties && node.properties.href;
      const id = typeof href === 'string' ? resolveHref(href, index) : undefined;
      const external = typeof href === 'string' && isExternalHref(href);
      let annotated = false;
      visit(node, 'element', (child: HastElement, _ci, parent) => {
        if (
          !child ||
          !isMentionElement(child) ||
          !parent ||
          (parent as HastElement).tagName === 'pre'
        ) {
          return;
        }
        if (id || external) linked.add(child);
        if (id && !child.properties?.dataApiId) {
          child.properties = child.properties ?? {};
          child.properties.dataApiId = id;
          annotated = true;
        }
      });
      // Signature lines link the bare dotted name (no <code> inside);
      // member references use the short name as the link text. Annotate
      // the link itself when its text is the symbol id or its final
      // segment.
      if (id && !annotated) {
        const text = plainText(node).trim().replace(/\(\)$/, '');
        if (text === id || text === id.split('.').pop()) {
          node.properties = node.properties ?? {};
          node.properties.dataApiId = id;
        }
      }
    });

    // Pass 2: plain mentions resolved by name.
    visit(tree, 'element', (node: HastElement, _index, parent: Parent) => {
      if (!node || !isMentionElement(node) || !parent || (parent as HastElement).tagName === 'pre')
        return;
      if (linked.has(node) || node.properties?.dataApiId) return;
      if (!node.children || node.children.length === 0) return;
      const text = plainText(node).trim();
      if (!text) return;
      const id = resolveProseMention(text, index);
      if (id) {
        node.properties = node.properties ?? {};
        node.properties.dataApiId = id;
      }
    });
  };
}

// `export =`: `require('quickinfo/rehype')` returns the plugin function
// itself, the shape Docusaurus's MDX config checks for.
namespace rehypeQuickinfo {
  export type Options = RehypeQuickinfoOptions;
}

export = rehypeQuickinfo;
