import { removeCheckout } from "./checkout.ts";
import { deletePrEverywhere, getJob, hidePrFromInbox, listInboxPrs, saveSetting, savePr, type JobKind } from "./db.ts";
import { fetchPrState, fetchPullRequest, searchMyOpenPrs, searchReviewRequests } from "./github.ts";
import { enqueue } from "./queue.ts";
import type { PrKind, PullRequest } from "./types.ts";

type PrRef = { owner: string; repo: string; number: number };

async function fetchAll(refs: PrRef[], kind: PrKind): Promise<PullRequest[]> {
  return Promise.all(refs.map((ref) => fetchPullRequest(ref, kind)));
}

function hasThreadsWaitingOnMe(pr: PullRequest): boolean {
  return pr.openThreads.length > 0;
}

function hasNeverBeenBuilt(pr: PullRequest, kind: JobKind): boolean {
  const status = getJob(pr.key, kind)?.status ?? "none";
  return status === "none";
}

function isWalkthroughReady(pr: PullRequest): boolean {
  return getJob(pr.key, "walkthrough")?.status === "ready";
}

/** Prepares ahead only what you will almost always open. */
function queueFirstBuilds(prs: PullRequest[]): void {
  for (const pr of prs) {
    const kind = pr.kind === "review" ? "walkthrough" : "triage";
    if (hasNeverBeenBuilt(pr, kind)) enqueue({ prKey: pr.key, kind });
    const needsGuide = isWalkthroughReady(pr) && hasNeverBeenBuilt(pr, "guide");
    if (needsGuide) enqueue({ prKey: pr.key, kind: "guide" });
  }
}

async function cleanUpDroppedPr(pr: PullRequest): Promise<void> {
  const state = await fetchPrState(pr);
  if (state === "OPEN") {
    hidePrFromInbox(pr.key);
    return;
  }
  await removeCheckout(pr);
  deletePrEverywhere(pr.key);
}

async function cleanUpDroppedPrs(currentKeys: Set<string>): Promise<void> {
  const dropped = listInboxPrs().filter((pr) => !currentKeys.has(pr.key));
  for (const pr of dropped) await cleanUpDroppedPr(pr);
}

export async function refreshInbox(): Promise<void> {
  const [reviewRefs, myRefs] = await Promise.all([searchReviewRequests(), searchMyOpenPrs()]);
  const reviewPrs = await fetchAll(reviewRefs, "review");
  const myPrs = (await fetchAll(myRefs, "mine")).filter(hasThreadsWaitingOnMe);
  const current = [...reviewPrs, ...myPrs];
  await cleanUpDroppedPrs(new Set(current.map((pr) => pr.key)));
  current.forEach(savePr);
  queueFirstBuilds(current);
}

export async function refreshAndRecord(): Promise<void> {
  try {
    await refreshInbox();
    saveSetting("lastPollError", "");
  } catch (error) {
    saveSetting("lastPollError", error instanceof Error ? error.message : String(error));
  }
  saveSetting("lastPollAt", new Date().toISOString());
}

export function startInboxWatcher(pollMinutes: number): void {
  void refreshAndRecord();
  setInterval(() => void refreshAndRecord(), pollMinutes * 60 * 1000);
}
