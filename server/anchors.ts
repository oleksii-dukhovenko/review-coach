import type { DiffFile, DiffLine } from "./types.ts";

// - No Node imports: the web page uses this file too.

export type Side = "LEFT" | "RIGHT";

export type Anchored = { line: number; endLine?: number; side: Side };

function linesOn(file: DiffFile, side: Side): DiffLine[] {
  const allLines = file.hunks.flatMap((hunk) => hunk.lines);
  return side === "LEFT" ? allLines.filter((line) => line.kind === "del") : allLines.filter((line) => line.kind !== "del");
}

function numberOn(line: DiffLine, side: Side): number {
  return (side === "LEFT" ? line.oldLine : line.newLine) ?? -1;
}

export function lineTextAt(file: DiffFile, side: Side, lineNumber: number): string | undefined {
  return linesOn(file, side).find((line) => numberOn(line, side) === lineNumber)?.text;
}

/** The line with this text closest to where it used to be. */
export function findLineByText(file: DiffFile, side: Side, text: string, nearLine: number): number | undefined {
  const matches = linesOn(file, side).filter((line) => line.text === text).map((line) => numberOn(line, side));
  const byDistance = (left: number, right: number) => Math.abs(left - nearLine) - Math.abs(right - nearLine);
  return matches.sort(byDistance)[0];
}

/** Where one line of the old diff sits in the new diff, if it survived. */
export function moveLine(oldFile: DiffFile, newFile: DiffFile, side: Side, lineNumber: number): number | undefined {
  const text = lineTextAt(oldFile, side, lineNumber);
  return text === undefined ? undefined : findLineByText(newFile, side, text, lineNumber);
}

/** Moves a note or question to its new lines; undefined if its code changed. */
export function moveAnchored<T extends Anchored>(item: T, oldFile: DiffFile, newFile: DiffFile): T | undefined {
  const line = moveLine(oldFile, newFile, item.side, item.line);
  if (line === undefined) return undefined;
  if (item.endLine === undefined) return { ...item, line };
  const endLine = item.endLine === item.line ? line : moveLine(oldFile, newFile, item.side, item.endLine);
  const isValidRange = endLine !== undefined && endLine >= line;
  return isValidRange ? { ...item, line, endLine } : undefined;
}

/** Text of the changes only, so line shifts alone do not count. */
export function contentKey(file: DiffFile): string {
  return file.hunks.flatMap((hunk) => hunk.lines.map((line) => `${line.kind}:${line.text}`)).join("\n");
}

export function hasSameChanges(oldFile: DiffFile, newFile: DiffFile): boolean {
  return contentKey(oldFile) === contentKey(newFile);
}

export type LinePoint = { line: number; side: Side };

// - startLine and startSide are set only when more than one line is picked.
export type LineSpan = LinePoint & { startLine?: number; startSide?: Side };

export function spanStart(span: LineSpan): LinePoint {
  return span.startLine === undefined ? { line: span.line, side: span.side } : { line: span.startLine, side: span.startSide ?? span.side };
}

export function isMultiLine(span: LineSpan): boolean {
  const start = spanStart(span);
  return start.line !== span.line || start.side !== span.side;
}

/** "12", or "10-12" for a range. */
export function spanLabel(span: LineSpan): string {
  return isMultiLine(span) ? `${spanStart(span).line}-${span.line}` : String(span.line);
}

function isAtPoint(line: DiffLine, point: LinePoint): boolean {
  return point.side === "LEFT" ? line.kind === "del" && line.oldLine === point.line : line.kind !== "del" && line.newLine === point.line;
}

function allLinesOf(file: DiffFile): DiffLine[] {
  return file.hunks.flatMap((hunk) => hunk.lines);
}

/** Position of a line in the diff, top to bottom; -1 if absent. */
export function pointIndex(file: DiffFile, point: LinePoint): number {
  return allLinesOf(file).findIndex((line) => isAtPoint(line, point));
}

/** The two clicked lines as a span, earlier line first. */
export function spanBetween(file: DiffFile, first: LinePoint, second: LinePoint): LineSpan {
  const [start, end] = pointIndex(file, first) <= pointIndex(file, second) ? [first, second] : [second, first];
  const isOneLine = start.line === end.line && start.side === end.side;
  return isOneLine ? end : { ...end, startLine: start.line, startSide: start.side };
}

/** Every diff line from the span's start to its end, in order. */
export function linesInSpan(file: DiffFile, span: LineSpan): DiffLine[] {
  const startIndex = pointIndex(file, spanStart(span));
  const endIndex = pointIndex(file, span);
  if (startIndex === -1 || endIndex === -1) return [];
  return allLinesOf(file).slice(startIndex, endIndex + 1);
}

function hunkHas(hunk: DiffFile["hunks"][number], point: LinePoint): boolean {
  return hunk.lines.some((line) => isAtPoint(line, point));
}

/** GitHub only takes a multi-line comment inside one hunk. */
export function isSpanInOneHunk(file: DiffFile, span: LineSpan): boolean {
  return file.hunks.some((hunk) => hunkHas(hunk, spanStart(span)) && hunkHas(hunk, span));
}
