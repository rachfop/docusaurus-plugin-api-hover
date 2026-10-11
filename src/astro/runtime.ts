/**
 * Browser runtime for Astro/Blume sites: a framework-free port of the
 * Docusaurus theme's ApiHoverRuntime.tsx, behaviorally identical (same
 * settle delay, hide grace, info grace, placement math, highlight sync).
 *
 * initApiHover() loads the names JSON the site serves, builds the
 * resolution index, stamps the DOM (see annotate-dom), and attaches the
 * document-level listeners. Event delegation means the runtime works on
 * prose mentions and code blocks alike, no framework wiring between.
 */
import { buildApiHoverIndex, type ApiHoverIndex } from '../lib/annotate';
import { annotateDomDocument } from './annotate-dom';

/** The resolved config the browser entry receives. */
export interface ApiHoverClientConfig {
  /** URL the browser fetches the names JSON from. */
  namesUrl: string;
  /** URL the runtime fetches the info JSON from. */
  infoUrl: string;
  /** Id prefixes that win a short-name collision. */
  preferPrefixes: string[];
  /** Language modules to enable for code annotation. */
  languages: string[];
}

interface NamesJson {
  ids: string[];
  bases?: Record<string, string[]>;
  version?: string;
}

interface ApiHoverInfoEntry {
  /** Free-form label shown as a badge, e.g. "class" or "method". */
  kind: string;
  /** Signature shown in the tooltip's pre block. */
  sig?: string;
  /** Docstring summary line shown under the signature. */
  doc?: string;
  /** Link to the symbol's reference page. */
  url?: string;
}

type ApiHoverInfo = Record<string, ApiHoverInfoEntry>;

const TOOLTIP_MAX_WIDTH = 560;
/** Viewport margin kept clear around the tooltip, in px. */
const TOOLTIP_MARGIN_PX = 8;
/** Height assumed before the first measure; corrected before first paint. */
const TOOLTIP_ESTIMATED_HEIGHT = 240;
/** Tooltip delay: show after the pointer rests this long on a symbol. */
const HOVER_DELAY_MS = 240;
/** Pointer movement beyond this resets the delay (cursor "passing through"). */
const HOVER_MOVE_TOLERANCE_PX = 6;
/**
 * Grace period after the pointer leaves the token or tooltip before the
 * tooltip hides, so the pointer can cross the gap and reach its link.
 */
const HIDE_GRACE_MS = 300;
/**
 * How long a shown tooltip may wait for the info JSON before falling back
 * to a visible "Loading…" placeholder.
 */
const INFO_GRACE_MS = 600;

let infoUrl = '';
let infoVersion = '';
let infoPromise: Promise<ApiHoverInfo> | undefined;
let infoCache: ApiHoverInfo | undefined;

function fetchInfoJson(): Promise<ApiHoverInfo> {
  infoPromise ??= fetch(`${infoUrl}?v=${infoVersion}`)
    .then((resp) => {
      if (!resp.ok) throw new Error(`api-hover: HTTP ${resp.status}`);
      return resp.json() as Promise<ApiHoverInfo>;
    })
    .catch((err) => {
      // A transient failure (dev server restart, deploy skew) must not
      // poison every later hover: drop the cached rejection so the next
      // hover retries the fetch.
      infoPromise = undefined;
      throw err;
    });
  return infoPromise;
}

