import { describe, expect, it } from "vitest";

import { nextCell, type CellPos } from "../web/src/essay/lineCursor.ts";

// - Figure A: row 0 both sides, row 1 left only, row 2 right only.
// - Figure B: row 0 both sides.
const cells: CellPos[] = [
  { figure: "A", row: 0, side: "left" },
  { figure: "A", row: 0, side: "right" },
  { figure: "A", row: 1, side: "left" },
  { figure: "A", row: 2, side: "right" },
  { figure: "B", row: 0, side: "left" },
  { figure: "B", row: 0, side: "right" },
];

describe("nextCell", () => {
  it("keeps the side going down", () => {
    expect(nextCell(cells, 0, "down", false)).toBe(2);
  });

  it("moves to the other side when the next row is empty on this side", () => {
    expect(nextCell(cells, 1, "down", false)).toBe(2);
    expect(nextCell(cells, 2, "down", false)).toBe(3);
  });

  it("works the same way going up", () => {
    expect(nextCell(cells, 3, "up", false)).toBe(2);
    expect(nextCell(cells, 2, "up", false)).toBe(0);
  });

  it("switches side only when the other side holds a line", () => {
    expect(nextCell(cells, 0, "right", false)).toBe(1);
    expect(nextCell(cells, 1, "left", false)).toBe(0);
    expect(nextCell(cells, 2, "right", false)).toBeUndefined();
    expect(nextCell(cells, 3, "left", false)).toBeUndefined();
  });

  it("moves on into the next figure, unless kept within the figure", () => {
    expect(nextCell(cells, 3, "down", false)).toBe(5);
    expect(nextCell(cells, 3, "down", true)).toBeUndefined();
    expect(nextCell(cells, 4, "up", true)).toBeUndefined();
  });

  it("stops at the first and last cells", () => {
    expect(nextCell(cells, 0, "up", false)).toBeUndefined();
    expect(nextCell(cells, 5, "down", false)).toBeUndefined();
  });
});
