/**
 * Document-level runtime for the API hover experience.
 *
 * Mirrors Verso's client behavior for Lean docs:
 *  - hovering any element with `data-api-id` highlights every other element
 *    carrying the same id on the page (code blocks and prose mentions
 *    alike),
 *  - an IDE-style tooltip shows the symbol's signature and docstring
 *    summary, loaded lazily from a single JSON file the consumer serves.
 *
 * Event delegation at the document level means it works for both prism
 * tokens (annotated in CodeBlock/Line) and inline code in prose (annotated
 * at build time by the rehype companion), without any React wiring in
 * between.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { getInfoUrl, getInfoVersion } from '../lib/annotate';

interface ApiHoverInfoEntry {
  kind: string;
  sig?: string;
  doc?: string;
  url: string;
}

type ApiHoverInfo = Record<string, ApiHoverInfoEntry>;

let infoPromise: Promise<ApiHoverInfo> | undefined;
let infoCache: ApiHoverInfo | undefined;

function fetchInfoJson(): Promise<ApiHoverInfo> {
  infoPromise ??= fetch(`${getInfoUrl()}?v=${getInfoVersion()}`)
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

interface HoverState {
  id: string;
  rect: DOMRect;
}

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
 * tooltip hides, so the pointer can cross the gap into the tooltip and
 * reach its "View full reference" link.
 */
const HIDE_GRACE_MS = 300;
/**
 * How long a shown tooltip may wait for the info JSON before falling back
 * to a visible "Loading…" placeholder. The fetch starts at hover intent,
 * during the settle delay, so normally the content is ready immediately.
 */
const INFO_GRACE_MS = 600;

interface PendingShow {
  id: string;
  el: Element;
  timer: ReturnType<typeof setTimeout>;
  x: number;
  y: number;
}

