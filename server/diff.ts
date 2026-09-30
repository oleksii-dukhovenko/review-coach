import { runOrThrow } from "./shell.ts";
import type { DiffFile, DiffHunk, DiffLine } from "./types.ts";

type ParsedFile = Omit<DiffFile, "tag" | "tagReason">;

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export async function readPrDiff(worktree: string, baseSha: string, headSha: string): Promise<ParsedFile[]> {
  const patch = await runOrThrow("git", [
    "-C", worktree, "-c", "core.quotePath=false",
    "diff", "--no-color", "--no-ext-diff", "--find-renames", "-U3", `${baseSha}...${headSha}`,
  ]);
  return parseUnifiedDiff(patch);
}

function startFile(headerLine: string): ParsedFile {
  const match = headerLine.match(/^diff --git a\/(.+) b\/(.+)$/);
  const oldPath = match?.[1] ?? "";
  const newPath = match?.[2] ?? oldPath;
  return { path: newPath, oldPath, status: "modified", isBinary: false, hunks: [] };
}

function stripPathPrefix(pathLine: string): string | null {
  const rawPath = pathLine.slice(4).trim();
  if (rawPath === "/dev/null") return null;
  return rawPath.replace(/^[ab]\//, "");
}

/** Applies one file-header line, returning false if it was not a header. */
function applyFileHeader(file: ParsedFile, line: string): boolean {
  if (line.startsWith("new file mode")) file.status = "added";
  else if (line.startsWith("deleted file mode")) file.status = "deleted";
  else if (line.startsWith("rename from ")) { file.status = "renamed"; file.oldPath = line.slice(12); }
  else if (line.startsWith("rename to ")) file.path = line.slice(10);
  else if (line.startsWith("Binary files ")) file.isBinary = true;
  else if (line.startsWith("--- ")) file.oldPath = stripPathPrefix(line) ?? file.oldPath;
  else if (line.startsWith("+++ ")) file.path = stripPathPrefix(line) ?? file.path;
  else return line.startsWith("index ") || line.startsWith("similarity ") || line.includes(" mode ");
  return true;
}

type LineCursor = { oldLine: number; newLine: number };

function startHunk(headerLine: string, cursor: LineCursor): DiffHunk {
  const match = headerLine.match(HUNK_HEADER)!;
  cursor.oldLine = Number(match[1]);
  cursor.newLine = Number(match[2]);
  return { header: headerLine, lines: [] };
}

function toDiffLine(line: string, cursor: LineCursor): DiffLine | null {
  const marker = line[0];
  const text = line.slice(1);
  if (marker === "+") return { kind: "add", oldLine: null, newLine: cursor.newLine++, text };
  if (marker === "-") return { kind: "del", oldLine: cursor.oldLine++, newLine: null, text };
  if (marker === " ") return { kind: "ctx", oldLine: cursor.oldLine++, newLine: cursor.newLine++, text };
  return null;
}

export function parseUnifiedDiff(patch: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const cursor: LineCursor = { oldLine: 0, newLine: 0 };
  let currentFile: ParsedFile | undefined;
  let currentHunk: DiffHunk | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      currentFile = startFile(line);
      currentHunk = undefined;
      files.push(currentFile);
    } else if (currentFile && HUNK_HEADER.test(line)) {
      currentHunk = startHunk(line, cursor);
      currentFile.hunks.push(currentHunk);
    } else if (currentFile && !currentHunk) {
      applyFileHeader(currentFile, line);
    } else if (currentHunk) {
      const diffLine = toDiffLine(line, cursor);
      if (diffLine) currentHunk.lines.push(diffLine);
    }
  }
  return files;
}

/** True when a comment on this line can be anchored in the PR diff. */
export function isLineInDiff(file: DiffFile, line: number, side: "LEFT" | "RIGHT"): boolean {
  return file.hunks.some((hunk) =>
    hunk.lines.some((diffLine) => (side === "RIGHT" ? diffLine.newLine === line : diffLine.oldLine === line)),
  );
}

/** Renders a file back to patch text for a prompt. */
export function fileToPatchText(file: DiffFile): string {
  const header = `--- ${file.oldPath}\n+++ ${file.path}`;
  const hunks = file.hunks.map((hunk) => [hunk.header, ...hunk.lines.map(patchLineText)].join("\n"));
  return [header, ...hunks].join("\n");
}

const PATCH_MARKER = { add: "+", del: "-", ctx: " " } as const;

function patchLineText(line: DiffLine): string {
  return PATCH_MARKER[line.kind] + line.text;
}
