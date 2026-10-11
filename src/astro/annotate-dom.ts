/**
 * DOM annotation for Astro/Blume sites: the browser-side twin of the
 * build-time prism annotator (annotateLines) and the rehype prose pass.
 *
 * Prose mentions are simple: an inline <code> element whose text resolves
 * against the index gets data-api-id on the element, exactly as the
 * rehype pass stamps it at build time.
 *
 * Code blocks are harder: Shiki (what Sätteri and Astro's Markdown
 * pipelines render code with) colors spans inline and carries no token
 * types, so there is no prism token stream to annotate. Instead the
 * annotator reads the code element's text, computes which identifier
 * ranges resolve (same chain walk as annotateLineTokens, with
 * comment/string regions supplied by pythonSkipRegions since there are no
 * prism types to skip), and wraps those ranges in <span data-api-id>
 * without disturbing the highlighting spans around them.
 */
import {
  getSnippetContext,
  resolveDotted,
  resolveProseMention,
  type ApiHoverIndex,
} from '../lib/annotate';
import { isPythonLanguage, pythonSkipRegions } from '../lib/python';

const IDENT_SPLIT_RE = /([A-Za-z_][A-Za-z0-9_]*)/;
const PIECE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface TextPiece {
  node: Text;
  start: number;
  end: number;
  text: string;
  /** Comment/string pieces break dotted chains, like skip tokens do. */
  skip: boolean;
}

export function annotateDomDocument(index: ApiHoverIndex, languages: string[]): void {
  annotateProseMentions(index);
  if (languages.includes('python')) {
    annotatePythonBlocks(index);
  }
}

/** Inline <code> mentions in prose, resolved exactly like the rehype pass. */
function annotateProseMentions(index: ApiHoverIndex): void {
  for (const el of Array.from(document.querySelectorAll('code'))) {
    if (el.closest('pre')) continue;
    if (el.hasAttribute('data-api-id')) continue;
    const text = (el.textContent ?? '').trim();
    if (!text) continue;
    const id = resolveProseMention(text, index);
    if (id) el.setAttribute('data-api-id', id);
  }
}

function blockLanguage(pre: Element, code: Element): string | undefined {
  // Sätteri/Shiki output carries data-language on the <pre>; plain Astro
  // adds a language-* class on the <code> instead. Read both.
  const fromAttr = pre.getAttribute('data-language');
  if (fromAttr) return fromAttr;
  const match = (code.className || '').match(/(?:^|\s)language-([\w+-]+)/);
  return match?.[1];
}

function annotatePythonBlocks(index: ApiHoverIndex): void {
  for (const pre of Array.from(document.querySelectorAll('pre'))) {
    const code = pre.querySelector(':scope > code');
    if (!code) continue;
    // Idempotence: a block annotated by a previous run stays untouched.
    if (pre.querySelector('[data-api-id]')) continue;
    if (!isPythonLanguage(blockLanguage(pre, code))) continue;
    annotatePythonCode(code, index);
  }
}

function annotatePythonCode(code: Element, index: ApiHoverIndex): void {
  const text = code.textContent ?? '';
  if (!text.trim()) return;
  const ctx = getSnippetContext(text, index);
  const skipRegions = pythonSkipRegions(text);
  const inSkip = (start: number, end: number): boolean =>
    skipRegions.some(([s, e]) => start < e && s < end);

  // 1. Split every text node (at any highlighting-span depth) into pieces,
  //    with offsets into the code element's full text.
  const pieces: TextPiece[] = [];
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const value = node.nodeValue ?? '';
    let pos = offset;
    for (const part of value.split(IDENT_SPLIT_RE)) {
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
    offset += value.length;
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
  //    offsets stay valid while the node is split.
  const byNode = new Map<Text, typeof wraps>();
  for (const w of wraps) {
    const bucket = byNode.get(w.node);
    if (bucket) bucket.push(w);
    else byNode.set(w.node, [w]);
  }
  for (const [node, ranges] of byNode) {
    ranges.sort((a, b) => b.start - a.start);
    for (const w of ranges) {
      node.splitText(w.end);
      const target = node.splitText(w.start);
      const span = document.createElement('span');
      span.setAttribute('data-api-id', w.id);
      target.replaceWith(span);
      span.append(target);
    }
  }
}
