import fs from "node:fs";
import path from "node:path";

import { ensureCheckout, worktreePath } from "./checkout.ts";
import { runCommand } from "./shell.ts";
import type { PullRequest, SymbolUse } from "./types.ts";

const MAX_REFERENCES = 200;
const IDENTIFIER = /^[A-Za-z_$][\w$]{0,99}$/;

export type ReferenceSearch = {
  word: string;
  references: SymbolUse[];
  total: number;
  onlySameFolder: boolean;
};

export type Snippet = { file: string; startLine: number; lines: string[] };

export function isIdentifier(word: string): boolean {
  return IDENTIFIER.test(word);
}

/** Reuses the checkout when it exists; peeking fires often. */
async function openCheckout(pr: PullRequest): Promise<string> {
  const existing = worktreePath(pr);
  if (fs.existsSync(existing)) return existing;
  return (await ensureCheckout(pr)).worktree;
}

/** Go names starting lowercase are private to their folder. */
function isPrivateGoName(word: string, fromFile: string): boolean {
  return fromFile.endsWith(".go") && /^[a-z_]/.test(word);
}

function parseGrepLine(grepLine: string): SymbolUse | undefined {
  const match = grepLine.match(/^([^:]+):(\d+):(.*)$/);
  return match ? { file: match[1], line: Number(match[2]), text: match[3] } : undefined;
}

async function grepWord(worktree: string, word: string): Promise<SymbolUse[]> {
  const result = await runCommand("git", ["-C", worktree, "grep", "-n", "-w", "-I", "-F", word]);
  const uses = result.stdout.split("\n").map(parseGrepLine);
  return uses.filter((use): use is SymbolUse => use !== undefined);
}

/** Every line in the PR head that mentions the word. */
export async function findReferences(pr: PullRequest, word: string, fromFile: string): Promise<ReferenceSearch> {
  const worktree = await openCheckout(pr);
  const allUses = await grepWord(worktree, word);
  const onlySameFolder = isPrivateGoName(word, fromFile);
  const folder = path.dirname(fromFile);
  const visibleUses = onlySameFolder ? allUses.filter((use) => path.dirname(use.file) === folder) : allUses;
  return { word, references: visibleUses.slice(0, MAX_REFERENCES), total: visibleUses.length, onlySameFolder };
}

function resolveInside(worktree: string, relativePath: string): string {
  const absolute = path.resolve(worktree, relativePath);
  if (!absolute.startsWith(worktree + path.sep)) throw new Error("File is outside the checkout");
  return absolute;
}

/** A few lines around one line of a file in the PR head. */
export async function readSnippet(pr: PullRequest, file: string, line: number, context: number): Promise<Snippet> {
  const worktree = await openCheckout(pr);
  const fileLines = fs.readFileSync(resolveInside(worktree, file), "utf8").split("\n");
  const startLine = Math.max(1, line - context);
  const endLine = Math.min(fileLines.length, line + context);
  return { file, startLine, lines: fileLines.slice(startLine - 1, endLine) };
}
