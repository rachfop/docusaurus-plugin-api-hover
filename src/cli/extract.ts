/**
 * Reads signatures, docstring summaries, and base classes out of a built
 * site's API pages, so tooltips show what the reference page shows. Knows
 * the markup of Sphinx autodoc (`dt.sig` + `dd`) and mkdocstrings
 * (`.doc-heading` + `.doc-signature` + `.doc-contents`).
 */
import { parse, type HTMLElement } from 'node-html-parser';
import { safeDecode } from '../lib/annotate';

export interface ExtractedSymbol {
  sig?: string;
  doc?: string;
  /** Base class ids, from the page's "Bases:" line. */
  bases: string[];
}

/** Docstring summaries longer than this are cut at a word boundary. */
const MAX_DOC_LENGTH = 320;

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function summary(text: string): string | undefined {
  const flat = clean(text);
  if (!flat) return undefined;
  if (flat.length <= MAX_DOC_LENGTH) return flat;
  const space = flat.lastIndexOf(' ', MAX_DOC_LENGTH);
  return `${flat.slice(0, space > 0 ? space : MAX_DOC_LENGTH)}…`;
}

/** Ids named by the fragments of the links inside an element. */
function linkedIds(el: HTMLElement | null | undefined, ids: Set<string>): string[] {
  const found: string[] = [];
  for (const a of el?.querySelectorAll('a[href]') ?? []) {
    const hash = safeDecode((a.getAttribute('href') ?? '').split('#')[1] ?? '');
    if (ids.has(hash) && !found.includes(hash)) found.push(hash);
  }
  return found;
}

function firstParagraph(
  container: HTMLElement | null | undefined,
  skip: (p: HTMLElement) => boolean,
) {
  for (const child of container?.childNodes ?? []) {
    const el = child as HTMLElement;
    if (el.tagName === 'P' && !skip(el)) return summary(el.text);
  }
  return undefined;
}

const isBasesLine = (p: HTMLElement) => /^\s*Bases:/.test(p.text);

function extractSphinx(root: HTMLElement, ids: Set<string>, out: Map<string, ExtractedSymbol>) {
  for (const dt of root.querySelectorAll('dt.sig[id]')) {
    const id = dt.id;
    if (!ids.has(id) || out.has(id)) continue;
    // The pilcrow permalink and the "[source]" link are chrome, not
    // signature.
    for (const chrome of dt.querySelectorAll('a.headerlink, .viewcode-link')) chrome.remove();
    const dd = dt.nextElementSibling?.tagName === 'DD' ? dt.nextElementSibling : null;
    const basesLine = dd?.childNodes.find(
      (n) => (n as HTMLElement).tagName === 'P' && isBasesLine(n as HTMLElement),
    ) as HTMLElement | undefined;
    out.set(id, {
      sig: clean(dt.text) || undefined,
      doc: firstParagraph(dd, isBasesLine),
      bases: linkedIds(basesLine, ids),
    });
  }
}

function extractMkdocstrings(
  root: HTMLElement,
  ids: Set<string>,
  out: Map<string, ExtractedSymbol>,
) {
  for (const heading of root.querySelectorAll('.doc-heading[id]')) {
    const id = heading.id;
    if (!ids.has(id) || out.has(id)) continue;
    let next = heading.nextElementSibling;
    let sig: string | undefined;
    if (next?.classList.contains('doc-signature')) {
      sig = clean(next.text) || undefined;
      next = next.nextElementSibling;
    }
    const contents = next?.classList.contains('doc-contents') ? next : null;
    const basesLine = contents?.querySelector(':scope > p.doc-class-bases');
    const bases = linkedIds(basesLine, ids);
    if (!sig && heading.querySelector('.doc-class-name')) {
      // Class headings carry no signature block unless the site merges
      // __init__ into the class; show the class line with its bases.
      const short = (name: string) => name.split('.').pop();
      sig = `class ${short(id)}${bases.length ? `(${bases.map(short).join(', ')})` : ''}`;
    }
    out.set(id, {
      sig,
      doc: firstParagraph(contents, (p) => p.classList.contains('doc-class-bases')),
      bases,
    });
  }
}

/**
 * Extract every documented symbol on one page.
 *
 * @param html The page's HTML.
 * @param ids The inventory's ids; only these are extracted.
 * @param out Accumulates results across pages; the first page to
 *   document an id wins.
 */
export function extractPage(html: string, ids: Set<string>, out: Map<string, ExtractedSymbol>) {
  if (!html.includes('sig-object') && !html.includes('doc-heading')) return;
  // <pre> must parse as elements: mkdocstrings signatures live in one.
  const root = parse(html, { blockTextElements: { script: true, style: true } });
  extractSphinx(root, ids, out);
  extractMkdocstrings(root, ids, out);
}
