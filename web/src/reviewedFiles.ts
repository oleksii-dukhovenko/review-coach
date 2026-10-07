import type { DiffFile } from "./api.ts";
import { contentKey } from "../../server/anchors.ts";

export type ReviewedStatus = "reviewed" | "changed" | "unreviewed";

function shortHash(text: string): string {
  let hash = 5381;
  for (let charIndex = 0; charIndex < text.length; charIndex++) hash = ((hash * 33) ^ text.charCodeAt(charIndex)) >>> 0;
  return hash.toString(36);
}

/** Changes only when the file's changes change, not when lines just shift. */
export function diffFingerprint(file: DiffFile): string {
  return `c${shortHash(contentKey(file))}`;
}

/** The older fingerprint, which also counted line numbers. */
function lineNumberFingerprint(file: DiffFile): string {
  return shortHash(file.hunks.map((hunk) => hunk.header + hunk.lines.map((line) => line.kind + line.text).join("\n")).join("\n"));
}

export function reviewedStatusOf(file: DiffFile, reviewedFiles: Record<string, string>): ReviewedStatus {
  const savedFingerprint = reviewedFiles[file.path];
  if (!savedFingerprint) return "unreviewed";
  const stillMatches = savedFingerprint === diffFingerprint(file) || savedFingerprint === lineNumberFingerprint(file);
  return stillMatches ? "reviewed" : "changed";
}
