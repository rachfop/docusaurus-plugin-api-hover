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
import { readFileSync } from 'fs';
import { visit } from 'unist-util-visit';
import type { Node, Parent } from 'unist';
import { checkCommonOptions } from './lib/options';
import { buildIndex, resolveHref, resolveProseMention, type SymbolIndex } from './lib/annotate';

/** Options for the rehype pass, passed in the markdown config. */
interface RehypeQuickinfoOptions {
  /**
   * Path to the names JSON your index generator writes. A relative path
   * resolves against the process working directory, which is the site
   * directory under `docusaurus build`.
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
   * Docs base path under which symbol pages live. Link hrefs under it,
   * like `/api/python/generated/<id>.md`, count as links to API pages.
   * @default '/api'
   */
  apiBasePath?: string;
}

interface HastElement extends Node {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

interface RehypeContext {
  index: SymbolIndex;
  apiBasePath: string;
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
function rehypeQuickinfo(options: RehypeQuickinfoOptions = {}): (tree: Node) => void {
  if (typeof options !== 'object' || options === null) {
    throw new Error('quickinfo: rehype options must be an object');
  }
  checkCommonOptions(options as Record<string, unknown>);
  if (options.dataFile !== undefined && typeof options.dataFile !== 'string') {
    throw new Error('quickinfo: rehype "dataFile" must be a path');
  }
  const dataFile = path.resolve(options.dataFile ?? 'static/quickinfo/names.json');
  let ids: string[] | undefined;
  try {
    ids = JSON.parse(readFileSync(dataFile, 'utf-8')).ids;
  } catch {
    // Index not generated yet (e.g. first run before the docs prebuild);
    // annotate nothing; the build must not fail on a missing index.
    console.warn(
      `quickinfo: rehype dataFile "${dataFile}" not readable; ` +
        'prose mentions stay unannotated until the index is generated.',
    );
    return () => {};
  }
  if (!Array.isArray(ids) || ids.length === 0) return () => {};

  const ctx: RehypeContext = {
    index: buildIndex(ids, {}, options.preferPrefixes ?? []),
    apiBasePath: options.apiBasePath ?? '/api',
  };

  return (tree: Node) => {
    // Pass 1: mentions inside a link straight to the API page take their
    // id from the href. The link is authoritative and disambiguates
    // mentions whose bare name is not unique.
    visit(tree, 'element', (node: HastElement, _index, _parent) => {
      if (!node || node.tagName !== 'a') return;
      const href = node.properties && node.properties.href;
      const id =
        typeof href === 'string' ? resolveHref(href, ctx.index, ctx.apiBasePath) : undefined;
      if (!id) return;
      let annotated = false;
      visit(node, 'element', (child: HastElement, _ci, parent) => {
        if (
          child &&
          isMentionElement(child) &&
          parent &&
          (parent as HastElement).tagName !== 'pre' &&
          !child.properties?.dataApiId
        ) {
          child.properties = child.properties ?? {};
          child.properties.dataApiId = id;
          annotated = true;
        }
      });
      // Signature lines link the bare dotted name (no <code> inside);
      // member references use the short name as the link text. Annotate
      // the link itself when its text is the symbol id or its final
      // segment.
      if (!annotated) {
        const text = plainText(node).trim();
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
      if (node.properties?.dataApiId) return;
      if (!node.children || node.children.length === 0) return;
      const text = plainText(node).trim();
      if (!text) return;
      const id = resolveProseMention(text, ctx.index);
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
