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

const IMPORTANT_WORDS = [
  "payment", "refund", "price", "amount", "total", "tax", "tip", "money", "charge", "invoice", "nmi",
  "auth", "token", "secret", "password", "credential", "permission", "session",
  "migration", "transaction", "sql", "delete from", "drop table",
  "mutex", ".lock(", "unlock(", "go func", "goroutine", "chan ", "atomic.", "sync.",
  "crypto", "encrypt", "decrypt",
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

function changedText(file: ParsedFile): string {
  const changedLines = file.hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind !== "ctx"));
  return `${file.path}\n${changedLines.map((line) => line.text).join("\n")}`.toLowerCase();
}

function firstImportantWord(file: ParsedFile): string | undefined {
  const text = changedText(file);
  return IMPORTANT_WORDS.find((word) => text.includes(word));
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
