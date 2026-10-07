import type { DiffFile } from "./api.ts";
import { findLineByText, lineTextAt } from "../../server/anchors.ts";
import type { LineComment } from "./savedState.ts";

// - isOutdated: its line's code changed or left the PR.
export type PlacedComment = LineComment & { isOutdated: boolean };

/** Where a line of code is now, found by its text. */
function findLine(file: DiffFile, side: "LEFT" | "RIGHT", savedText: string | undefined, oldLine: number): number | undefined {
  const text = savedText ?? lineTextAt(file, side, oldLine);
  return text === undefined ? undefined : findLineByText(file, side, text, oldLine);
}

function placeStart(comment: LineComment, file: DiffFile): number | undefined {
  if (comment.startLine === undefined) return undefined;
  return findLine(file, comment.startSide ?? comment.side, comment.startLineText, comment.startLine);
}

function placeOne(comment: LineComment, file: DiffFile | undefined): PlacedComment {
  if (!file) return { ...comment, isOutdated: true };
  const line = findLine(file, comment.side, comment.lineText, comment.line);
  const startLine = placeStart(comment, file);
  const lostStart = comment.startLine !== undefined && startLine === undefined;
  if (line === undefined || lostStart) return { ...comment, isOutdated: true };
  return { ...comment, line, startLine, isOutdated: false };
}

/** Follows each comment to where its line of code is now. */
export function placeLineComments(comments: LineComment[], files: DiffFile[]): PlacedComment[] {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  return comments.map((comment) => placeOne(comment, fileByPath.get(comment.file)));
}

/** The code text a new comment is about, so it can follow later commits. */
export function lineTextFor(files: DiffFile[], filePath: string, side: "LEFT" | "RIGHT", line: number): string | undefined {
  const file = files.find((candidate) => candidate.path === filePath);
  return file ? lineTextAt(file, side, line) : undefined;
}
