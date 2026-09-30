import { useEffect, useRef, useState } from "react";

import { api, type PrRoute, type ReviewEvent } from "./api.ts";

export type Decision = "problem" | "fine" | null;

export type QuestionAnswer = { typed: string; feedback: string; revealed: boolean; decision: Decision; draft: string };

export type ReviewState = {
  answers: Record<string, QuestionAnswer>;
  summary: string;
  verdict: ReviewEvent | null;
  postedUrl: string | null;
};

export type ReplyState = { draft: string; postedUrl: string | null };

export type MyPrState = { replies: Record<string, ReplyState> };

export const EMPTY_ANSWER: QuestionAnswer = { typed: "", feedback: "", revealed: false, decision: null, draft: "" };

const SAVE_DELAY_MS = 600;

/** State that saves itself to the server shortly after each change. */
export function useSavedState<T extends object>(route: PrRoute, saved: unknown, defaults: T): [T, (update: (current: T) => T) => void] {
  const [state, setState] = useState<T>({ ...defaults, ...(saved as Partial<T>) });
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const timer = setTimeout(() => void api.saveState(route, state), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);
  return [state, (update) => setState(update)];
}
