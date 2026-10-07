import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../server/diff.ts";
import type { DiffFile } from "../server/types.ts";
import type { Guide, WalkthroughData } from "../web/src/api.ts";
import { attentionItems, buildSteps, foldRows } from "../web/src/essay/model.ts";

function fileFrom(patch: string, tag: DiffFile["tag"] = "normal"): DiffFile {
  return { ...parseUnifiedDiff(patch)[0], tag, tagReason: "" };
}

const unchanged = Array.from({ length: 10 }, (_unused, index) => ` keep${index}`).join("\n");

const ORDER = fileFrom(`diff --git a/order.go b/order.go
--- a/order.go
+++ b/order.go
@@ -1,13 +1,14 @@
${unchanged}
 total := sum(items)
+tax := total * rate
 charge(total)
 }
`);

const LOCK = fileFrom(`diff --git a/go.sum b/go.sum
--- a/go.sum
+++ b/go.sum
@@ -1 +1 @@
-a v1
+a v2
`, "skim");

const question = {
  id: "q1", line: 12, endLine: 12, side: "RIGHT" as const, question: "Did you notice?", because: "b", example: "e",
  severity: "problem" as const, source: "logic" as const, suggestedComment: "c",
  proof: { status: "proven" as const, file: "order.go", line: 12, side: "RIGHT" as const, note: "" },
};

const note = { line: 12, endLine: 12, side: "RIGHT" as const, kind: "syntax" as const, conceptKey: "tax", title: "Tax", oneLiner: "o", explanation: "e", jsExample: "" };

const data: WalkthroughData = {
  walkthrough: {
    story: { tldr: "t", before: "", after: "", whatItDoes: "w", whyNeeded: "n", glossary: [] },
    picture: { caption: "", diagram: "", nodes: [] },
    hardIdeas: [{ conceptKey: "k", title: "Rates are floats", oneLiner: "Money as float rounds wrong.", analogy: "", diagram: "", jsExample: "", term: "", file: "order.go", line: 12 }],
    flow: [],
    tour: [{ file: "order.go", whyItMatters: "Adds tax.", notes: [note], questions: [question] }],
  },
  files: [ORDER, LOCK],
  removed: [],
};

const guide: Guide = {
  overview: "o",
  chapters: [
    { title: "Tax", oneLiner: "Adds tax", role: "core", summary: "s", files: [{ file: "order.go", whatChanged: "w" }] },
    { title: "Deps", oneLiner: "Bumps a lib", role: "supporting", summary: "s", files: [{ file: "go.sum", whatChanged: "w" }] },
  ],
};

describe("buildSteps", () => {
  const steps = buildSteps(data, guide);

  it("makes one step per guide chapter, with figures numbered by step", () => {
    expect(steps.map((step) => step.title)).toEqual(["Tax", "Deps"]);
    expect(steps[0].files[0].figures.map((figure) => figure.number)).toEqual(["1.1"]);
  });

  it("puts each question after the figure that shows its line", () => {
    expect(steps[0].files[0].figures[0].questionsAfter.map((placed) => placed.id)).toEqual(["q1"]);
    expect(steps[0].files[0].looseQuestions).toEqual([]);
  });

  it("numbers notes as footnotes and counts problems", () => {
    expect(steps[0].files[0].footnotes.map((footnote) => footnote.number)).toEqual([1]);
    expect(steps[0].problemCount).toBe(1);
  });

  it("leaves skim files out of the time estimate", () => {
    expect(steps[1].minutes).toBe(1);
    expect(steps[1].files[0].isSkim).toBe(true);
  });

  it("falls back to one step per tour stop, plus leftovers, without a guide", () => {
    expect(buildSteps(data, null).map((step) => step.title)).toEqual(["order.go", "Everything else"]);
  });
});

describe("foldRows", () => {
  const figure = buildSteps(data, guide)[0].files[0].figures[0];

  it("folds a long run of unchanged lines, keeping two on each side", () => {
    const rows = foldRows(figure, () => false);
    const fold = rows.find((row) => row.kind === "fold");
    expect(fold?.kind === "fold" && fold.lines.length).toBe(7);
  });

  it("never folds a pinned line", () => {
    const rows = foldRows(figure, (line) => line.text === "keep5");
    expect(rows.some((row) => row.kind === "line" && row.line.text === "keep5")).toBe(true);
  });
});

describe("attentionItems", () => {
  it("ranks real problems first and ends with the low-risk step", () => {
    const items = attentionItems(buildSteps(data, guide), data.walkthrough.hardIdeas);
    expect(items.map((item) => [item.title, item.isLowRisk])).toEqual([["Tax", false], ["Rates are floats", false], ["Deps is low-risk", true]]);
  });
});
