import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

const STILLNESS = "(prefers-reduced-motion: reduce)";

function asksForStillness(): boolean {
  return window.matchMedia(STILLNESS).matches;
}

function watchStillness(changed: () => void): () => void {
  const query = window.matchMedia(STILLNESS);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** True when the reader asked for less motion. */
export function useStillness(): boolean {
  return useSyncExternalStore(watchStillness, asksForStillness, () => false);
}

/** True while the element is at least partly on screen. */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [isOnScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // - The newest entry wins when one callback carries several.
    const observer = new IntersectionObserver((entries) => setOnScreen(Boolean(entries.at(-1)?.isIntersecting)), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isOnScreen;
}
