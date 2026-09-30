import path from "node:path";

import { runCommand } from "./shell.ts";
import type { CommitSummary, DiffFile, RemovedSymbol, SymbolUse } from "./types.ts";

const MAX_SYMBOLS = 15;
const MAX_USES_SHOWN = 8;

const DECLARATION_PATTERNS: Record<string, RegExp[]> = {
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[[(]/],
  js: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  ],
  dart: [/^\s*(?:static\s+)?(?:Future<.*>|void|bool|int|double|String|[A-Z]\w*(?:<.*>)?)\??\s+([a-z_]\w*)\s*\(/],
  python: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/],
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".go": "go", ".js": "js", ".jsx": "js", ".ts": "js", ".tsx": "js", ".mjs": "js", ".dart": "dart", ".py": "python",
};

type Declaration = { name: string; file: string };

function languageOf(filePath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[path.extname(filePath)];
}

function declaredName(lineText: string, language: string): string | undefined {
  for (const pattern of DECLARATION_PATTERNS[language]) {
    const match = lineText.match(pattern);
    if (match) return match[1];
  }
  return undefined;
}

function declarationsOnLines(file: DiffFile, kind: "add" | "del"): Declaration[] {
  const language = languageOf(file.path);
  if (!language || file.tag === "skim") return [];
  const lines = file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind === kind));
  const names = lines.map((line) => declaredName(line.text, language)).filter((name) => name !== undefined);
  return names.map((name) => ({ name, file: file.oldPath || file.path }));
}

function addedLineTexts(files: DiffFile[]): string[] {
  return files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind === "add").map((line) => line.text)));
}

/** A function turned into a constant or variable is not removed. */
function isRedeclaredAsValue(name: string, addedLines: string[]): boolean {
  const valueDeclaration = new RegExp(`\\b(?:const|var|let|type)\\s+${name}\\b|^\\s*${name}\\s*(?::=|=(?!=))`);
  return addedLines.some((lineText) => valueDeclaration.test(lineText));
}

/** Declarations deleted and not re-declared anywhere in the PR. */
export function findRemovedDeclarations(files: DiffFile[]): Declaration[] {
  const addedNames = new Set(files.flatMap((file) => declarationsOnLines(file, "add")).map((declaration) => declaration.name));
  const addedLines = addedLineTexts(files);
  const removed = files.flatMap((file) => declarationsOnLines(file, "del"));
  const trulyRemoved = removed.filter((declaration) => !addedNames.has(declaration.name) && !isRedeclaredAsValue(declaration.name, addedLines));
  return trulyRemoved.slice(0, MAX_SYMBOLS);
}

function parseGrepLine(grepLine: string, sha: string): SymbolUse | undefined {
  const match = grepLine.slice(sha.length + 1).match(/^([^:]+):(\d+):(.*)$/);
  return match ? { file: match[1], line: Number(match[2]), text: match[3].trim() } : undefined;
}

function isDeclarationOf(use: SymbolUse, name: string): boolean {
  const language = languageOf(use.file);
  return language !== undefined && declaredName(use.text, language) === name;
}

/** Go names are private to their folder unless capitalized. */
function isVisibleFrom(use: SymbolUse, declaration: Declaration): boolean {
  const isPrivateGoName = languageOf(declaration.file) === "go" && /^[a-z_]/.test(declaration.name);
  return !isPrivateGoName || path.dirname(use.file) === path.dirname(declaration.file);
}

async function findUses(repoDir: string, declaration: Declaration, sha: string): Promise<SymbolUse[]> {
  const result = await runCommand("git", ["-C", repoDir, "grep", "-n", "-w", "-I", "-F", declaration.name, sha]);
  const uses = result.stdout.split("\n").map((grepLine) => parseGrepLine(grepLine, sha));
  const realUses = uses.filter((use): use is SymbolUse => use !== undefined && !isDeclarationOf(use, declaration.name));
  return realUses.filter((use) => isVisibleFrom(use, declaration));
}

async function findRecentCommits(repoDir: string, name: string, sha: string): Promise<CommitSummary[]> {
  const result = await runCommand("git", [
    "-C", repoDir, "log", "-n", "3", "--date=short", "--format=%h%x1f%an%x1f%ad%x1f%s", `-S${name}`, sha,
  ]);
  const commitLines = result.stdout.split("\n").filter((commitLine) => commitLine.length > 0);
  return commitLines.map((commitLine) => {
    const [shortSha, author, date, subject] = commitLine.split("\x1f");
    return { sha: shortSha, author, date, subject };
  });
}

async function traceDeclaration(repoDir: string, declaration: Declaration, baseSha: string, headSha: string): Promise<RemovedSymbol> {
  const usedBefore = await findUses(repoDir, declaration, baseSha);
  const usedAfter = await findUses(repoDir, declaration, headSha);
  return {
    name: declaration.name,
    file: declaration.file,
    usedBeforeCount: usedBefore.length,
    usedAfterCount: usedAfter.length,
    usedBefore: usedBefore.slice(0, MAX_USES_SHOWN),
    usedAfter: usedAfter.slice(0, MAX_USES_SHOWN),
    recentCommits: await findRecentCommits(repoDir, declaration.name, baseSha),
  };
}

/** For each deleted function: who used it, and its recent history. */
export async function traceRemovedCode(repoDir: string, files: DiffFile[], baseSha: string, headSha: string): Promise<RemovedSymbol[]> {
  const traced: RemovedSymbol[] = [];
  for (const declaration of findRemovedDeclarations(files)) {
    traced.push(await traceDeclaration(repoDir, declaration, baseSha, headSha));
  }
  return traced;
}
