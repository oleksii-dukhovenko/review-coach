import { useEffect } from "react";

// - anchor is a selector for the element at the top of the view.
export type ScrollSpot = { scrollY: number; anchor?: string; anchorTop?: number };

const SAVE_DELAY_MS = 200;
const PROBE_FROM_TOP_PX = 120;

function selectorFor(element: Element): string | undefined {
  const codeCell = element.closest("tr")?.querySelector<HTMLElement>("td.code[data-file]");
  if (codeCell) {
    const { file, line, side } = codeCell.dataset;
    return `td.code[data-file="${CSS.escape(file ?? "")}"][data-line="${line}"][data-side="${side}"]`;
  }
  const withId = element.closest("[id]");
  return withId?.id ? `#${CSS.escape(withId.id)}` : undefined;
}

function probePoint(): { x: number; y: number } {
  const main = document.querySelector(".review-main") ?? document.querySelector(".content");
  const left = main?.getBoundingClientRect().left ?? 0;
  return { x: left + 40, y: PROBE_FROM_TOP_PX };
}

/** Where you are now, tied to an element so later expansions do not throw it off. */
function currentSpot(): ScrollSpot {
  const { x, y } = probePoint();
  const element = document.elementFromPoint(x, y);
  const anchor = element ? selectorFor(element) : undefined;
  const anchorTop = anchor ? document.querySelector(anchor)?.getBoundingClientRect().top : undefined;
  return { scrollY: window.scrollY, anchor, anchorTop };
}

function saveSpotInThisEntry(): void {
  history.replaceState({ ...history.state, spot: currentSpot() }, "");
}

/** Call right before scrolling somewhere; the back button returns here. */
export function addHistoryStep(extraState: object = {}): void {
  saveSpotInThisEntry();
  history.pushState({ ...extraState, spot: null }, "");
}

function restoreSpot(spot: ScrollSpot): void {
  const element = spot.anchor ? document.querySelector(spot.anchor) : null;
  const isVisible = element instanceof HTMLElement && element.offsetParent !== null;
  if (isVisible && spot.anchorTop !== undefined) window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - spot.anchorTop);
  else window.scrollTo(0, spot.scrollY);
}

/** Keeps each history step's scroll spot current, and goes back to it on Back. */
export function useScrollHistory(): void {
  useEffect(() => {
    history.scrollRestoration = "manual";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const saveSoon = () => {
      clearTimeout(timer);
      timer = setTimeout(saveSpotInThisEntry, SAVE_DELAY_MS);
    };
    const restoreOnBack = (event: PopStateEvent) => {
      const spot = (event.state as { spot?: ScrollSpot } | null)?.spot;
      if (spot) requestAnimationFrame(() => restoreSpot(spot));
    };
    window.addEventListener("scroll", saveSoon, { passive: true });
    window.addEventListener("popstate", restoreOnBack);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", saveSoon);
      window.removeEventListener("popstate", restoreOnBack);
    };
  }, []);
}
