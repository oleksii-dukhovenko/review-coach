import type { JobStatus, PullRequest } from "./types.ts";

export type MainJobKind = "walkthrough" | "triage";

export type JobSnapshot = { status: JobStatus; builtFor: string | null };

function wantsWalkthrough(pr: PullRequest): boolean {
  return pr.kind === "review" || pr.isDraft;
}

function wantsTriage(pr: PullRequest): boolean {
  return pr.openThreads.length > 0;
}

/** Triage comes first so comments sit above the walkthrough. */
export function mainJobKinds(pr: PullRequest): MainJobKind[] {
  const kinds: MainJobKind[] = [];
  if (wantsTriage(pr)) kinds.push("triage");
  if (wantsWalkthrough(pr)) kinds.push("walkthrough");
  return kinds;
}

/** Changes whenever a thread opens or gets a new comment. */
export function threadsFingerprint(pr: PullRequest): string {
  return pr.openThreads.map((thread) => `${thread.id}:${thread.comments.at(-1)?.databaseId}`).sort().join(",");
}

/** Last comment id per thread, read back from a fingerprint. */
export function threadStamps(fingerprint: string | null): Map<string, string> {
  const pairs = (fingerprint ?? "").split(",").filter(Boolean);
  return new Map(pairs.map((pair) => [pair.slice(0, pair.lastIndexOf(":")), pair.slice(pair.lastIndexOf(":") + 1)]));
}

export function currentBuildTarget(pr: PullRequest, kind: MainJobKind): string {
  return kind === "walkthrough" ? pr.headSha : threadsFingerprint(pr);
}

export function isOutOfDate(pr: PullRequest, kind: MainJobKind, job: JobSnapshot | undefined): boolean {
  return job?.status === "ready" && job.builtFor !== currentBuildTarget(pr, kind);
}

/** Not started, failed, or built for older code. */
export function needsPreparing(pr: PullRequest, kind: MainJobKind, job: JobSnapshot | undefined): boolean {
  const status = job?.status ?? "none";
  const notBuiltYet = status === "none" || status === "failed";
  return notBuiltYet || isOutOfDate(pr, kind, job);
}

const STATUS_URGENCY: JobStatus[] = ["failed", "building", "queued", "none", "ready"];

/** The status that most needs your attention. */
export function combinedStatus(statuses: JobStatus[]): JobStatus {
  return STATUS_URGENCY.find((status) => statuses.includes(status)) ?? "none";
}
