import { useEffect, useRef, useState } from "react";

import { api, type PrRoute, type ReviewEvent } from "./api.ts";

export type Decision = "problem" | "fine" | null;

export type Exchange = { question: string; answer: string };

// - explanation is the "Explain" answer; followUps are the chat after it.
export type QuestionAnswer = {
  typed: string;
  feedback: string;
  revealed: boolean;
  decision: Decision;
  draft: string;
  explanation?: string;
  followUps?: Exchange[];
};

// - lineText and startLineText let the comment follow its code after new commits.
// - startLine is set only for a comment on several lines.
export type LineComment = {
  id: string;
  file: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  lineText?: string;
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  startLineText?: string;
};

export type ReviewState = {
  answers: Record<string, QuestionAnswer>;
  lineComments: LineComment[];
  // - File path to the diff fingerprint you reviewed.
  reviewedFiles: Record<string, string>;
  summary: string;
  verdict: ReviewEvent | null;
  postedUrl: string | null;
};

export type ReplyState = { draft: string; postedUrl: string | null };

export type MyPrState = { replies: Record<string, ReplyState> };

export const EMPTY_ANSWER: QuestionAnswer = { typed: "", feedback: "", revealed: false, decision: null, draft: "" };

const SAVE_DELAY_MS = 600;

/** Only the keys this section owns. */
function ownKeys<T extends object>(state: T, defaults: T): Partial<T> {
  const owned = Object.keys(defaults).map((key) => [key, state[key as keyof T]]);
  return Object.fromEntries(owned) as Partial<T>;
}

/** State that saves itself to the server shortly after each change. */
export function useSavedState<T extends object>(route: PrRoute, saved: unknown, defaults: T): [T, (update: (current: T) => T) => void] {
  const [state, setState] = useState<T>({ ...defaults, ...(saved as Partial<T>) });
  const isFirstRender = useRef(true);
  const unsaved = useRef<T | null>(null);
  const save = (latest: T) => {
    unsaved.current = null;
    void api.saveState(route, ownKeys(latest, defaults));
  };
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    unsaved.current = state;
    const timer = setTimeout(() => save(state), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    const saveWhileLeaving = () => {
      if (!unsaved.current) return;
      api.saveStateWhileLeaving(route, ownKeys(unsaved.current, defaults));
      unsaved.current = null;
    };
    window.addEventListener("pagehide", saveWhileLeaving);
    return () => {
      window.removeEventListener("pagehide", saveWhileLeaving);
      if (unsaved.current) save(unsaved.current);
    };
  }, []);
  return [state, (update) => setState(update)];
}
