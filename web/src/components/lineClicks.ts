import type { DiffLine } from "../api.ts";

export type LineRef = { line: number; side: "LEFT" | "RIGHT" };

export function isPeekClick(event: React.MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

/** Deleted lines use old numbers; everything else uses new ones. */
export function lineRefOf(diffLine: DiffLine): LineRef {
  return diffLine.kind === "del" ? { line: diffLine.oldLine!, side: "LEFT" } : { line: diffLine.newLine!, side: "RIGHT" };
}
