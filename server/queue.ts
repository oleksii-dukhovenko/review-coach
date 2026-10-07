import { UsageLimitError } from "./claude.ts";
import { getJob, getPr, getSetting, saveFinishedJob, saveSetting, setJobStatus, type JobKind, type JobRecord } from "./db.ts";
import { threadsFingerprint } from "./jobKinds.ts";
import type { PullRequest } from "./types.ts";
import {
  buildGuide, buildTriage, buildWalkthrough, updateTriage, updateWalkthrough, type PreviousBuild, type TriageData, type WalkthroughData,
} from "./walkthrough.ts";

// - isFullRebuild throws away the old build instead of updating it.
type Job = { prKey: string; kind: JobKind; isFullRebuild?: boolean };

const waitingJobs: Job[] = [];
let isRunning = false;

export function isPaused(): boolean {
  return getSetting("paused") === "true";
}

function findWaiting(job: Job): Job | undefined {
  return waitingJobs.find((waiting) => waiting.prKey === job.prKey && waiting.kind === job.kind);
}

export function enqueue(job: Job): void {
  const waiting = findWaiting(job);
  if (waiting) {
    waiting.isFullRebuild ||= job.isFullRebuild;
    return;
  }
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

/** The last finished build, if this job can update it instead of starting over. */
function previousBuild<T>(job: Job, record: JobRecord | undefined): PreviousBuild<T> | undefined {
  const canUpdate = !job.isFullRebuild && record?.data && record.builtFor;
  return canUpdate ? { data: record.data as T, builtFor: record.builtFor!, sessionId: record.sessionId } : undefined;
}

async function saveWalkthrough(job: Job, pr: PullRequest): Promise<void> {
  const previous = previousBuild<WalkthroughData>(job, getJob(pr.key, "walkthrough"));
  const built = previous ? await updateWalkthrough(pr, previous) : await buildWalkthrough(pr);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor: pr.headSha, data: built.data, sessionId: built.sessionId });
  enqueue({ prKey: pr.key, kind: "guide" });
}

async function saveTriage(job: Job, pr: PullRequest): Promise<void> {
  const previous = previousBuild<TriageData>(job, getJob(pr.key, "triage"));
  const built = previous ? await updateTriage(pr, previous) : await buildTriage(pr);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor: threadsFingerprint(pr), data: built.data, sessionId: built.sessionId });
}

/** The guide follows whichever walkthrough is on screen. */
async function saveGuide(job: Job, pr: PullRequest): Promise<void> {
  const walkthroughJob = getJob(pr.key, "walkthrough");
  const builtFor = walkthroughJob?.status === "ready" ? walkthroughJob.builtFor : null;
  if (!builtFor) throw new Error("Prepare the walkthrough first");
  const built = await buildGuide(pr, walkthroughJob!.data as WalkthroughData);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor, data: built.data, sessionId: built.sessionId });
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
