import { randomUUID } from "node:crypto";

import { linesInSpan } from "./anchors.ts";
import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson } from "./claude.ts";
import { getJob, getPr, saveJobData } from "./db.ts";
import { plainWordsPrompt, type ItemToRewrite } from "./prompts.ts";
import { plainWordsJsonSchema, plainWordsSchema, type TourStop } from "./schemas.ts";
import type { DiffFile } from "./types.ts";
import type { WalkthroughData } from "./walkthrough.ts";

type Note = TourStop["notes"][number];
type Question = TourStop["questions"][number];
type Rewrites = ReturnType<typeof plainWordsSchema.parse>;
type Anchored = { line: number; endLine: number; side: "LEFT" | "RIGHT" };

const pending = new Map<string, Promise<void>>();

export function noteId(stopIndex: number, noteIndex: number): string {
  return `s${stopIndex}n${noteIndex}`;
}

function codeFor(files: DiffFile[], path: string, item: Anchored): string {
  const file = files.find((candidate) => candidate.path === path);
  const span = { line: item.endLine, side: item.side, startLine: item.line, startSide: item.side };
  return file ? linesInSpan(file, span).map((line) => line.text).join("\n") : "";
}

function linesLabel(item: Anchored): string {
  return item.line === item.endLine ? `line ${item.line}` : `lines ${item.line}-${item.endLine}`;
}

function itemFor(data: WalkthroughData, path: string, id: string, item: Anchored, fields: Record<string, string>): ItemToRewrite {
  return { id, file: path, lines: linesLabel(item), code: codeFor(data.files, path, item), fields };
}

function notesToRewrite(data: WalkthroughData): ItemToRewrite[] {
  return data.walkthrough.tour.flatMap((stop, stopIndex) => stop.notes.map((note, noteIndex) =>
    itemFor(data, stop.file, noteId(stopIndex, noteIndex), note, { title: note.title, oneLiner: note.oneLiner, explanation: note.explanation })));
}

function questionsToRewrite(data: WalkthroughData): ItemToRewrite[] {
  return data.walkthrough.tour.flatMap((stop) => stop.questions.map((question) =>
    itemFor(data, stop.file, question.id, question, { question: question.question, because: question.because, example: question.example })));
}

function rewriteNote(note: Note, rewrite: Rewrites["notes"][number] | undefined): Note {
  return rewrite ? { ...note, title: rewrite.title, oneLiner: rewrite.oneLiner } : note;
}

function rewriteQuestion(question: Question, rewrite: Rewrites["questions"][number] | undefined): Question {
  return rewrite ? { ...question, question: rewrite.question, because: rewrite.because, example: rewrite.example } : question;
}

/** Puts each rewrite back in place; anything Claude skipped keeps its words. */
export function applyRewrites(data: WalkthroughData, rewrites: Rewrites): WalkthroughData {
  const notesById = new Map(rewrites.notes.map((rewrite) => [rewrite.id, rewrite]));
  const questionsById = new Map(rewrites.questions.map((rewrite) => [rewrite.id, rewrite]));
  const tour = data.walkthrough.tour.map((stop, stopIndex) => ({
    ...stop,
    notes: stop.notes.map((note, noteIndex) => rewriteNote(note, notesById.get(noteId(stopIndex, noteIndex)))),
    questions: stop.questions.map((question) => rewriteQuestion(question, questionsById.get(question.id))),
  }));
  return { ...data, walkthrough: { ...data.walkthrough, tour }, plainNotes: true, plainQuestions: true };
}

function walkthroughData(prKey: string): WalkthroughData {
  const data = getJob(prKey, "walkthrough")?.data as WalkthroughData | null | undefined;
  if (!data) throw new Error("No walkthrough for this PR yet");
  return data;
}

async function askForRewrites(prKey: string, data: WalkthroughData): Promise<Rewrites> {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`Unknown PR ${prKey}`);
  const { worktree } = await ensureCheckout(pr);
  const prompt = plainWordsPrompt(notesToRewrite(data), questionsToRewrite(data));
  const raw = await runClaudeJson({ cwd: worktree, prompt, jsonSchema: plainWordsJsonSchema, sessionId: randomUUID(), addDirs: [] });
  return plainWordsSchema.parse(raw);
}

async function rewriteAndSave(prKey: string): Promise<void> {
  const rewrites = await askForRewrites(prKey, walkthroughData(prKey));
  saveJobData(prKey, "walkthrough", applyRewrites(walkthroughData(prKey), rewrites));
}

/** Rewrites every note and question in plain words, one run at a time per PR. */
export function rewriteInPlainWords(prKey: string): Promise<void> {
  if (!pending.has(prKey)) pending.set(prKey, rewriteAndSave(prKey).finally(() => pending.delete(prKey)));
  return pending.get(prKey)!;
}
