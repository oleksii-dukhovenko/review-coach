import fs from "node:fs";
import path from "node:path";

import type { Proof } from "./schemas.ts";
import { runCommand } from "./shell.ts";

type LineCounter = (filePath: string, side: Proof["side"]) => Promise<number | undefined>;

function countLines(text: string): number {
  return text.split("\n").length;
}

/** Counts lines in the head checkout or at the base commit. */
export function lineCounterFor(worktree: string, baseSha: string): LineCounter {
  const cache = new Map<string, number | undefined>();
  return async (filePath, side) => {
    const cacheKey = `${side}:${filePath}`;
    if (!cache.has(cacheKey)) cache.set(cacheKey, await readLineCount(worktree, baseSha, filePath, side));
    return cache.get(cacheKey);
  };
}

async function readLineCount(worktree: string, baseSha: string, filePath: string, side: Proof["side"]): Promise<number | undefined> {
  if (side === "RIGHT") {
    const absolute = path.join(worktree, filePath);
    const insideWorktree = absolute.startsWith(worktree + path.sep);
    return insideWorktree && fs.existsSync(absolute) ? countLines(fs.readFileSync(absolute, "utf8")) : undefined;
  }
  const result = await runCommand("git", ["-C", worktree, "show", `${baseSha}:${filePath}`]);
  return result.exitCode === 0 ? countLines(result.stdout) : undefined;
}

/** A "proven" claim whose file:line does not exist becomes a guess. */
export async function checkProof(proof: Proof, countLinesIn: LineCounter): Promise<Proof> {
  if (proof.status !== "proven") return proof;
  const lineCount = await countLinesIn(proof.file, proof.side);
  if (lineCount === undefined) return { ...proof, status: "guess", note: `File ${proof.file} not found` };
  const lineExists = proof.line >= 1 && proof.line <= lineCount;
  if (!lineExists) return { ...proof, status: "guess", note: `Line ${proof.line} is past the end of ${proof.file}` };
  return proof;
}
