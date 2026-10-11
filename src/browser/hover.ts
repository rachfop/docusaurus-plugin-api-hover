/**
 * The hover runtime every adapter shares: hovering (or keyboard-focusing)
 * any element with `data-api-id` highlights every element carrying the
 * same id on the page and opens an IDE-style tooltip with the symbol's
 * signature and docstring summary, loaded lazily from the info JSON.
 *
 * Framework-free and driven by document-level event delegation, so it
 * works on prose mentions and code blocks alike whether the ids were
 * stamped at build time (Docusaurus) or in the browser (every other site).
 */

export interface HoverConfig {
  /** Absolute or page-relative URL of the info JSON. */
  infoUrl: string;
  /** Appended to the info fetch as `?v=` to bust stale caches. */
  version?: string;
}

interface InfoEntry {
  /** Free-form label shown as a badge, e.g. "class" or "method". */
  kind: string;
  /** Signature shown in the tooltip's pre block. */
  sig?: string;
  /** Docstring summary line shown under the signature. */
  doc?: string;
  /** Link to the symbol's reference page, relative to the info JSON. */
  url?: string;
}

type InfoJson = Record<string, InfoEntry>;

const TOOLTIP_ID = 'quickinfo-tooltip';
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
 * to a visible "Loading…" placeholder. The fetch starts at hover intent,
 * during the settle delay, so the placeholder appears only when the fetch
 * outruns the grace period.
 */
const INFO_GRACE_MS = 600;

let infoUrl = '';
let infoVersion = '';
let infoPromise: Promise<InfoJson> | undefined;
let infoCache: InfoJson | undefined;

/** The info JSON's absolute URL: entry urls resolve against it. */
function infoHref(): string {
  const url = new URL(infoUrl, document.baseURI);
  if (infoVersion) url.searchParams.set('v', infoVersion);
  return url.href;
}

