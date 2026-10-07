import { describe, expect, it } from "vitest";

import { moveAnchored } from "../server/anchors.ts";
import { parseUnifiedDiff } from "../server/diff.ts";
import type { TourStop, Walkthrough } from "../server/schemas.ts";
import type { DiffFile } from "../server/types.ts";
import { mergeUpdate, planUpdate, withUniqueIds, type MergeableData } from "../server/walkthroughMerge.ts";

function fileFrom(patch: string): DiffFile {
  return { ...parseUnifiedDiff(patch)[0], tag: "normal", tagReason: "" };
}

const ORDER_V1 = fileFrom(`diff --git a/order.go b/order.go
--- a/order.go
+++ b/order.go
@@ -10,3 +10,4 @@ func Place() {
 	total := sum(items)
+	tax := total * rate
 	charge(total)
 }
`);

// - Same change, pushed 5 lines down by an unrelated edit above it.
const ORDER_SHIFTED = fileFrom(`diff --git a/order.go b/order.go
--- a/order.go
+++ b/order.go
@@ -15,3 +15,4 @@ func Place() {
 	total := sum(items)
+	tax := total * rate
 	charge(total)
 }
`);

const ORDER_REWRITTEN = fileFrom(`diff --git a/order.go b/order.go
--- a/order.go
+++ b/order.go
@@ -10,3 +10,4 @@ func Place() {
 	total := sum(items)
+	tax := roundCents(total * rate)
 	charge(total)
 }
`);

function question(id: string, line: number) {
  return {
    id, line, endLine: line, side: "RIGHT" as const, question: "Did you notice?", because: "b", example: "e",
    severity: "problem" as const, source: "logic" as const, suggestedComment: "c",
    proof: { status: "proven" as const, file: "order.go", line, side: "RIGHT" as const, note: "" },
  };
}

function stopFor(file: string, questionIds: string[], line: number): TourStop {
  return { file, whyItMatters: "why", notes: [], questions: questionIds.map((id) => question(id, line)) };
}

function previousWith(file: DiffFile, stop: TourStop): MergeableData {
  const walkthrough = {
    story: { tldr: "t", before: "", after: "", whatItDoes: "w", whyNeeded: "n", glossary: [] },
    picture: { caption: "", diagram: "", nodes: [] }, hardIdeas: [], flow: [], tour: [stop],
  } satisfies Walkthrough;
  return { walkthrough, files: [file], removed: [] };
}

describe("moveAnchored", () => {
  it("follows a line that only shifted", () => {
    expect(moveAnchored({ line: 11, endLine: 11, side: "RIGHT" }, ORDER_V1, ORDER_SHIFTED)).toEqual({ line: 16, endLine: 16, side: "RIGHT" });
  });

  it("gives up when the line's code changed", () => {
    expect(moveAnchored({ line: 11, side: "RIGHT" }, ORDER_V1, ORDER_REWRITTEN)).toBeUndefined();
  });
});

describe("planUpdate", () => {
  it("keeps a stop whose changes only shifted, with the same question ids", () => {
    const plan = planUpdate(previousWith(ORDER_V1, stopFor("order.go", ["q1"], 11)), [ORDER_SHIFTED]);
    expect(plan.redo).toEqual([]);
    expect(plan.kept.get("order.go")?.questions.map((kept) => [kept.id, kept.line])).toEqual([["q1", 16]]);
  });

  it("redoes a file whose changes changed", () => {
    const plan = planUpdate(previousWith(ORDER_V1, stopFor("order.go", ["q1"], 11)), [ORDER_REWRITTEN]);
    expect(plan.redo).toEqual(["order.go"]);
  });
});

describe("withUniqueIds", () => {
  it("renames a new question that reuses a kept id", () => {
    const redone = withUniqueIds([stopFor("b.go", ["q1", "q9"], 3)], [stopFor("a.go", ["q1"], 3)], "u1-");
    expect(redone[0].questions.map((renamed) => renamed.id)).toEqual(["u1-1", "q9"]);
  });
});

