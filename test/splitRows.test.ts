import { describe, expect, it } from "vitest";

import type { DiffLine } from "../server/types.ts";
import { linesInRange, splitShownRows, toSplitRows, wholeFileLines } from "../web/src/essay/splitRows.ts";

const context = (oldLine: number, newLine: number): DiffLine => ({ kind: "ctx", oldLine, newLine, text: "same" });
const deleted = (oldLine: number): DiffLine => ({ kind: "del", oldLine, newLine: null, text: `old ${oldLine}` });
const added = (newLine: number): DiffLine => ({ kind: "add", oldLine: null, newLine, text: `new ${newLine}` });

describe("toSplitRows", () => {
  it("puts unchanged lines on both sides", () => {
    const line = context(1, 1);
    expect(toSplitRows([line])).toEqual([{ left: line, right: line }]);
  });

  it("faces deleted lines with the added lines that replace them", () => {
    const rows = toSplitRows([deleted(2), deleted(3), added(2), context(4, 3)]);
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      ["old 2", "new 2"],
      ["old 3", undefined],
      ["same", "same"],
    ]);
  });

  it("keeps extra added lines on the right only", () => {
    const rows = toSplitRows([deleted(5), added(5), added(6)]);
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      ["old 5", "new 5"],
      [undefined, "new 6"],
    ]);
  });

  it("starts a new pair when a deletion follows additions", () => {
    const rows = toSplitRows([added(1), deleted(1)]);
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      [undefined, "new 1"],
      ["old 1", undefined],
    ]);
  });

  it("keeps closed folds between pairs and opens the ones you opened", () => {
    const fold = { kind: "fold" as const, id: "fold-1", lines: [context(2, 2)], reason: "unchanged" as const };
    const rows = [{ kind: "line" as const, line: context(1, 1) }, fold, { kind: "line" as const, line: context(3, 3) }];
    expect(splitShownRows(rows, new Set()).map((item) => item.kind)).toEqual(["pair", "fold", "pair"]);
    expect(splitShownRows(rows, new Set(["fold-1"])).map((item) => item.kind)).toEqual(["pair", "pair", "pair"]);
  });
});

describe("wholeFileLines", () => {
  const diff = {
    path: "a.ts", oldPath: "a.ts", status: "modified" as const, isBinary: false, tag: "normal" as const, tagReason: "",
    hunks: [{ header: "@@ -3,2 +3,3 @@", lines: [context(3, 3), deleted(4), added(4), added(5)] }],
  };
  const newText = ["one", "two", "same", "new 4", "new 5", "six", "seven"];

  it("fills unchanged lines around the hunks with both line numbers", () => {
    const lines = wholeFileLines(newText, diff);
    expect(lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      ["ctx", 1, 1], ["ctx", 2, 2], ["ctx", 3, 3], ["del", 4, null], ["add", null, 4], ["add", null, 5], ["ctx", 5, 6], ["ctx", 6, 7],
    ]);
  });

  it("cuts a range by new line numbers, keeping deletions inside it", () => {
    const lines = linesInRange(wholeFileLines(newText, diff), 3, 5);
    expect(lines.map((line) => line.text)).toEqual(["same", "old 4", "new 4", "new 5"]);
  });
});
