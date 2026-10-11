/**
 * Boots quickinfo on a page that has no build-time annotation: loads the
 * names JSON, builds the index, annotates the document, and starts the
 * hover runtime. Shared by the Astro integration and the standalone
 * script that Sphinx, MkDocs, and any other static site load.
 */
import { buildIndex, type SymbolIndex } from '../lib/annotate';
import { annotateDocument, type AnnotateOptions } from './annotate-dom';
import { isTooltipNode, startHover } from './hover';

/** The resolved config the browser entry receives. */
export interface QuickinfoClientConfig {
  /** URL the browser fetches the names JSON from. */
  namesUrl: string;
  /** URL the runtime fetches the info JSON from. */
  infoUrl: string;
  /** Id prefixes that win a short-name collision. */
  preferPrefixes: string[];
  /** Language modules to enable for code annotation. */
  languages: string[];
  /** Language assumed for code blocks that carry no language marker. */
  defaultLanguage?: string;
}

interface NamesJson {
  ids: string[];
  bases?: Record<string, string[]>;
  version?: string;
}

async function fetchNames(namesUrl: string): Promise<NamesJson | undefined> {
  try {
    const resp = await fetch(new URL(namesUrl, document.baseURI).href);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as NamesJson;
    if (!Array.isArray(data.ids) || data.ids.length === 0) {
      console.warn('quickinfo: names JSON holds no ids; hover disabled.');
      return undefined;
    }
    return data;
  } catch (err) {
    console.warn(
      `quickinfo: names JSON unavailable at "${namesUrl}" (${err instanceof Error ? err.message : err}); hover disabled.`,
    );
    return undefined;
  }
}

/** Does a mutation bring in content worth annotating? Our own wraps and
 * the tooltip are skipped, so annotation never feeds itself. */
function bringsContent(mutation: MutationRecord): boolean {
  for (const node of Array.from(mutation.addedNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE || isTooltipNode(node)) continue;
    const el = node as Element;
    if (el.hasAttribute('data-api-id') && el.tagName === 'SPAN') continue;
    if (el.matches('pre, code, a') || el.querySelector('pre, code, a')) return true;
    // Highlighters replace a block's children with bare token spans.
    if (el.closest('pre')) return true;
  }
  return false;
}

/** Re-annotate after DOM changes: client-side navigation (Material's
 * instant loading, Astro view transitions) and late highlighters. */
function observe(index: SymbolIndex, options: AnnotateOptions): void {
  let scheduled = false;
  const observer = new MutationObserver((mutations) => {
    if (scheduled || !mutations.some(bringsContent)) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      annotateDocument(index, options);
    });
  });
  // The root element: client-side navigation may replace <body> itself.
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

let booted = false;

/**
 * Boot the runtime: load the names JSON, annotate the current document,
 * wire the hover listeners, and keep annotating as the page changes. A
 * second call is a no-op.
 *
 * @param config Where the data lives and what to annotate, with defaults
 *   applied.
 * @returns Resolves once the first annotation pass is done, or right away
 *   when the names JSON can't be loaded.
 */
export async function initQuickinfo(config: QuickinfoClientConfig): Promise<void> {
  if (booted) return;
  booted = true;
  const data = await fetchNames(config.namesUrl);
  if (!data) return;
  const index = buildIndex(data.ids, data.bases ?? {}, config.preferPrefixes ?? []);
  const options: AnnotateOptions = {
    languages: config.languages,
    defaultLanguage: config.defaultLanguage,
  };
  startHover({ infoUrl: config.infoUrl, version: data.version });
  annotateDocument(index, options);
  observe(index, options);
  // Astro view transitions swap the body; the observer sees that, but the
  // event marks the swap's end, so annotate there too. Dispatched on
  // document and does not bubble.
  document.addEventListener('astro:page-load', () => annotateDocument(index, options));
}