function fetchInfoJson(): Promise<InfoJson> {
  infoPromise ??= fetch(infoHref())
    .then((resp) => {
      if (!resp.ok) throw new Error(`quickinfo: HTTP ${resp.status}`);
      return resp.json() as Promise<InfoJson>;
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
/** The shown tooltip was opened by keyboard focus, not the pointer. */
let shownByFocus = false;
/** The element whose keyboard focus opened the tooltip. */
let focusOrigin: Element | null = null;
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

/** Entry urls that are relative paths resolve against the info JSON, so
 * one file serves every page depth; root-relative ones (`/api/...`) name a
 * path on this site, even when the info JSON is served from a CDN. Only
 * http(s) results are linked. */
function entryHref(url: string): string | undefined {
  try {
    const base = url.startsWith('/') && !url.startsWith('//') ? document.baseURI : infoHref();
    const href = new URL(url, base);
    return href.protocol === 'http:' || href.protocol === 'https:' ? href.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build (or rebuild) the tooltip for the shown symbol and place it against
 * the anchor token: no badge when the info is known-missing, "Loading…"
 * while undefined, and the reference link only when the entry carries a
 * url.
 */
function renderTooltip(id: string, info: InfoEntry | null | undefined, anchor: Element): void {
  tooltip ??= document.createElement('div');
  const el = tooltip;
  const badge =
    info !== null && info !== undefined
      ? `<span class="quickinfo-kind quickinfo-kind-${escapeHtml(info.kind)}">${escapeHtml(info.kind)}</span>`
      : '';
  const href = info?.url ? entryHref(info.url) : undefined;
  let body: string;
  if (info === undefined) {
    body = '<div class="quickinfo-doc">Loading…</div>';
  } else {
    body =
      (info?.sig ? `<pre class="quickinfo-sig"><code>${escapeHtml(info.sig)}</code></pre>` : '') +
      (info?.doc ? `<div class="quickinfo-doc">${escapeHtml(info.doc)}</div>` : '') +
      (href
        ? `<a class="quickinfo-link" href="${escapeHtml(href)}">View full reference →</a>`
        : '');
  }
  el.id = TOOLTIP_ID;
  el.className = 'quickinfo-tooltip';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = `<div class="quickinfo-head">${badge}<code class="quickinfo-name">${escapeHtml(id)}</code></div>${body}`;
  const link = el.querySelector<HTMLAnchorElement>('.quickinfo-link');
  // Clicking the reference is a decisive act: close the tooltip so it
  // can't linger over the page it jumps to.
  link?.addEventListener('click', () => hide());
  document.body.append(el);
  for (const stale of Array.from(document.querySelectorAll(`[aria-describedby="${TOOLTIP_ID}"]`))) {
    stale.removeAttribute('aria-describedby');
  }
  anchor.setAttribute('aria-describedby', TOOLTIP_ID);
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
  // The CSS max-height keeps the box inside the viewport, so the clamped
  // fallback above can cover the token but never leaves the screen.
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
  for (const el of highlightEls) el.classList.remove('quickinfo-hl');
  highlightEls = [];
  shownEl?.removeAttribute('aria-describedby');
}

function show(el: Element, id: string, byFocus = false): void {
  clearHighlight();
  shownId = id;
  shownEl = el;
  shownByFocus = byFocus;
  highlightEls = Array.from(document.querySelectorAll(`[data-api-id="${CSS.escape(id)}"]`));
  for (const target of highlightEls) target.classList.add('quickinfo-hl');
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
        // Only apply if the user is still on this symbol.
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
  shownByFocus = false;
  focusOrigin = null;
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
  // Touch screens synthesize mouseover on tap; the underline affordance
  // is hidden there, so the tooltip should not appear either.
  if (!hoverCapable) return;
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
  if (id === shownId) {
    // Back on the shown token: a pending timer armed for another symbol
    // must die, or its tooltip would pop while the pointer rests here.
    cancelPending();
    return;
  }
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
      // A page swap (client-side navigation, a re-render) can remove the
      // token during the settle delay; the token is gone, so is the hover.
      if (el.isConnected) show(el, id);
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
  // Off the token entirely: the pending settle timer dies with it, or
  // the tooltip would pop under a pointer resting on plain text. A
  // tooltip opened by keyboard focus stays until focus moves.
  cancelPending();
  if (!shownByFocus) scheduleHide();
}

/**
 * The annotated element a focus target stands for: the target itself, an
 * annotated ancestor, or an annotated descendant (a link wrapping
 * `<code data-api-id>`, the common shape of a prose cross-reference).
 */
function focusAnchor(target: Element): Element | null {
  // Links and buttons only: a focusable code block (`<pre tabindex="0">`)
  // contains many symbols and stands for none of them.
  return (
    target.closest('[data-api-id]') ??
    (target.matches('a, button') ? target.querySelector('[data-api-id]') : null)
  );
}

function onFocusIn(e: FocusEvent): void {
  const target = e.target as Element | null;
  if (!target || inTooltip(target)) return;
  // Keyboard focus only: a tap or click also focuses links, and the
  // tooltip should follow the pointer rules there.
  if (!target.matches(':focus-visible')) return;
  const el = focusAnchor(target);
  const id = el?.getAttribute('data-api-id');
  if (!el || !id) return;
  cancelPending();
  cancelHide();
  // No settle delay: focus is a deliberate act.
  show(el, id, true);
  focusOrigin = target;
}

function onFocusOut(e: FocusEvent): void {
  if (!shownByFocus) return;
  // Tabbing into the tooltip's own link keeps it open.
  if (inTooltip(e.relatedTarget as Node | null)) return;
  hide();
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** The focusable element after (or before) `from` in document order,
 * outside the tooltip. */
function nextFocusable(from: Element, backward: boolean): HTMLElement | undefined {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !inTooltip(el),
  );
  const at = all.indexOf(from as HTMLElement);
  return at < 0 ? undefined : all[at + (backward ? -1 : 1)];
}

/**
 * Escape dismisses the tooltip without moving the pointer (WCAG 1.4.13).
 * Tab from the mention that opened a tooltip moves into the tooltip's
 * reference link, and Tab from there continues after the mention: the
 * tooltip sits at the end of <body>, out of the page's tab order.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && (shownId || pending)) {
    hide();
    return;
  }
  if (e.key !== 'Tab' || !shownByFocus || !focusOrigin) return;
  const link = tooltip?.querySelector<HTMLAnchorElement>('.quickinfo-link');
  const active = document.activeElement;
  if (!e.shiftKey && link && active === focusOrigin) {
    e.preventDefault();
    link.focus();
  } else if (link && active === link) {
    e.preventDefault();
    const origin = focusOrigin;
    const next = e.shiftKey ? (origin as HTMLElement) : nextFocusable(origin, false);
    hide();
    next?.focus();
  }
}

/**
 * Attach the hover runtime to the document. Idempotent: later calls (a
 * second adapter, dev-server module reuse) keep the first configuration.
 *
 * @param config Where the info JSON lives.
 */
export function startHover(config: HoverConfig): void {
  if (started) return;
  started = true;
  infoUrl = config.infoUrl;
  infoVersion = config.version ?? '';
  hoverCapable = window.matchMedia('(hover: hover)').matches;
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('mouseover', onMouseOver);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseout', onMouseOut);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  // Viewport size changed: re-anchor to the token and re-measure the
  // tooltip (its max-height is viewport-relative, so the box may resize).
  window.addEventListener('resize', onScroll, { passive: true });
}

/** Whether a node belongs to the tooltip; the DOM annotator ignores it. */
export function isTooltipNode(node: Node): boolean {
  return inTooltip(node);
}
