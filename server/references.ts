import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCheckout, worktreePath } from "./checkout.ts";
import { getJob } from "./db.ts";
import { languageForFile, serverFor, warmUpServers, type LanguageSpec } from "./languageServers.ts";
import type { LspLocation } from "./lspClient.ts";
import { runCommand } from "./shell.ts";
import type { DiffFile, PullRequest, SymbolUse } from "./types.ts";

const MAX_REFERENCES = 300;
const MAX_FILE_LINES = 20_000;
const LANGUAGE_SERVER_TIMEOUT_MS = 45_000;
const IDENTIFIER = /^[A-Za-z_$][\w$]{0,99}$/;

export type Reference = SymbolUse & {
  // - Where the name starts in the line; absent for text matches.
  column?: number;
  isDefinition: boolean;
  // - The PR adds or changes this line.
  isChangedInPr: boolean;
  // - The line shows in the page's diff.
  isInPage: boolean;
};

export type ReferenceSearch = {
  word: string;
  references: Reference[];
  total: number;
  // - "exact" follows the code; "text" matches the word anywhere.
  precision: "exact" | "text";
  engine: string;
  note: string;
};

export type ReferenceQuery = { word: string; file: string; line: number; column: number; side: "LEFT" | "RIGHT" };

export type Snippet = { file: string; startLine: number; lines: string[] };

export type FileView = { file: string; lines: string[]; changedLines: number[]; isTruncated: boolean };

type LinesInPage = { changed: Set<number>; visible: Set<number> };

export function isIdentifier(word: string): boolean {
  return IDENTIFIER.test(word);
}

/** Reuses the checkout when it exists; peeking fires often. */
async function openCheckout(pr: PullRequest): Promise<string> {
  const existing = worktreePath(pr);
  if (fs.existsSync(existing)) return existing;
  return (await ensureCheckout(pr)).worktree;
}

function resolveInside(worktree: string, relativePath: string): string {
  const absolute = path.resolve(worktree, relativePath);
  if (!absolute.startsWith(worktree + path.sep)) throw new Error("File is outside the checkout");
  return absolute;
}

function readLines(absolutePath: string): string[] {
  return fs.readFileSync(absolutePath, "utf8").split("\n");
}

function prDiffFiles(pr: PullRequest): DiffFile[] {
  const job = getJob(pr.key, "walkthrough") ?? getJob(pr.key, "triage");
  return (job?.data as { files?: DiffFile[] } | null)?.files ?? [];
}

function linesInPage(file: DiffFile): LinesInPage {
  const newSideLines = file.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.newLine !== null);
  return {
    changed: new Set(newSideLines.filter((line) => line.kind === "add").map((line) => line.newLine!)),
    visible: new Set(newSideLines.map((line) => line.newLine!)),
  };
}

function pageLinesByFile(pr: PullRequest): Map<string, LinesInPage> {
  return new Map(prDiffFiles(pr).map((file) => [file.path, linesInPage(file)]));
}

function withPrContext(use: SymbolUse & { column?: number }, isDefinition: boolean, pageLines: Map<string, LinesInPage>): Reference {
  const fileLines = pageLines.get(use.file);
  return {
    ...use,
    isDefinition,
    isChangedInPr: fileLines?.changed.has(use.line) ?? false,
    isInPage: fileLines?.visible.has(use.line) ?? false,
  };
}

/** Definition first, then lines this PR changed, then the rest. */
function byImportance(left: Reference, right: Reference): number {
  const rank = (reference: Reference) => (reference.isDefinition ? 0 : reference.isChangedInPr ? 1 : 2);
  return rank(left) - rank(right) || left.file.localeCompare(right.file) || left.line - right.line;
}

type Located = { file: string; line: number; column: number };

function locatedInCheckout(location: LspLocation, worktree: string): Located | undefined {
  if (!location.uri.startsWith("file:")) return undefined;
  const absolute = fileURLToPath(location.uri);
  if (!absolute.startsWith(worktree + path.sep)) return undefined;
  return { file: path.relative(worktree, absolute), line: location.range.start.line + 1, column: location.range.start.character };
}

function locationKey(location: Located): string {
  return `${location.file}:${location.line}`;
}

/** In-repo locations only, one per line. */
function locatedInRepo(locations: LspLocation[], worktree: string): Located[] {
  const located = locations.map((location) => locatedInCheckout(location, worktree)).filter((location) => location !== undefined);
  return [...new Map(located.map((location) => [locationKey(location), location])).values()];
}

function withLineText(worktree: string, location: Located, fileCache: Map<string, string[]>): SymbolUse & { column: number } {
  if (!fileCache.has(location.file)) fileCache.set(location.file, readLines(path.join(worktree, location.file)));
  return { ...location, text: fileCache.get(location.file)![location.line - 1] ?? "" };
}