export default function ApiHoverRuntime({ children }: { children: ReactNode }): ReactNode {
  const [hover, setHover] = useState<HoverState | null>(null);
  // undefined = loading, null = known-missing
  const [info, setInfo] = useState<ApiHoverInfoEntry | null | undefined>(undefined);
  const [graceElapsed, setGraceElapsed] = useState(false);
  // Measured tooltip height, kept in state so placement runs off the real
  // box instead of a guess. Bumped by layoutEpoch on viewport resize.
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingShow | null>(null);
  const shownIdRef = useRef<string | null>(null);
  const shownElRef = useRef<Element | null>(null);
  // Lets the tooltip's link hide it on click; `hide` lives inside the effect.
  const hideRef = useRef<() => void>(() => {});

  useEffect(() => {
    let currentEls: Element[] = [];
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    // Touch screens synthesize mouseover on tap; the underline affordance is
    // hidden there, so the tooltip should not appear either.
    const hoverCapable = window.matchMedia('(hover: hover)').matches;

    const clearHighlight = () => {
      for (const el of currentEls) el.classList.remove('api-hover-hl');
      currentEls = [];
    };

    const show = (el: Element, id: string) => {
      if (!hoverCapable) return;
      clearHighlight();
      shownIdRef.current = id;
      shownElRef.current = el;
      currentEls = Array.from(document.querySelectorAll(`[data-api-id="${CSS.escape(id)}"]`));
      for (const target of currentEls) target.classList.add('api-hover-hl');
      const rect = el.getBoundingClientRect();
      clearTimeout(graceTimer);
      setGraceElapsed(false);
      setHover({ id, rect });
      if (infoCache) {
        setInfo(infoCache[id] ?? null);
      } else {
        setInfo(undefined);
        // If the info arrives within the grace period the tooltip stays
        // unmounted until then, so it appears once, fully formed, instead
        // of popping in a "Loading…" stub first.
        fetchInfoJson()
          .then((data) => {
            infoCache = data;
            // Only apply if the user is still hovering this symbol.
            if (shownIdRef.current === id) {
              setInfo(data[id] ?? null);
            }
          })
          .catch(() => setInfo(null));
        graceTimer = setTimeout(() => {
          // Content too slow: show the placeholder rather than nothing.
          setGraceElapsed(true);
        }, INFO_GRACE_MS);
      }
    };

    const cancelPending = () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    };

    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const cancelHide = () => clearTimeout(hideTimer);

    const hide = () => {
      cancelPending();
      cancelHide();
      clearTimeout(graceTimer);
      setGraceElapsed(false);
      clearHighlight();
      shownIdRef.current = null;
      shownElRef.current = null;
      setHover(null);
    };
    hideRef.current = hide;

    /**
     * Leaving the token for the page (the 8px gap, or the tooltip's own
     * edge) schedules the hide instead of firing it immediately, so the
     * pointer can travel into the tooltip and reach the reference link.
     * Entering the tooltip (or another token) cancels the timer.
     */
    const scheduleHide = () => {
      cancelHide();
      hideTimer = setTimeout(hide, HIDE_GRACE_MS);
    };

    const onMouseOver = (e: MouseEvent) => {
      // The pointer entered the tooltip: it's being interacted with, not
      // abandoned. Never treat tooltip contents as a fresh symbol hover.
      if (tooltipRef.current?.contains(e.target as Node)) {
        cancelHide();
        return;
      }
      const el = (e.target as Element | null)?.closest?.('[data-api-id]') as Element | null;
      if (!el) return;
      const id = el.getAttribute('data-api-id');
      if (!id) return;
      // Moving straight from the token/tooltip to another symbol keeps
      // the current tooltip until the new one settles.
      cancelHide();
      if (id === shownIdRef.current) return;
      // Fresh target: restart the settle timer. If the pointer is really
      // resting, this fires; if it keeps moving, onMouseMove keeps pushing
      // the timer out so a pass-through never pops the tooltip.
      cancelPending();
      // Start loading the info now, during the settle delay, so the
      // tooltip can appear fully formed when the timer fires.
      if (!infoCache) void fetchInfoJson().catch(() => {});
      pendingRef.current = {
        id,
        el,
        x: e.clientX,
        y: e.clientY,
        timer: setTimeout(() => {
          pendingRef.current = null;
          show(el, id);
        }, HOVER_DELAY_MS),
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (tooltipRef.current?.contains(e.target as Node)) {
        cancelHide();
      }
      const pending = pendingRef.current;
      if (!pending) return;
      const moved = Math.abs(e.clientX - pending.x) + Math.abs(e.clientY - pending.y);
      if (moved > HOVER_MOVE_TOLERANCE_PX) {
        // Still in motion: delay until the pointer settles.
        clearTimeout(pending.timer);
        pending.x = e.clientX;
        pending.y = e.clientY;
        pending.timer = setTimeout(() => {
          pendingRef.current = null;
          if (pending.el.isConnected) show(pending.el, pending.id);
        }, HOVER_DELAY_MS);
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as Element | null;
      const fromToken = target?.closest?.('[data-api-id]');
      const fromTooltip = tooltipRef.current?.contains(target as Node);
      if (!fromToken && !fromTooltip) return;
      const to = e.relatedTarget as Element | null;
      if (to && (to.closest?.('[data-api-id]') || tooltipRef.current?.contains(to))) {
        // Still connected (token -> tooltip or tooltip -> token).
        cancelHide();
        return;
      }
      scheduleHide();
    };

    const onScroll = () => {
      // Follow the anchor token while the page scrolls instead of hiding.
      // A pending (not yet shown) hover is left alone: if scrolling moves
      // the token out from under the pointer, mouseout cancels it.
      const el = shownElRef.current;
      if (shownIdRef.current) {
        if (el && el.isConnected) {
          setHover((h) => (h ? { ...h, rect: el.getBoundingClientRect() } : h));
        } else {
          hide();
        }
      }
    };

    const onResize = () => {
      // Viewport size changed: re-anchor to the token and re-measure the
      // tooltip (its max-height is viewport-relative, so the box may resize).
      onScroll();
      setLayoutEpoch((e) => e + 1);
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseout', onMouseOut);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      cancelPending();
      cancelHide();
      clearTimeout(graceTimer);
      clearHighlight();
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // The fragment below must keep the same shape in every render (children,
  // then one portal slot). Swapping between a single child and an array of
  // two would change the implicit child keys and remount the whole page on
  // every hover state change. The tooltip also stays unmounted until its
  // content is ready (or the info grace period lapses), so it appears
  // fully formed instead of growing out of a "Loading…" stub.
  const tooltipActive =
    hover !== null && typeof document !== 'undefined' && (info !== undefined || graceElapsed);

  // Measure the real tooltip box before the browser paints, so placement is
  // computed off the actual height (which ranges from ~80px for a property
  // to several hundred for a class signature + docstring). Runs on mount,
  // when the content swaps in, and on viewport resize (layoutEpoch).
  useLayoutEffect(() => {
    const el = tooltipRef.current;
    if (tooltipActive && el) {
      setMeasuredHeight(el.offsetHeight);
    }
    if (!tooltipActive) {
      setMeasuredHeight(null);
    }
  }, [tooltipActive, info, layoutEpoch]);

  const { rect } = hover ?? { rect: null };
  const innerHeight = tooltipActive ? window.innerHeight : 0;
  const innerWidth = tooltipActive ? window.innerWidth : 0;
  const height = measuredHeight ?? TOOLTIP_ESTIMATED_HEIGHT;
  const belowTop = rect ? rect.bottom + TOOLTIP_MARGIN_PX : 0;
  // Prefer below the token; flip above when the real height doesn't fit.
  // The CSS max-height keeps the box inside the viewport, so the clamped
  // fallback above can cover the token but never leaves the screen.
  const top =
    belowTop + height <= innerHeight - TOOLTIP_MARGIN_PX
      ? belowTop
      : Math.max(TOOLTIP_MARGIN_PX, (rect?.top ?? 0) - TOOLTIP_MARGIN_PX - height);
  const maxWidth = Math.min(
    TOOLTIP_MAX_WIDTH,
    Math.max(TOOLTIP_MARGIN_PX, innerWidth - 2 * TOOLTIP_MARGIN_PX),
  );
  const left = rect
    ? Math.max(TOOLTIP_MARGIN_PX, Math.min(rect.left, innerWidth - maxWidth - TOOLTIP_MARGIN_PX))
    : TOOLTIP_MARGIN_PX;

  return (
    <>
      {children}
      {tooltipActive
        ? createPortal(
            <div ref={tooltipRef} className="api-hover-tooltip" style={{ top, left, maxWidth }}>
              <div className="api-hover-head">
                {info !== null && info !== undefined && (
                  <span className={`api-hover-kind api-hover-kind-${info.kind}`}>{info.kind}</span>
                )}
                <code className="api-hover-name">{hover!.id}</code>
              </div>
              {info === undefined ? (
                <div className="api-hover-doc">Loading…</div>
              ) : (
                <>
                  {info?.sig && (
                    <pre className="api-hover-sig">
                      <code>{info.sig}</code>
                    </pre>
                  )}
                  {info?.doc && <div className="api-hover-doc">{info.doc}</div>}
                  {info?.url && (
                    // Clicking the reference is a decisive act: close the
                    // tooltip so it can't linger over the page it jumps to
                    // (same-page anchor jumps keep the token connected, so
                    // the scroll handler would otherwise keep it open).
                    <a className="api-hover-link" href={info.url} onClick={() => hideRef.current()}>
                      View full reference →
                    </a>
                  )}
                </>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
