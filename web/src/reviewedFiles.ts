import type { DiffFile } from "./api.ts";

export type ReviewedStatus = "reviewed" | "changed" | "unreviewed";

/** Short hash of a file's diff; changes when the diff changes. */
export function diffFingerprint(file: DiffFile): string {
  const text = file.hunks.map((hunk) => hunk.header + hunk.lines.map((line) => line.kind + line.text).join("\n")).join("\n");
  let hash = 5381;
  for (let charIndex = 0; charIndex < text.length; charIndex++) hash = ((hash * 33) ^ text.charCodeAt(charIndex)) >>> 0;
  return hash.toString(36);
}

export function reviewedStatusOf(file: DiffFile, reviewedFiles: Record<string, string>): ReviewedStatus {
  const savedFingerprint = reviewedFiles[file.path];
  if (!savedFingerprint) return "unreviewed";
  return savedFingerprint === diffFingerprint(file) ? "reviewed" : "changed";
}