async function askLanguageServer(worktree: string, language: LanguageSpec, query: ReferenceQuery) {
  const absolute = resolveInside(worktree, query.file);
  const client = await serverFor(worktree, language);
  client.openFile(absolute, language.languageIdFor(path.extname(absolute)));
  const position = { line: query.line - 1, character: query.column };
  const uses = await client.references(absolute, position, LANGUAGE_SERVER_TIMEOUT_MS);
  // - Asked second: a cold server can answer it before analysis ends.
  const definitions = await client.definition(absolute, position, LANGUAGE_SERVER_TIMEOUT_MS).catch(() => []);
  return { uses, definitions };
}

function definitionKeys(definitions: LspLocation[], worktree: string): Set<string> {
  return new Set(locatedInRepo(definitions, worktree).map(locationKey));
}

function definitionNote(definitions: LspLocation[], worktree: string): string {
  const isOutsideRepo = definitions.length > 0 && definitionKeys(definitions, worktree).size === 0;
  return isOutsideRepo ? "Defined outside this repo, in a library or the language itself." : "";
}

async function exactSearch(pr: PullRequest, worktree: string, language: LanguageSpec, query: ReferenceQuery): Promise<ReferenceSearch> {
  const { uses, definitions } = await askLanguageServer(worktree, language, query);
  const definitionAt = definitionKeys(definitions, worktree);
  const pageLines = pageLinesByFile(pr);
  const fileCache = new Map<string, string[]>();
  const toReference = (location: Located) =>
    withPrContext(withLineText(worktree, location, fileCache), definitionAt.has(locationKey(location)), pageLines);
  const references = locatedInRepo([...definitions, ...uses], worktree).map(toReference).sort(byImportance);
  return {
    word: query.word, references: references.slice(0, MAX_REFERENCES), total: references.length,
    precision: "exact", engine: language.label, note: definitionNote(definitions, worktree),
  };
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

/** Go names starting lowercase are private to their folder. */
function isPrivateGoName(word: string, fromFile: string): boolean {
  return fromFile.endsWith(".go") && /^[a-z_]/.test(word);
}

async function textSearch(pr: PullRequest, worktree: string, query: ReferenceQuery, note: string): Promise<ReferenceSearch> {
  const allUses = await grepWord(worktree, query.word);
  const folder = path.dirname(query.file);
  const onlySameFolder = isPrivateGoName(query.word, query.file);
  const visibleUses = onlySameFolder ? allUses.filter((use) => path.dirname(use.file) === folder) : allUses;
  const pageLines = pageLinesByFile(pr);
  const references = visibleUses.map((use) => withPrContext(use, false, pageLines)).sort(byImportance);
  const folderNote = onlySameFolder ? " Only this folder: lowercase Go names are private to it." : "";
  return {
    word: query.word, references: references.slice(0, MAX_REFERENCES), total: references.length,
    precision: "text", engine: "text search", note: `${note}${folderNote}`.trim(),
  };
}

function whyTextOnly(language: LanguageSpec | undefined, query: ReferenceQuery): string | undefined {
  if (query.side === "LEFT") return "This line was deleted, so it is matched by name only.";
  if (!language) return `No language server for ${path.extname(query.file) || "this file type"}, so it is matched by name only.`;
  return undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Uses of this exact name in this exact scope, from a language server when one fits. */
export async function findReferences(pr: PullRequest, query: ReferenceQuery): Promise<ReferenceSearch> {
  const worktree = await openCheckout(pr);
  const language = languageForFile(query.file);
  const textOnlyReason = whyTextOnly(language, query);
  if (textOnlyReason || !language) return textSearch(pr, worktree, query, textOnlyReason ?? "");
  try {
    return await exactSearch(pr, worktree, language, query);
  } catch (error) {
    return textSearch(pr, worktree, query, `${language.label} could not answer (${errorText(error)}), so it is matched by name only.`);
  }
}

/** A few lines around one line of a file in the PR head. */
export async function readSnippet(pr: PullRequest, file: string, line: number, context: number): Promise<Snippet> {
  const worktree = await openCheckout(pr);
  const fileLines = readLines(resolveInside(worktree, file));
  const startLine = Math.max(1, line - context);
  const endLine = Math.min(fileLines.length, line + context);
  return { file, startLine, lines: fileLines.slice(startLine - 1, endLine) };
}

/** The whole file at the PR head, with the lines this PR changed. */
export async function readFileView(pr: PullRequest, file: string): Promise<FileView> {
  const worktree = await openCheckout(pr);
  const fileLines = readLines(resolveInside(worktree, file));
  const changedLines = pageLinesByFile(pr).get(file)?.changed ?? new Set<number>();
  return { file, lines: fileLines.slice(0, MAX_FILE_LINES), changedLines: [...changedLines], isTruncated: fileLines.length > MAX_FILE_LINES };
}

/** Starts language servers for this PR's files in the background. */
export function warmUpForPr(pr: PullRequest): void {
  const worktree = worktreePath(pr);
  if (!fs.existsSync(worktree)) return;
  warmUpServers(worktree, prDiffFiles(pr).map((file) => file.path));
}
