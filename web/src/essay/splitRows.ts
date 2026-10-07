import type { DiffFile, DiffHunk, DiffLine } from "../../../server/types.ts";
import type { FoldedRun, ShownRow } from "./model.ts";

export type SplitRow = { left?: DiffLine; right?: DiffLine };

export type SplitItem = { kind: "pair"; row: SplitRow } | FoldedRun;

function pairChangeRun(deleted: DiffLine[], added: DiffLine[]): SplitRow[] {
  const rowCount = Math.max(deleted.length, added.length);
  return Array.from({ length: rowCount }, (_unused, rowIndex) => ({ left: deleted[rowIndex], right: added[rowIndex] }));
}

/** Unchanged lines sit on both sides; a deleted run faces the added run after it. */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let deleted: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flushChanges = () => {
    rows.push(...pairChangeRun(deleted, added));
    deleted = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === "ctx") {
      flushChanges();
      rows.push({ left: line, right: line });
    } else if (line.kind === "del") {
      if (added.length > 0) flushChanges();
      deleted.push(line);
    } else {
      added.push(line);
    }
  }
  flushChanges();
  return rows;
}

function asPairs(lines: DiffLine[]): SplitItem[] {
  return toSplitRows(lines).map((row) => ({ kind: "pair", row }));
}

/** Folded rows as side-by-side pairs; opened folds join the lines around them. */
export function splitShownRows(rows: ShownRow[], openFolds: Set<string>): SplitItem[] {
  const items: SplitItem[] = [];
  let run: DiffLine[] = [];
  for (const row of rows) {
    if (row.kind === "line") run.push(row.line);
    else if (openFolds.has(row.id)) run.push(...row.lines);
    else {
      items.push(...asPairs(run), row);
      run = [];
    }
  }
  return [...items, ...asPairs(run)];
}

type HunkStart = { oldStart: number; newStart: number };

function hunkStart(hunk: DiffHunk): HunkStart {
  const match = hunk.header.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)/);
  return { oldStart: Number(match?.[1] ?? 1), newStart: Number(match?.[2] ?? 1) };
}

function newLineCount(hunk: DiffHunk): number {
  return hunk.lines.filter((line) => line.kind !== "del").length;
}

function oldLineCount(hunk: DiffHunk): number {
  return hunk.lines.filter((line) => line.kind !== "add").length;
}

function unchanged(newLine: number, shift: number, text: string): DiffLine {
  return { kind: "ctx", oldLine: newLine - shift, newLine, text };
}

/** The whole new file as diff lines: hunks where it changed, unchanged lines between. */
export function wholeFileLines(newText: string[], diff: DiffFile): DiffLine[] {
  const lines: DiffLine[] = [];
  let nextNew = 1;
  let shift = 0;
  for (const hunk of diff.hunks) {
    const start = hunkStart(hunk);
    for (; nextNew < start.newStart; nextNew++) lines.push(unchanged(nextNew, shift, newText[nextNew - 1] ?? ""));
    lines.push(...hunk.lines);
    nextNew = Math.max(nextNew, start.newStart + newLineCount(hunk));
    shift = start.newStart + newLineCount(hunk) - (start.oldStart + oldLineCount(hunk));
  }
  for (; nextNew <= newText.length; nextNew++) lines.push(unchanged(nextNew, shift, newText[nextNew - 1]));
  return lines;
}

function isInRange(line: DiffLine, firstLine: number, lastLine: number): boolean {
  return line.newLine !== null && line.newLine >= firstLine && line.newLine <= lastLine;
}

/** New-file lines firstLine..lastLine, with the deleted lines that sit between them. */
export function linesInRange(lines: DiffLine[], firstLine: number, lastLine: number): DiffLine[] {
  const firstIndex = lines.findIndex((line) => isInRange(line, firstLine, lastLine));
  const lastIndex = lines.findLastIndex((line) => isInRange(line, firstLine, lastLine));
  return firstIndex === -1 ? [] : lines.slice(firstIndex, lastIndex + 1);
}
