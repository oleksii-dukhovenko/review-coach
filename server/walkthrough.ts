import { randomUUID } from "node:crypto";

import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson, UsageLimitError } from "./claude.ts";
import { config } from "./config.ts";
import { readInterdiff, readPrDiff } from "./diff.ts";
import { tagFiles } from "./fileTags.ts";
import { checkProof, lineCounterFor } from "./proofCheck.ts";
import { threadStamps } from "./jobKinds.ts";
import { guidePrompt, triagePrompt, walkthroughPrompt, walkthroughUpdatePrompt } from "./prompts.ts";
import { traceRemovedCode } from "./removedCode.ts";
import { collectRuleFiles } from "./rules.ts";
import {
  guideJsonSchema, guideSchema, triageJsonSchema, triageSchema, walkthroughJsonSchema, walkthroughSchema,
  walkthroughUpdateJsonSchema, walkthroughUpdateSchema, type Guide, type Triage, type Walkthrough, type WalkthroughUpdate,
} from "./schemas.ts";
import type { DiffFile, PullRequest, RemovedSymbol, ReviewThread } from "./types.ts";
import { mergeUpdate, planUpdate, type UpdatePlan, type WalkthroughChange } from "./walkthroughMerge.ts";

export type WalkthroughData = {
  walkthrough: Walkthrough;
  files: DiffFile[];
  removed: RemovedSymbol[];
  changes?: WalkthroughChange[];
  // - True once every note, and every question, follows the plain-words rules.
  plainNotes?: boolean;
  plainQuestions?: boolean;
};

export type TriageData = { triage: Triage; files: DiffFile[] };

export type BuiltJob<T> = { data: T; sessionId: string };

type ClaudeCall<T> = { cwd: string; prompt: string; jsonSchema: object; parse: (raw: unknown) => T; addDirs: string[] };

