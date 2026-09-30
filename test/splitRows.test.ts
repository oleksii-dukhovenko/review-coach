import { describe, expect, it } from "vitest";

import type { DiffLine } from "../server/types.ts";
import { toSplitRows } from "../web/src/components/splitRows.ts";

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
});
