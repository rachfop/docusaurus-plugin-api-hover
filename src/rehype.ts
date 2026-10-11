/**
 * Rehype plugin that marks inline code mentions of API symbols with
 * `data-api-id`, so the hover runtime can highlight all instances of a
 * symbol on a page and show its signature in a tooltip — including prose
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

export interface RehypeApiHoverOptions {
  /** Names JSON produced by the consumer's index generator. */
  dataFile: string;
  /**
   * Id prefixes that win a short-name collision (e.g. ["max."] on a site
   * that indexes both MAX symbols and Python stdlib ids).
   */
  preferPrefixes?: string[];
  /**
   * Docs base path under which symbol pages live; used to recognize
   * absolute doc hrefs like /api/python/generated/<id>.md. Defaults to
   * "/api".
   */
  apiBasePath?: string;
}

interface HastElement extends Node {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

interface RehypeContext {
  ids: string[];
  idSet: Set<string>;
  shortMap: Map<string, string[]>;
  preferPrefixes: string[];
  apiPathRe: RegExp;
}

function resolveProse(text: string, ctx: RehypeContext): string | undefined {
  const name = text.trim().replace(/\(\)$/, '');
  if (!name || name.length > 80 || /\s/.test(name)) return undefined;
  if (ctx.idSet.has(name)) return name;
  if (name.includes('.')) {
    const suffix = `.${name}`;
    let hit: string | undefined;
    let count = 0;
    for (const id of ctx.ids) {
      if (id.endsWith(suffix)) {
        hit = id;
        count++;
        if (count > 1) return undefined;
      }
    }
    return hit;
  }
  // Bare name: unique short names annotate; on a collision the preferred
  // prefix wins (so secondary id sources never change an existing
  // annotation), and first-party collisions stay cold.
  const hits = ctx.shortMap.get(name);
  if (!hits) return undefined;
  if (hits.length === 1) return hits[0];
  const preferred = hits.filter((h) => ctx.preferPrefixes.some((p) => h.startsWith(p)));
  return preferred.length === 1 ? preferred[0] : undefined;
}

/**
 * Extract an API symbol id from a link to a docs API page. The hash
 * fragment is authoritative when it names a symbol. Otherwise recognizes
 * absolute doc paths (<apiBasePath>/...(generated/)?<id>.md), the relative
 * hrefs common in generated markdown (<id>.md), and same-page anchors
 * (#<id>). Guards against non-API links by requiring membership in the id
 * index.
 */
function idFromHref(href: unknown, ctx: RehypeContext): string | undefined {
  if (typeof href !== 'string' || !href) return undefined;
  const hash = (href.split('#')[1] || '').split(/[?#]/)[0];
  if (hash && ctx.idSet.has(hash)) return hash;
  if (href.startsWith('#')) return undefined;
  const pathPart = href.split(/[?#]/)[0].replace(/\/$/, '');
  const absolute = pathPart.match(ctx.apiPathRe);
  if (absolute) return ctx.idSet.has(absolute[1]!) ? absolute[1]! : undefined;
  const base = (pathPart.split('/').pop() || '').match(/^([\w.]+?)(?:\.md)?$/);
  if (base) return ctx.idSet.has(base[1]!) ? base[1]! : undefined;
  return undefined;
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

export default function rehypeApiHover(
  options: RehypeApiHoverOptions = {} as RehypeApiHoverOptions,
) {
  if (!options || typeof options.dataFile !== 'string') {
    throw new Error('api-hover: rehype plugin requires a dataFile option');
  }
  let ids: string[] | undefined;
  try {
    ids = JSON.parse(readFileSync(path.resolve(options.dataFile), 'utf-8')).ids;
  } catch {
    // Index not generated yet (e.g. first run before the docs prebuild);
    // annotate nothing rather than fail the build.
    return () => {};
  }
  if (!Array.isArray(ids) || ids.length === 0) return () => {};

  const idSet = new Set(ids);
  const shortMap = new Map<string, string[]>();
  for (const id of ids) {
    const last = id.split('.').pop()!;
    const bucket = shortMap.get(last);
    if (bucket) bucket.push(id);
    else shortMap.set(last, [id]);
  }
  const ctx: RehypeContext = {
    ids,
    idSet,
    shortMap,
    preferPrefixes: options.preferPrefixes ?? [],
    apiPathRe: new RegExp(
      `^${(options.apiBasePath ?? '/api').replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}/(?:generated/)?([\\w.]+?)(?:\\.md)?$`,
    ),
  };

  return (tree: Node) => {
    // Pass 1: mentions inside a link straight to the API page take their
    // id from the href. The link is authoritative and disambiguates
    // mentions whose bare name is not unique.
    visit(tree, 'element', (node: HastElement, _index, _parent) => {
      if (!node || node.tagName !== 'a') return;
      const id = idFromHref(node.properties && node.properties.href, ctx);
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
      // Signature lines link the bare dotted name (no <code> inside), and
      // member references label it with the short name. Annotate the link
      // itself when its text is the symbol id or its final segment.
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
      const id = resolveProse(text, ctx);
      if (id) {
        node.properties = node.properties ?? {};
        node.properties.dataApiId = id;
      }
    });
  };
}
