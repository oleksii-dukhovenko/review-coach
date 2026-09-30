import type { DiffLine } from "../../../server/types.ts";

export type SplitRow = { left?: DiffLine; right?: DiffLine };

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
