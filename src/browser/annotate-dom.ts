/**
 * DOM annotation for every site without build-time annotation (Astro,
 * Blume, Sphinx, MkDocs, plain HTML): the browser-side twin of the prism
 * annotator (annotateLines) and the rehype prose pass.
 *
 * Links come first: a link whose href names a symbol (Sphinx and
 * mkdocstrings cross-references point at `page.html#pkg.mod.Name`) stamps
 * its id onto the inline code inside it, or onto the link itself.
 *
 * Inline code in prose resolves by name, the same way the rehype pass
 * does at build time.
 *
 * Code blocks are harder: highlighters (Shiki, Pygments, highlight.js)
 * color spans inline and carry no token types, so there is no token
 * stream to annotate. The annotator reads the block's text, computes which
 * identifier ranges resolve (the chain walk of annotateLineTokens, with
 * comment/string regions from pythonSkipRegions), and wraps those ranges
 * in <span data-api-id> without disturbing the highlighting spans.
 */
import {
  getSnippetContext,
  resolveDotted,
  isExternalHref,
  resolveHref,
  resolveProseMention,
  type SymbolIndex,
} from '../lib/annotate';
import { isPythonLanguage, pythonSkipRegions } from '../lib/python';

export interface AnnotateOptions {
  /** Language modules to enable for code annotation. */
  languages: string[];
  /** Language assumed for code blocks that carry no language marker. */
  defaultLanguage?: string;
}

const IDENT_SPLIT_RE = /([A-Za-z_][A-Za-z0-9_]*)/;
const PIECE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Language markers on a block or its wrappers: Prism/Shiki/highlight.js
 * (`language-py`, `lang-py`) and Sphinx's Pygments (`highlight-python`). */
const LANG_CLASS_RE = /(?:^|\s)(?:language|lang|highlight)-([\w+-]+)/;
/**
 * Site chrome whose links and inline code stay plain: tables of contents
 * and sidebars link every symbol on the page, and underlining them all
 * would bury the prose mentions. Named per theme, since content callouts
 * use the same <aside> element: Blume, Docusaurus, Starlight, Sphinx
 * (Furo, Read the Docs, PyData, Book), and MkDocs Material.
 */
const CHROME_SELECTOR = [
  'nav',
  '[role="navigation"]',
  '[data-blume-header]',
  '[data-blume-toc]',
  '[data-blume-nav-drawer]',
  '.table-of-contents',
  '.theme-doc-sidebar-container',
  'starlight-toc',
  'mobile-starlight-toc',
  '.sidebar-pane',
  '.right-sidebar',
  '.sidebar-drawer',
  '.toc-drawer',
  '.toctree-wrapper',
  '.wy-nav-side',
  '.bd-sidebar-primary',
  '.bd-sidebar-secondary',
  '.md-sidebar',
  '.md-header',
  '.md-footer',
].join(', ');

/** Line-number gutters inline with the code (Pygments `linenos`, Material
 * `data-linenos`): never part of the source text. */
const LINE_NUMBER_SELECTOR = '.linenos, .lineno, [data-linenos]';

interface TextPiece {
  node: Text;
  start: number;
  end: number;
  text: string;
  /** Comment/string pieces break dotted chains, like skip tokens do. */
  skip: boolean;
}

/**
 * Code roots already annotated, keyed to their first child at that time.
 * A highlighter that runs later (highlight.js on DOMContentLoaded)
 * replaces the children, which changes the first child and re-arms the
 * block; untouched blocks are never re-scanned.
 */
const annotatedBlocks = new WeakMap<Element, Node | null>();
/** Inline code already resolved (hit or miss): prose is resolved once. */
const resolvedMentions = new WeakSet<Element>();

/**
 * Annotate everything under `root`: links, inline code, code blocks.
 * Idempotent, so it can run again after any DOM change.
 *
 * @param index The resolution index.
 * @param options Enabled languages and the default block language.
 * @param root Where to look; defaults to the whole document.
 */
export function annotateDocument(
  index: SymbolIndex,
  options: AnnotateOptions,
  root: ParentNode = document,
): void {
  annotateLinks(index, root);
  annotateInlineCode(index, root);
  if (options.languages.includes('python')) annotateCodeBlocks(index, options, root);
}

function annotateLinks(index: SymbolIndex, root: ParentNode): void {
  for (const link of Array.from(root.querySelectorAll('a[href]'))) {
    if (link.closest('pre') || link.hasAttribute('data-api-id') || link.closest(CHROME_SELECTOR)) {
      continue;
    }
    const href = link.getAttribute('href') ?? '';
    const id = resolveHref(href, index);
    const codes = Array.from(link.querySelectorAll('code'));
    // A link to a symbol names it, even when the bare name is ambiguous. A
    // link to another site (docs.python.org, another language's reference)
    // means the mention is that site's symbol, so its inline code stays
    // plain. Inline code in other same-site links resolves by name below.
    for (const code of codes) {
      if (id) {
        resolvedMentions.add(code);
        if (!code.hasAttribute('data-api-id')) code.setAttribute('data-api-id', id);
      } else if (isExternalHref(href)) {
        resolvedMentions.add(code);
      }
    }
    if (!id || codes.length > 0) continue;
    // A bare link (mkdocstrings autorefs, signature type links): annotate
    // it when its text names the symbol, so "Device" links the class but
    // "see the device docs" stays a plain link.
    const text = (link.textContent ?? '').trim().replace(/\(\)$/, '');
    if (text === id || text === id.split('.').pop()) link.setAttribute('data-api-id', id);
  }
}