describe("mergeUpdate", () => {
  it("keeps the story and adds a change entry when nothing needed Claude", () => {
    const previous = previousWith(ORDER_V1, stopFor("order.go", ["q1"], 11));
    const plan = planUpdate(previous, [ORDER_SHIFTED]);
    const merged = mergeUpdate({
      previous, plan, update: undefined, newFiles: [ORDER_SHIFTED], removed: [],
      change: { fromSha: "aaa", toSha: "bbb", at: "2026-10-06T00:00:00Z" }, idPrefix: "u1-",
    });
    expect(merged.walkthrough.story.tldr).toBe("t");
    expect(merged.walkthrough.tour[0].questions[0]).toMatchObject({ id: "q1", line: 16 });
    expect(merged.changes).toEqual([{ fromSha: "aaa", toSha: "bbb", at: "2026-10-06T00:00:00Z", summary: expect.any(String), files: [] }]);
  });

  it("uses Claude's stop for a redone file and keeps its old place in the tour", () => {
    const previous = previousWith(ORDER_V1, stopFor("order.go", ["q1"], 11));
    const plan = planUpdate(previous, [ORDER_REWRITTEN]);
    const update = { sinceLastTime: "Tax is now rounded.", stops: [stopFor("order.go", ["q1", "u1-1"], 11)], story: null, picture: null, flow: null, newHardIdeas: [] };
    const merged = mergeUpdate({
      previous, plan, update, newFiles: [ORDER_REWRITTEN], removed: [],
      change: { fromSha: "aaa", toSha: "bbb", at: "2026-10-06T00:00:00Z" }, idPrefix: "u1-",
    });
    expect(merged.walkthrough.tour.map((stop) => stop.questions.map((kept) => kept.id))).toEqual([["q1", "u1-1"]]);
    expect(merged.changes?.[0]).toMatchObject({ summary: "Tax is now rounded.", files: ["order.go"] });
  });
});

describe("placeLineComments", async () => {
  const { placeLineComments } = await import("../web/src/placeComments.ts");
  const comment = { id: "c1", file: "order.go", line: 11, side: "RIGHT" as const, body: "Round this?", lineText: "\ttax := total * rate" };

  it("moves a comment with its line of code", () => {
    expect(placeLineComments([comment], [ORDER_SHIFTED])[0]).toMatchObject({ line: 16, isOutdated: false });
  });

  it("marks a comment outdated when its code changed", () => {
    expect(placeLineComments([comment], [ORDER_REWRITTEN])[0].isOutdated).toBe(true);
  });
});

describe("reviewedStatusOf", async () => {
  const { diffFingerprint, reviewedStatusOf } = await import("../web/src/reviewedFiles.ts");

  it("stays reviewed when the changes only shifted", () => {
    expect(reviewedStatusOf(ORDER_SHIFTED, { "order.go": diffFingerprint(ORDER_V1) })).toBe("reviewed");
  });

  it("asks again when the changes changed", () => {
    expect(reviewedStatusOf(ORDER_REWRITTEN, { "order.go": diffFingerprint(ORDER_V1) })).toBe("changed");
  });
});

describe("line spans", async () => {
  const { isSpanInOneHunk, linesInSpan, spanBetween, spanLabel } = await import("../server/anchors.ts");
  const TWO_HUNKS = fileFrom(`diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -20,2 +20,3 @@
 twenty
+inserted
 twentyone
`);

  it("orders a range picked bottom to top", () => {
    const span = spanBetween(TWO_HUNKS, { line: 3, side: "RIGHT" }, { line: 1, side: "RIGHT" });
    expect(span).toEqual({ line: 3, side: "RIGHT", startLine: 1, startSide: "RIGHT" });
    expect(spanLabel(span)).toBe("1-3");
  });

  it("keeps deleted and added lines between the ends, in diff order", () => {
    const span = spanBetween(TWO_HUNKS, { line: 2, side: "LEFT" }, { line: 3, side: "RIGHT" });
    expect(linesInSpan(TWO_HUNKS, span).map((line) => line.text)).toEqual(["two", "TWO", "three"]);
  });

  it("is one line when both ends are the same line", () => {
    expect(spanBetween(TWO_HUNKS, { line: 2, side: "RIGHT" }, { line: 2, side: "RIGHT" })).toEqual({ line: 2, side: "RIGHT" });
  });

  it("knows GitHub cannot take a range across hunks", () => {
    expect(isSpanInOneHunk(TWO_HUNKS, { line: 21, side: "RIGHT", startLine: 3, startSide: "RIGHT" })).toBe(false);
    expect(isSpanInOneHunk(TWO_HUNKS, { line: 3, side: "RIGHT", startLine: 1, startSide: "RIGHT" })).toBe(true);
  });
});

describe("placeLineComments with a range", async () => {
  const { placeLineComments } = await import("../web/src/placeComments.ts");
  const ranged = {
    id: "c2", file: "order.go", line: 12, side: "RIGHT" as const, body: "b", lineText: "\tcharge(total)",
    startLine: 10, startSide: "RIGHT" as const, startLineText: "\ttotal := sum(items)",
  };

  it("moves both ends with their code", () => {
    expect(placeLineComments([ranged], [ORDER_SHIFTED])[0]).toMatchObject({ startLine: 15, line: 17, isOutdated: false });
  });
});
