import { randomUUID } from "node:crypto";

import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson, UsageLimitError } from "./claude.ts";
import { config } from "./config.ts";
import { readPrDiff } from "./diff.ts";
import { tagFiles } from "./fileTags.ts";
import { checkProof, lineCounterFor } from "./proofCheck.ts";
import { guidePrompt, triagePrompt, walkthroughPrompt } from "./prompts.ts";
import { traceRemovedCode } from "./removedCode.ts";
import { collectRuleFiles } from "./rules.ts";
import {
  guideJsonSchema, guideSchema, triageJsonSchema, triageSchema, walkthroughJsonSchema, walkthroughSchema,
  type Guide, type Triage, type Walkthrough,
} from "./schemas.ts";
import type { DiffFile, PullRequest, RemovedSymbol } from "./types.ts";

export type WalkthroughData = { walkthrough: Walkthrough; files: DiffFile[]; removed: RemovedSymbol[] };

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
  return { data: { walkthrough, files, removed }, sessionId: built.sessionId };
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

/** Changes whenever a thread opens or gets a new comment. */
export function threadsFingerprint(pr: PullRequest): string {
  return pr.openThreads.map((thread) => `${thread.id}:${thread.comments.at(-1)?.databaseId}`).sort().join(",");
}