function annotateInlineCode(index: SymbolIndex, root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll('code'))) {
    if (resolvedMentions.has(el)) continue;
    resolvedMentions.add(el);
    if (el.closest('pre') || el.hasAttribute('data-api-id') || el.closest(CHROME_SELECTOR))
      continue;
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    const id = resolveProseMention(text, index);
    if (id) el.setAttribute('data-api-id', id);
  }
}

/** The block's language tag, from the first marker found on the code
 * element, the pre, or a wrapper. */
function blockLanguage(pre: Element, code: Element | null): string | undefined {
  const fromAttr = pre.getAttribute('data-language') ?? code?.getAttribute('data-lang');
  if (fromAttr) return fromAttr;
  // mkdocstrings' Python handler renders signatures without a language
  // class.
  if (pre.closest('.doc-signature')) return 'python';
  let el: Element | null = code ?? pre;
  // Material's `linenums` tables put the marker seven levels above <code>.
  for (let depth = 0; el && depth < 10; depth++, el = el.parentElement) {
    const match = (el.getAttribute('class') ?? '').match(LANG_CLASS_RE);
    // Sphinx's `highlight-default` is its default lexer, Python.
    if (match) return match[1] === 'default' ? 'python' : match[1];
  }
  return undefined;
}

function annotateCodeBlocks(index: SymbolIndex, options: AnnotateOptions, root: ParentNode): void {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    // Pygments puts tokens straight into <pre>; everyone else nests <code>.
    const code = pre.querySelector(':scope > code');
    const block = code ?? pre;
    if (annotatedBlocks.has(block) && annotatedBlocks.get(block) === block.firstChild) continue;
    // Line-number gutters (Pygments `linenos`) hold digits only.
    if (pre.closest('.linenos, .linenodiv')) continue;
    const language = blockLanguage(pre, code) ?? options.defaultLanguage;
    if (!isPythonLanguage(language)) continue;
    if (!block.querySelector('[data-api-id]')) annotatePythonCode(block, index);
    annotatedBlocks.set(block, block.firstChild);
  }
}

/**
 * The block's source text and the text nodes it came from, each with its
 * offset into that text. Line-number gutters are left out, and a line
 * break is supplied between line elements that carry none in their text
 * (Expressive Code renders each line as a <div> with no newline).
 */
function blockText(code: Element): { text: string; nodes: Array<[Text, number]> } {
  const nodes: Array<[Text, number]> = [];
  let text = '';
  let lastLine: Element | null = null;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (parent?.closest(LINE_NUMBER_SELECTOR)) continue;
    let line: Element | null = parent;
    while (line && line.parentElement !== code) line = line.parentElement;
    if (line?.tagName !== 'DIV') line = null;
    if (line && lastLine && line !== lastLine && !text.endsWith('\n')) text += '\n';
    if (line) lastLine = line;
    nodes.push([node, text.length]);
    text += node.nodeValue ?? '';
  }
  return { text, nodes };
}

function annotatePythonCode(code: Element, index: SymbolIndex): void {
  const { text, nodes } = blockText(code);
  if (!text.trim()) return;
  const ctx = getSnippetContext(text, index);
  const skipRegions = pythonSkipRegions(text);
  const inSkip = (start: number, end: number): boolean =>
    skipRegions.some(([s, e]) => start < e && s < end);

  // 1. Split every text node (at any highlighting-span depth) into pieces,
  //    with offsets into the block's source text.
  const pieces: TextPiece[] = [];
  const nodeStart = new Map<Text, number>();
  for (const [node, offset] of nodes) {
    nodeStart.set(node, offset);
    let pos = offset;
    for (const part of (node.nodeValue ?? '').split(IDENT_SPLIT_RE)) {
      if (part) {
        pieces.push({
          node,
          start: pos,
          end: pos + part.length,
          text: part,
          skip: inSkip(pos, pos + part.length),
        });
      }
      pos += part.length;
    }
  }

  // 2. Walk dotted chains and resolve each identifier piece, the same
  //    chain walk as annotateLineTokens.
  const wraps: Array<{ node: Text; start: number; end: number; id: string }> = [];
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i]!;
    if (piece.skip || !PIECE_IDENT_RE.test(piece.text)) {
      i++;
      continue;
    }
    const identIdx = [i];
    let j = i + 1;
    while (
      j + 1 < pieces.length &&
      !pieces[j]!.skip &&
      pieces[j]!.text === '.' &&
      !pieces[j + 1]!.skip &&
      PIECE_IDENT_RE.test(pieces[j + 1]!.text)
    ) {
      identIdx.push(j + 1);
      j += 2;
    }
    let name = '';
    for (const idx of identIdx) {
      const p = pieces[idx]!;
      name = name ? `${name}.${p.text}` : p.text;
      const id = resolveDotted(name, ctx.aliases, ctx.locals, ctx.binds, index);
      if (id) wraps.push({ node: p.node, start: p.start, end: p.end, id });
    }
    i = j;
  }

  // 3. Apply the wraps, back-to-front within each text node so earlier
  //    offsets stay valid while the node is split. splitText takes an
  //    index relative to the node's own text, while the wrap offsets are
  //    absolute in the code element, so subtract the node's start.
  const byNode = new Map<Text, typeof wraps>();
  for (const w of wraps) {
    const bucket = byNode.get(w.node);
    if (bucket) bucket.push(w);
    else byNode.set(w.node, [w]);
  }
  for (const [node, ranges] of byNode) {
    const base = nodeStart.get(node) ?? 0;
    ranges.sort((a, b) => b.start - a.start);
    for (const w of ranges) {
      node.splitText(w.end - base);
      const target = node.splitText(w.start - base);
      const span = document.createElement('span');
      span.setAttribute('data-api-id', w.id);
      target.replaceWith(span);
      span.append(target);
    }
  }
}
