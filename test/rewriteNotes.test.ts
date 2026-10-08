import { describe, expect, it } from "vitest";

import { applyRewrites, noteId } from "../server/rewriteNotes.ts";
import type { WalkthroughData } from "../server/walkthrough.ts";

const note = { line: 3, endLine: 3, side: "RIGHT" as const, kind: "syntax" as const, conceptKey: "k", title: "Old title", oneLiner: "Old line", explanation: "", jsExample: "" };

const data = {
  walkthrough: {
    story: { tldr: "", before: "", after: "", whatItDoes: "", whyNeeded: "", glossary: [] },
    picture: { caption: "", diagram: "", nodes: [] }, hardIdeas: [], flow: [],
    tour: [{ file: "a.ts", whyItMatters: "", notes: [note, { ...note, title: "Second" }], questions: [] }],
  },
  files: [], removed: [],
} as unknown as WalkthroughData;

describe("applyRewrites", () => {
  it("swaps title and one-liner on matching notes and keeps the rest", () => {
    const rewritten = applyRewrites(data, [{ id: noteId(0, 0), title: "onKey returns false", oneLiner: "The key keeps going." }]);
    const [first, second] = rewritten.walkthrough.tour[0].notes;
    expect([first.title, first.oneLiner, first.line]).toEqual(["onKey returns false", "The key keeps going.", 3]);
    expect(second.title).toBe("Second");
    expect(rewritten.plainNotes).toBe(true);
  });
});