async function fetchNames(namesUrl: string): Promise<NamesJson | undefined> {
  try {
    const resp = await fetch(namesUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as NamesJson;
    if (!Array.isArray(data.ids) || data.ids.length === 0) {
      console.warn('api-hover: names JSON holds no ids; hover disabled.');
      return undefined;
    }
    return data;
  } catch (err) {
    console.warn(
      `api-hover: names JSON unavailable at "${namesUrl}" (${err instanceof Error ? err.message : err}); hover disabled.`,
    );
    return undefined;
  }
}

interface PendingShow {
  id: string;
  el: Element;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
}

let started = false;
let hoverCapable = false;
let pending: PendingShow | null = null;
let shownId: string | null = null;
let shownEl: Element | null = null;
let highlightEls: Element[] = [];
let tooltip: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let graceTimer: ReturnType<typeof setTimeout> | undefined;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Build (or rebuild) the tooltip for the shown symbol and place it against
 * the anchor token. Mirrors the React version's render: no badge when the
 * info is known-missing, "Loading…" while undefined, and the reference
 * link only when the entry carries a url.
 */
function renderTooltip(
  id: string,
  info: ApiHoverInfoEntry | null | undefined,
  anchor: Element,
): void {
  tooltip ??= document.createElement('div');
  const el = tooltip;
  const badge =
    info !== null && info !== undefined
      ? `<span class="api-hover-kind api-hover-kind-${escapeHtml(info.kind)}">${escapeHtml(info.kind)}</span>`
      : '';
  let body: string;
  if (info === undefined) {
    body = '<div class="api-hover-doc">Loading…</div>';
  } else {
    body =
      (info?.sig ? `<pre class="api-hover-sig"><code>${escapeHtml(info.sig)}</code></pre>` : '') +
      (info?.doc ? `<div class="api-hover-doc">${escapeHtml(info.doc)}</div>` : '') +
      (info?.url
        ? `<a class="api-hover-link" href="${escapeHtml(info.url)}">View full reference →</a>`
        : '');
  }
  el.className = 'api-hover-tooltip';
  el.innerHTML = `<div class="api-hover-head">${badge}<code class="api-hover-name">${escapeHtml(id)}</code></div>${body}`;
  const link = el.querySelector<HTMLAnchorElement>('.api-hover-link');
  // Clicking the reference is a decisive act: close the tooltip so it
  // can't linger over the page it jumps to.
  link?.addEventListener('click', () => hide());
  document.body.append(el);
  placeTooltip(anchor);
}

/** Position the tooltip against its anchor token. Must run after the
 * content is set: offsetHeight is the real measured height. */
function placeTooltip(anchor: Element): void {
  if (!tooltip) return;
  const rect = anchor.getBoundingClientRect();
  const { innerHeight, innerWidth } = window;
  const height = tooltip.offsetHeight || TOOLTIP_ESTIMATED_HEIGHT;
  // Prefer below the token; flip above when the real height doesn't fit.
  const belowTop = rect.bottom + TOOLTIP_MARGIN_PX;
  const top =
    belowTop + height <= innerHeight - TOOLTIP_MARGIN_PX
      ? belowTop
      : Math.max(TOOLTIP_MARGIN_PX, rect.top - TOOLTIP_MARGIN_PX - height);
  const maxWidth = Math.min(
    TOOLTIP_MAX_WIDTH,
    Math.max(TOOLTIP_MARGIN_PX, innerWidth - 2 * TOOLTIP_MARGIN_PX),
  );
  const left = Math.max(
    TOOLTIP_MARGIN_PX,
    Math.min(rect.left, innerWidth - maxWidth - TOOLTIP_MARGIN_PX),
  );
  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.maxWidth = `${maxWidth}px`;
}

function destroyTooltip(): void {
  tooltip?.remove();
  tooltip = null;
}

function clearHighlight(): void {
  for (const el of highlightEls) el.classList.remove('api-hover-hl');
  highlightEls = [];
}

function show(el: Element, id: string): void {
  // Touch screens synthesize mouseover on tap; the underline affordance
  // is hidden there, so the tooltip should not appear either.
  if (!hoverCapable) return;
  clearHighlight();
  shownId = id;
  shownEl = el;
  highlightEls = Array.from(document.querySelectorAll(`[data-api-id="${CSS.escape(id)}"]`));
  for (const target of highlightEls) target.classList.add('api-hover-hl');
  destroyTooltip();
  clearTimeout(graceTimer);
  if (infoCache) {
    renderTooltip(id, infoCache[id] ?? null, el);
  } else {
    // If the info arrives within the grace period the tooltip stays
    // unmounted until then, so it appears once, fully formed.
    void fetchInfoJson()
      .then((data) => {
        infoCache = data;
        // Only apply if the user is still hovering this symbol.
        if (shownId === id) renderTooltip(id, data[id] ?? null, el);
      })
      .catch(() => {
        if (shownId === id) renderTooltip(id, null, el);
      });
    graceTimer = setTimeout(() => {
      // Content too slow: show the placeholder rather than nothing.
      if (shownId === id && !tooltip) renderTooltip(id, undefined, el);
    }, INFO_GRACE_MS);
  }
}

function hide(): void {
  cancelPending();
  cancelHide();
  clearTimeout(graceTimer);
  clearHighlight();
  shownId = null;
  shownEl = null;
  destroyTooltip();
}

function cancelPending(): void {
  if (pending) {
    clearTimeout(pending.timer);
    pending = null;
  }
}

function cancelHide(): void {
  clearTimeout(hideTimer);
}

/** Leaving the token (or the tooltip's own edge) schedules the hide with
 * a grace period, so the pointer can travel to the reference link. */
function scheduleHide(): void {
  cancelHide();
  hideTimer = setTimeout(hide, HIDE_GRACE_MS);
}

function inTooltip(target: Node | null): boolean {
  return !!tooltip?.contains(target);
}

function onMouseOver(e: MouseEvent): void {
  // The pointer entered the tooltip: it's being interacted with, not
  // abandoned. Never treat tooltip contents as a fresh symbol hover.
  if (inTooltip(e.target as Node)) {
    cancelHide();
    return;
  }
  const el = (e.target as Element | null)?.closest?.('[data-api-id]') as Element | null;
  if (!el) return;
  const id = el.getAttribute('data-api-id');
  if (!id) return;
  // Moving straight from the token/tooltip to another symbol keeps the
  // current tooltip until the new one settles.
  cancelHide();
  if (id === shownId) return;
  // Fresh target: restart the settle timer. If the pointer is really
  // resting, this fires; if it keeps moving, onMouseMove keeps pushing
  // the timer out so a pass-through never pops the tooltip.
  cancelPending();
  // Start loading the info now, during the settle delay, so the tooltip
  // can appear fully formed when the timer fires.
  if (!infoCache) void fetchInfoJson().catch(() => {});
  pending = {
    id,
    el,
    x: e.clientX,
    y: e.clientY,
    timer: setTimeout(() => {
      pending = null;
      show(el, id);
    }, HOVER_DELAY_MS),
  };
}

function onMouseMove(e: MouseEvent): void {
  if (inTooltip(e.target as Node)) cancelHide();
  const p = pending;
  if (!p) return;
  const moved = Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
  if (moved > HOVER_MOVE_TOLERANCE_PX) {
    // Still in motion: delay until the pointer settles.
    clearTimeout(p.timer);
    p.x = e.clientX;
    p.y = e.clientY;
    p.timer = setTimeout(() => {
      pending = null;
      if (p.el.isConnected) show(p.el, p.id);
    }, HOVER_DELAY_MS);
  }
}

function onMouseOut(e: MouseEvent): void {
  const target = e.target as Element | null;
  const fromToken = target?.closest?.('[data-api-id]');
  const fromTooltip = inTooltip(target);
  if (!fromToken && !fromTooltip) return;
  const to = e.relatedTarget as Element | null;
  if (to && (to.closest?.('[data-api-id]') || inTooltip(to))) {
    // Still connected (token -> tooltip or tooltip -> token).
    cancelHide();
    return;
  }
  scheduleHide();
}

function onScroll(): void {
  // Follow the anchor token while the page scrolls. A pending (not yet
  // shown) hover is left alone: if scrolling moves the token out from
  // under the pointer, mouseout cancels it.
  if (!shownId) return;
  if (shownEl?.isConnected) {
    placeTooltip(shownEl);
  } else {
    hide();
  }
}

function onResize(): void {
  // Viewport size changed: re-anchor to the token and re-measure the
  // tooltip (its max-height is viewport-relative, so the box may resize).
  onScroll();
}

function attachListeners(): void {
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseout', onMouseOut);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onResize, { passive: true });
}

/**
 * Boot the runtime: load the names JSON, annotate the current document,
 * and wire the hover listeners. A second call (dev-server module reuse,
 * repeated page loads) is a no-op beyond re-annotating.
 */
export async function initApiHover(config: ApiHoverClientConfig): Promise<void> {
  const data = await fetchNames(config.namesUrl);
  if (!data) return;
  const index: ApiHoverIndex = buildApiHoverIndex(
    data.ids,
    data.bases ?? {},
    config.preferPrefixes ?? [],
  );
  if (!started) {
    started = true;
    infoUrl = config.infoUrl;
    infoVersion = data.version ?? '';
    hoverCapable = window.matchMedia('(hover: hover)').matches;
    attachListeners();
  }
  annotateDomDocument(index, config.languages);
  // Astro view transitions replace the page content without a reload;
  // the document-level listeners survive, the annotations don't.
  window.addEventListener('astro:page-load', () => {
    annotateDomDocument(index, config.languages);
  });
}
