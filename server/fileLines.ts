import fs from "node:fs";
import path from "node:path";

// - No database or app imports: scripts use this file too.

function isReadableFileIn(worktree: string, fullPath: string): boolean {
  const isInside = fullPath.startsWith(`${path.resolve(worktree)}${path.sep}`);
  return isInside && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile();
}

/** The file's lines in the checkout; none when it is missing or outside. */
export function linesOfFile(worktree: string, file: string): string[] {
  const fullPath = path.resolve(worktree, file);
  return isReadableFileIn(worktree, fullPath) ? fs.readFileSync(fullPath, "utf8").split("\n") : [];
}

export function lineCountOf(worktree: string, file: string): number {
  return linesOfFile(worktree, file).length;
}
