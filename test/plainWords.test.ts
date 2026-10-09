import { describe, expect, it } from "vitest";

import { applyRewrites, noteId } from "../server/plainWords.ts";
import type { WalkthroughData } from "../server/walkthrough.ts";

const note = { line: 3, endLine: 3, side: "RIGHT" as const, kind: "syntax" as const, conceptKey: "k", title: "Old title", oneLiner: "Old line", explanation: "", jsExample: "" };
const question = { id: "q1", line: 5, endLine: 5, side: "RIGHT" as const, question: "Old question?", because: "Old because", example: "Old example" };

const data = {
  walkthrough: {
    story: { tldr: "", before: "", after: "", whatItDoes: "", whyNeeded: "", glossary: [] },
    picture: { caption: "", diagram: "", nodes: [] }, hardIdeas: [], flow: [],
    tour: [{ file: "a.ts", whyItMatters: "", notes: [note, { ...note, title: "Second" }], questions: [question] }],
  },
  files: [], removed: [],
} as unknown as WalkthroughData;

describe("applyRewrites", () => {
  const rewritten = applyRewrites(data, {
    notes: [{ id: noteId(0, 0), title: "onKey returns false", oneLiner: "The key keeps going." }],
    questions: [{ id: "q1", question: "This test saves a row. Does it check the right one?", because: "New because", example: "New example" }],
  });

  it("swaps note wording and keeps notes it was not given", () => {
    const [first, second] = rewritten.walkthrough.tour[0].notes;
    expect([first.title, first.oneLiner, first.line]).toEqual(["onKey returns false", "The key keeps going.", 3]);
    expect(second.title).toBe("Second");
  });

  it("swaps question wording and keeps its id and lines", () => {
    const [rewrittenQuestion] = rewritten.walkthrough.tour[0].questions;
    expect([rewrittenQuestion.id, rewrittenQuestion.line, rewrittenQuestion.question]).toEqual(["q1", 5, "This test saves a row. Does it check the right one?"]);
    expect(rewritten.plainQuestions).toBe(true);
  });
});
