import { useSyncExternalStore } from "react";

export type DiffLayout = "split" | "unified";

const STORAGE_KEY = "review-coach-diff-layout";
const listeners = new Set<() => void>();

function readSavedLayout(): DiffLayout {
  try {
    return localStorage.getItem(STORAGE_KEY) === "unified" ? "unified" : "split";
  } catch {
    return "split";
  }
}

let currentLayout = readSavedLayout();

export function setDiffLayout(layout: DiffLayout): void {
  currentLayout = layout;
  try {
    localStorage.setItem(STORAGE_KEY, layout);
  } catch {
    // - Private windows may block storage.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One layout for every diff on the page, remembered per browser. */
export function useDiffLayout(): DiffLayout {
  return useSyncExternalStore(subscribe, () => currentLayout);
}
