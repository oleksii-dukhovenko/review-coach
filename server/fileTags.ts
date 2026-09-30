import path from "node:path";

import type { DiffFile, FileTag } from "./types.ts";

type ParsedFile = Omit<DiffFile, "tag" | "tagReason">;

type TagResult = { tag: FileTag; tagReason: string };

const LOCKFILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "pubspec.lock", "Cargo.lock", "poetry.lock", "Gemfile.lock",
]);

const GENERATED_PATH_PATTERNS = [
  /\.pb\.go$/, /_pb2(_grpc)?\.py$/, /\.pb\.(ts|js)$/, /_grpc\.pb\.go$/, /\.g\.dart$/, /\.freezed\.dart$/,
  /\.gen\.(go|ts)$/, /(^|\/)generated\//, /(^|\/)gen\//, /\.min\.(js|css)$/, /\.snap$/, /swagger\.(json|yaml)$/,
];

const GENERATED_HEADER = /(Code generated .* DO NOT EDIT|@generated|GENERATED CODE|AUTO-GENERATED)/i;

const TEST_PATH_PATTERNS = [
  /_test\.go$/, /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /_test\.dart$/, /(^|\/)test_[^/]+\.py$/,
  /(^|\/)__tests__\//, /(^|\/)tests?\//, /(^|\/)testdata\//, /(^|\/)fixtures?\//, /(^|\/)mocks?\//,
];

// - Money and security words count only in the file path.
const IMPORTANT_PATH_WORDS = [
  "payment", "refund", "charge", "invoice", "nmi", "tax", "tip", "price",
  "auth", "token", "secret", "password", "credential", "permission", "migration", "crypto",
];

// - Risky code counts anywhere in the changed lines.
const IMPORTANT_CODE_WORDS = [
  "mutex", ".lock(", ".unlock(", "go func", "atomic.", "sync.waitgroup", "begintx", "createtx", ".commit(", ".rollback(",
  "delete from", "drop table", "alter table", "password", "secret", "encrypt", "decrypt", "refund(", "charge(",
];

function isLockfile(filePath: string): boolean {
  return LOCKFILES.has(path.basename(filePath));
}

function isGeneratedFile(file: ParsedFile): boolean {
  const pathLooksGenerated = GENERATED_PATH_PATTERNS.some((pattern) => pattern.test(file.path));
  const firstLines = file.hunks[0]?.lines.slice(0, 5).map((line) => line.text).join("\n") ?? "";
  return pathLooksGenerated || GENERATED_HEADER.test(firstLines);
}

function isTestFile(filePath: string): boolean {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isPureRename(file: ParsedFile): boolean {
  return file.status === "renamed" && file.hunks.length === 0;
}

function changedCode(file: ParsedFile): string {
  const changedLines = file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "ctx"));
  return changedLines.map((line) => line.text).join("\n").toLowerCase();
}

/** "src/paymentsApi/tip-jar.ts" becomes src, payments, api, tip, jar, ts. */
function pathWords(filePath: string): string[] {
  const splitCamelCase = filePath.replace(/([a-z])([A-Z])/g, "$1 $2");
  return splitCamelCase.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function firstImportantWord(file: ParsedFile): string | undefined {
  const words = pathWords(file.path);
  const pathWord = IMPORTANT_PATH_WORDS.find((importantWord) => words.some((word) => word.startsWith(importantWord)));
  if (pathWord) return pathWord;
  const code = changedCode(file);
  return IMPORTANT_CODE_WORDS.find((word) => code.includes(word));
}

function skimReason(file: ParsedFile): string | undefined {
  if (file.isBinary) return "binary file";
  if (isLockfile(file.path)) return "lockfile";
  if (isGeneratedFile(file)) return "generated code";
  if (isTestFile(file.path)) return "test";
  if (isPureRename(file)) return "rename only";
  return undefined;
}

export function tagFile(file: ParsedFile): TagResult {
  const reasonToSkim = skimReason(file);
  if (reasonToSkim) return { tag: "skim", tagReason: reasonToSkim };
  const importantWord = firstImportantWord(file);
  if (importantWord) return { tag: "important", tagReason: `touches "${importantWord.trim()}"` };
  return { tag: "normal", tagReason: "" };
}

export function tagFiles(files: ParsedFile[]): DiffFile[] {
  return files.map((file) => ({ ...file, ...tagFile(file) }));
}
