import { randomUUID } from "node:crypto";

import { linesInSpan } from "./anchors.ts";
import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson } from "./claude.ts";
import { getJob, getPr, saveJobData } from "./db.ts";
import { noteRewritePrompt, type NoteToRewrite } from "./prompts.ts";
import { noteRewriteJsonSchema, noteRewriteSchema, type TourStop } from "./schemas.ts";
import type { DiffFile } from "./types.ts";
import type { WalkthroughData } from "./walkthrough.ts";

type Note = TourStop["notes"][number];

type Rewrite = { id: string; title: string; oneLiner: string };

const pending = new Map<string, Promise<void>>();

export function noteId(stopIndex: number, noteIndex: number): string {
  return `s${stopIndex}n${noteIndex}`;
}

function codeFor(files: DiffFile[], path: string, note: Note): string {
  const file = files.find((candidate) => candidate.path === path);
  const span = { line: note.endLine, side: note.side, startLine: note.line, startSide: note.side };
  return file ? linesInSpan(file, span).map((line) => line.text).join("\n") : "";
}

function notesToRewrite(data: WalkthroughData): NoteToRewrite[] {
  return data.walkthrough.tour.flatMap((stop, stopIndex) => stop.notes.map((note, noteIndex) => ({
    id: noteId(stopIndex, noteIndex),
    file: stop.file,
    lines: note.line === note.endLine ? `line ${note.line}` : `lines ${note.line}-${note.endLine}`,
    code: codeFor(data.files, stop.file, note),
    title: note.title,
    oneLiner: note.oneLiner,
    explanation: note.explanation,
  })));
}

/** Puts each rewrite back on its note; notes Claude skipped keep their words. */
export function applyRewrites(data: WalkthroughData, rewrites: Rewrite[]): WalkthroughData {
  const byId = new Map(rewrites.map((rewrite) => [rewrite.id, rewrite]));
  const rewriteNote = (note: Note, id: string): Note => {
    const rewrite = byId.get(id);
    return rewrite ? { ...note, title: rewrite.title, oneLiner: rewrite.oneLiner } : note;
  };
  const tour = data.walkthrough.tour.map((stop, stopIndex) => ({
    ...stop,
    notes: stop.notes.map((note, noteIndex) => rewriteNote(note, noteId(stopIndex, noteIndex))),
  }));
  return { ...data, walkthrough: { ...data.walkthrough, tour }, plainNotes: true };
}

function walkthroughData(prKey: string): WalkthroughData {
  const data = getJob(prKey, "walkthrough")?.data as WalkthroughData | null | undefined;
  if (!data) throw new Error("No walkthrough for this PR yet");
  return data;
}

async function askForRewrites(prKey: string, data: WalkthroughData): Promise<Rewrite[]> {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`Unknown PR ${prKey}`);
  const { worktree } = await ensureCheckout(pr);
  const prompt = noteRewritePrompt(notesToRewrite(data));
  const raw = await runClaudeJson({ cwd: worktree, prompt, jsonSchema: noteRewriteJsonSchema, sessionId: randomUUID(), addDirs: [] });
  return noteRewriteSchema.parse(raw).notes;
}

async function rewriteAndSave(prKey: string): Promise<void> {
  const rewrites = await askForRewrites(prKey, walkthroughData(prKey));
  saveJobData(prKey, "walkthrough", applyRewrites(walkthroughData(prKey), rewrites));
}

/** Rewrites every note's title and one-liner in plain words, once at a time per PR. */
export function rewriteNotes(prKey: string): Promise<void> {
  if (!pending.has(prKey)) pending.set(prKey, rewriteAndSave(prKey).finally(() => pending.delete(prKey)));
  return pending.get(prKey)!;
}