/** Asks Claude, retrying once if the answer has the wrong shape. */
async function askClaudeWithRetry<T>(call: ClaudeCall<T>): Promise<BuiltJob<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sessionId = randomUUID();
    try {
      const raw = await runClaudeJson({ ...call, sessionId });
      return { data: call.parse(raw), sessionId };
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function checkWalkthroughProofs(walkthrough: Walkthrough, countLines: ReturnType<typeof lineCounterFor>): Promise<Walkthrough> {
  const tour = await Promise.all(
    walkthrough.tour.map(async (stop) => ({
      ...stop,
      questions: await Promise.all(
        stop.questions.map(async (question) => ({ ...question, proof: await checkProof(question.proof, countLines) })),
      ),
    })),
  );
  return { ...walkthrough, tour };
}

async function checkTriageProofs(triage: Triage, countLines: ReturnType<typeof lineCounterFor>): Promise<Triage> {
  const threads = await Promise.all(
    triage.threads.map(async (thread) => ({ ...thread, proof: await checkProof(thread.proof, countLines) })),
  );
  return { threads };
}

async function readTaggedDiff(worktree: string, mergeBase: string, pr: PullRequest): Promise<DiffFile[]> {
  return tagFiles(await readPrDiff(worktree, mergeBase, pr.headSha));
}

export async function buildWalkthrough(pr: PullRequest): Promise<BuiltJob<WalkthroughData>> {
  const checkout = await ensureCheckout(pr);
  const files = await readTaggedDiff(checkout.worktree, checkout.mergeBase, pr);
  const removed = await traceRemovedCode(checkout.mirror, files, checkout.mergeBase, pr.headSha);
  const ruleFiles = await collectRuleFiles(checkout.worktree);
  const built = await askClaudeWithRetry({
    cwd: checkout.worktree,
    prompt: walkthroughPrompt({ pr, files, removed, ruleFiles }),
    jsonSchema: walkthroughJsonSchema,
    parse: (raw) => walkthroughSchema.parse(raw),
    addDirs: [config.rulesDir, config.conceptsDir],
  });
  const walkthrough = await checkWalkthroughProofs(built.data, lineCounterFor(checkout.worktree, checkout.mergeBase));
  return { data: { walkthrough, files, removed, plainNotes: true, plainQuestions: true }, sessionId: built.sessionId };
}

export async function buildTriage(pr: PullRequest): Promise<BuiltJob<TriageData>> {
  const checkout = await ensureCheckout(pr);
  const files = await readTaggedDiff(checkout.worktree, checkout.mergeBase, pr);
  const built = await askClaudeWithRetry({
    cwd: checkout.worktree,
    prompt: triagePrompt({ pr, files }),
    jsonSchema: triageJsonSchema,
    parse: (raw) => triageSchema.parse(raw),
    addDirs: [config.conceptsDir],
  });
  const triage = await checkTriageProofs(built.data, lineCounterFor(checkout.worktree, checkout.mergeBase));
  return { data: { triage, files }, sessionId: built.sessionId };
}

export type PreviousBuild<T> = { data: T; builtFor: string; sessionId: string | null };

type UpdateContext = { pr: PullRequest; worktree: string; mirror: string; files: DiffFile[]; previous: PreviousBuild<WalkthroughData> };

function updateIdPrefix(pr: PullRequest): string {
  return `u${pr.headSha.slice(0, 7)}-`;
}

async function askForUpdate(context: UpdateContext, plan: UpdatePlan): Promise<BuiltJob<WalkthroughUpdate>> {
  const { pr, files, previous } = context;
  const redoFiles = files.filter((file) => plan.redo.includes(file.path));
  const oldStops = previous.data.walkthrough.tour.filter((stop) => plan.redo.includes(stop.file));
  return askClaudeWithRetry({
    cwd: context.worktree,
    prompt: walkthroughUpdatePrompt({
      pr, files, redoFiles, oldStops, walkthrough: previous.data.walkthrough, idPrefix: updateIdPrefix(pr),
      interdiff: await readInterdiff(context.mirror, previous.builtFor, pr.headSha, plan.redo),
      ruleFiles: await collectRuleFiles(context.worktree),
    }),
    jsonSchema: walkthroughUpdateJsonSchema,
    parse: (raw) => walkthroughUpdateSchema.parse(raw),
    addDirs: [config.rulesDir, config.conceptsDir],
  });
}

/** Redoes only files whose changes changed; keeps every other stop and its question ids. */
export async function updateWalkthrough(pr: PullRequest, previous: PreviousBuild<WalkthroughData>): Promise<BuiltJob<WalkthroughData>> {
  const checkout = await ensureCheckout(pr);
  const files = await readTaggedDiff(checkout.worktree, checkout.mergeBase, pr);
  const removed = await traceRemovedCode(checkout.mirror, files, checkout.mergeBase, pr.headSha);
  const plan = planUpdate(previous.data, files);
  const context = { pr, worktree: checkout.worktree, mirror: checkout.mirror, files, previous };
  const asked = plan.redo.length > 0 ? await askForUpdate(context, plan) : undefined;
  const change = { fromSha: previous.builtFor, toSha: pr.headSha, at: new Date().toISOString() };
  const merged = mergeUpdate({ previous: previous.data, plan, update: asked?.data, newFiles: files, removed, change, idPrefix: updateIdPrefix(pr) });
  const walkthrough = await checkWalkthroughProofs(merged.walkthrough, lineCounterFor(checkout.worktree, checkout.mergeBase));
  return { data: { ...merged, walkthrough, plainNotes: previous.data.plainNotes, plainQuestions: previous.data.plainQuestions }, sessionId: asked?.sessionId ?? previous.sessionId ?? randomUUID() };
}

function threadsNeedingTriage(pr: PullRequest, previousFingerprint: string): ReviewThread[] {
  const stamps = threadStamps(previousFingerprint);
  const isNewOrAnswered = (thread: ReviewThread) => stamps.get(thread.id) !== String(thread.comments.at(-1)?.databaseId);
  return pr.openThreads.filter(isNewOrAnswered);
}

/** Triages only threads that are new or got a new comment. */
export async function updateTriage(pr: PullRequest, previous: PreviousBuild<TriageData>): Promise<BuiltJob<TriageData>> {
  const changed = threadsNeedingTriage(pr, previous.builtFor);
  const changedIds = new Set(changed.map((thread) => thread.id));
  const openIds = new Set(pr.openThreads.map((thread) => thread.id));
  const keptVerdicts = previous.data.triage.threads.filter((verdict) => openIds.has(verdict.threadId) && !changedIds.has(verdict.threadId));
  if (changed.length === 0) return { data: { ...previous.data, triage: { threads: keptVerdicts } }, sessionId: previous.sessionId ?? randomUUID() };
  const built = await buildTriage({ ...pr, openThreads: changed });
  return { data: { ...built.data, triage: { threads: [...keptVerdicts, ...built.data.triage.threads] } }, sessionId: built.sessionId };
}

/** Chapters for the Guide, written from an existing walkthrough. */
export async function buildGuide(pr: PullRequest, walkthroughData: WalkthroughData): Promise<BuiltJob<Guide>> {
  const checkout = await ensureCheckout(pr);
  const { walkthrough, files } = walkthroughData;
  return askClaudeWithRetry({
    cwd: checkout.worktree,
    prompt: guidePrompt({
      pr,
      files,
      storySummary: `${walkthrough.story.whatItDoes}\n${walkthrough.story.whyNeeded}`,
      tourNotes: walkthrough.tour.map((stop) => ({ file: stop.file, whyItMatters: stop.whyItMatters })),
    }),
    jsonSchema: guideJsonSchema,
    parse: (raw) => guideSchema.parse(raw),
    addDirs: [],
  });
}
