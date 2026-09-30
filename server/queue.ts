import { UsageLimitError } from "./claude.ts";
import { getJob, getPr, getSetting, saveFinishedJob, saveSetting, setJobStatus, type JobKind } from "./db.ts";
import type { PullRequest } from "./types.ts";
import { buildGuide, buildTriage, buildWalkthrough, threadsFingerprint, type WalkthroughData } from "./walkthrough.ts";

type Job = { prKey: string; kind: JobKind };

const waitingJobs: Job[] = [];
let isRunning = false;

export function isPaused(): boolean {
  return getSetting("paused") === "true";
}

function isAlreadyWaiting(job: Job): boolean {
  return waitingJobs.some((waiting) => waiting.prKey === job.prKey && waiting.kind === job.kind);
}

export function enqueue(job: Job): void {
  if (isAlreadyWaiting(job)) return;
  waitingJobs.push(job);
  setJobStatus(job.prKey, job.kind, "queued");
  void runNextJob();
}

export function resumeQueue(): void {
  saveSetting("paused", "false");
  void runNextJob();
}

function pauseForUsageLimit(job: Job, error: Error): void {
  saveSetting("paused", "true");
  waitingJobs.unshift(job);
  setJobStatus(job.prKey, job.kind, "queued", `Paused: ${error.message}`);
}

async function saveWalkthrough(job: Job, pr: PullRequest): Promise<void> {
  const built = await buildWalkthrough(pr);
  saveFinishedJob({ ...job, builtFor: pr.headSha, data: built.data, sessionId: built.sessionId });
  enqueue({ prKey: pr.key, kind: "guide" });
}

async function saveTriage(job: Job, pr: PullRequest): Promise<void> {
  const built = await buildTriage(pr);
  saveFinishedJob({ ...job, builtFor: threadsFingerprint(pr), data: built.data, sessionId: built.sessionId });
}

/** The guide follows whichever walkthrough is on screen. */
async function saveGuide(job: Job, pr: PullRequest): Promise<void> {
  const walkthroughJob = getJob(pr.key, "walkthrough");
  const builtFor = walkthroughJob?.status === "ready" ? walkthroughJob.builtFor : null;
  if (!builtFor) throw new Error("Prepare the walkthrough first");
  const built = await buildGuide(pr, walkthroughJob!.data as WalkthroughData);
  saveFinishedJob({ ...job, builtFor, data: built.data, sessionId: built.sessionId });
}

const BUILDERS: Record<JobKind, (job: Job, pr: PullRequest) => Promise<void>> = {
  walkthrough: saveWalkthrough,
  triage: saveTriage,
  guide: saveGuide,
};

async function buildAndSave(job: Job): Promise<void> {
  const pr = getPr(job.prKey);
  if (!pr) throw new Error(`PR ${job.prKey} is no longer in the inbox`);
  await BUILDERS[job.kind](job, pr);
}

/** Runs one job at a time to go easy on usage. */
async function runNextJob(): Promise<void> {
  if (isRunning || isPaused() || waitingJobs.length === 0) return;
  isRunning = true;
  const job = waitingJobs.shift()!;
  setJobStatus(job.prKey, job.kind, "building");
  try {
    await buildAndSave(job);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (failure instanceof UsageLimitError) pauseForUsageLimit(job, failure);
    else setJobStatus(job.prKey, job.kind, "failed", failure.message);
  } finally {
    isRunning = false;
    void runNextJob();
  }
}
