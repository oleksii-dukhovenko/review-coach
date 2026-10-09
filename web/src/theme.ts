import { useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const STORAGE_KEY = "review-coach:theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<() => void>();

function savedChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "system" ? saved : "light";
  } catch {
    return "light";
  }
}

let choice: ThemeChoice = savedChoice();

function resolvedTheme(): Theme {
  if (choice === "system") return darkQuery.matches ? "dark" : "light";
  return choice;
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolvedTheme();
  listeners.forEach((listener) => listener());
}

export function setThemeChoice(next: ThemeChoice): void {
  choice = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // - Private windows may refuse storage; the theme still applies.
  }
  applyTheme();
}

/** The current choice and the theme it resolves to, kept in sync with the system setting. */
export function useTheme(): { choice: ThemeChoice; theme: Theme } {
  const [, rerender] = useState(0);
  useEffect(() => {
    const listener = () => rerender((count) => count + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { choice, theme: resolvedTheme() };
}

darkQuery.addEventListener("change", () => choice === "system" && applyTheme());
applyTheme();
