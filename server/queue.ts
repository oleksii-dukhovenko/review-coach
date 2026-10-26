import { randomUUID } from "node:crypto";

import { buildAnatomy } from "./anatomy.ts";
import { UsageLimitError } from "./claude.ts";
import { getJob, getPr, getSetting, saveFinishedJob, saveSetting, setJobStatus, type JobKind, type JobRecord } from "./db.ts";
import { threadsFingerprint } from "./jobKinds.ts";
import { canReuseAnatomy, hasTrainSceneFor, trainFingerprint } from "./sceneCheck.ts";
import type { Train } from "./sceneSchema.ts";
import { buildTrainScene, forgetTrain, rememberTrain, savedTrain } from "./trainAnatomy.ts";
import { findTrain } from "./trains.ts";
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
  enqueue({ prKey: pr.key, kind: "anatomy" });
  void queueTrainFor(pr);
}

async function saveTriage(job: Job, pr: PullRequest): Promise<void> {
  const previous = previousBuild<TriageData>(job, getJob(pr.key, "triage"));
  const built = previous ? await updateTriage(pr, previous) : await buildTriage(pr);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor: threadsFingerprint(pr), data: built.data, sessionId: built.sessionId });
}

type ReadyWalkthrough = { builtFor: string; data: WalkthroughData };

function readyWalkthrough(pr: PullRequest): ReadyWalkthrough {
  const walkthroughJob = getJob(pr.key, "walkthrough");
  const builtFor = walkthroughJob?.status === "ready" ? walkthroughJob.builtFor : null;
  if (!builtFor) throw new Error("Prepare the walkthrough first");
  return { builtFor, data: walkthroughJob!.data as WalkthroughData };
}

/** The guide follows whichever walkthrough is on screen. */
async function saveGuide(job: Job, pr: PullRequest): Promise<void> {
  const walkthrough = readyWalkthrough(pr);
  const built = await buildGuide(pr, walkthrough.data);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor: walkthrough.builtFor, data: built.data, sessionId: built.sessionId });
}

/** A saved build kept as it is, to be stamped for newer code. */
function sameBuild(previous: JobRecord): { data: unknown; sessionId: string } {
  return { data: previous.data, sessionId: previous.sessionId ?? randomUUID() };
}

/** The playing picture follows the walkthrough; an unchanged story keeps its picture. */
async function saveAnatomy(job: Job, pr: PullRequest): Promise<void> {
  const walkthrough = readyWalkthrough(pr);
  const previous = getJob(pr.key, "anatomy");
  const canReuse = canReuseAnatomy(previous?.data, walkthrough.data.walkthrough, job.isFullRebuild === true);
  const built = canReuse ? sameBuild(previous!) : await buildAnatomy(pr, walkthrough.data);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor: walkthrough.builtFor, data: built.data, sessionId: built.sessionId });
}

/** Saves the PR's train and queues its picture unless it is up to date. */
function queueTrainScene(pr: PullRequest, train: Train): void {
  rememberTrain(pr.key, train);
  const isUpToDate = hasTrainSceneFor(getJob(train.key, "train"), trainFingerprint(train));
  if (!isUpToDate) enqueue({ prKey: train.key, kind: "train" });
}

/** Looks the PR's train up on GitHub; a failure here never fails the walkthrough. */
async function queueTrainFor(pr: PullRequest): Promise<void> {
  try {
    const train = await findTrain(pr);
    if (train) queueTrainScene(pr, train);
    else forgetTrain(pr.key);
  } catch (error) {
    console.warn(`Could not look up the train for ${pr.key}:`, error);
  }
}

/** One picture per train, shared by its PRs; made again only when members change. */
async function saveTrainScene(job: Job): Promise<void> {
  const train = savedTrain(job.prKey);
  if (!train) throw new Error(`Train ${job.prKey} is not known`);
  const builtFor = trainFingerprint(train);
  const previous = getJob(job.prKey, "train");
  const isUpToDate = hasTrainSceneFor(previous, builtFor);
  const built = isUpToDate ? sameBuild(previous!) : await buildTrainScene(train);
  saveFinishedJob({ prKey: job.prKey, kind: job.kind, builtFor, data: built.data, sessionId: built.sessionId });
}

function requireInboxPr(prKey: string): PullRequest {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`PR ${prKey} is no longer in the inbox`);
  return pr;
}

/** Runs a PR job's builder with that PR. */
function withPr(builder: (job: Job, pr: PullRequest) => Promise<void>): (job: Job) => Promise<void> {
  return (job) => builder(job, requireInboxPr(job.prKey));
}

const BUILDERS: Record<JobKind, (job: Job) => Promise<void>> = {
  walkthrough: withPr(saveWalkthrough),
  triage: withPr(saveTriage),
  guide: withPr(saveGuide),
  anatomy: withPr(saveAnatomy),
  // - Keyed by the train, not by a PR.
  train: saveTrainScene,
};

async function buildAndSave(job: Job): Promise<void> {
  await BUILDERS[job.kind](job);
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
