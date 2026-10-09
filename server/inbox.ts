import { removeCheckout } from "./checkout.ts";
import { autoUpdateSettingKey, deletePrEverywhere, getJob, getSetting, hidePrFromInbox, listInboxPrs, saveSetting, savePr, type JobKind } from "./db.ts";
import { fetchPrState, fetchPullRequest, searchMyOpenPrs, searchReviewRequests } from "./github.ts";
import { isOutOfDate, mainJobKinds } from "./jobKinds.ts";
import { AUTO_PREPARE_MODES, isBuiltAutomatically, type AutoPrepare } from "./myPrSections.ts";
import { enqueue } from "./queue.ts";
import type { PrKind, PullRequest } from "./types.ts";

type PrRef = { owner: string; repo: string; number: number };

async function fetchAll(refs: PrRef[], kind: PrKind): Promise<PullRequest[]> {
  return Promise.all(refs.map((ref) => fetchPullRequest(ref, kind)));
}

function hasNeverBeenBuilt(pr: PullRequest, kind: JobKind): boolean {
  const status = getJob(pr.key, kind)?.status ?? "none";
  return status === "none";
}

function isWalkthroughReady(pr: PullRequest): boolean {
  return getJob(pr.key, "walkthrough")?.status === "ready";
}

export function autoPrepareMode(): AutoPrepare {
  const saved = getSetting("autoPrepare") as AutoPrepare | undefined;
  return saved && AUTO_PREPARE_MODES.includes(saved) ? saved : "off";
}

export function setAutoPrepareMode(mode: AutoPrepare): void {
  if (!AUTO_PREPARE_MODES.includes(mode)) throw new Error(`Unknown mode ${mode}`);
  saveSetting("autoPrepare", mode);
}

/** Prepares ahead only what the "Prepare automatically" setting allows. */
function queueFirstBuilds(prs: PullRequest[]): void {
  const mode = autoPrepareMode();
  for (const pr of prs.filter((candidate) => isBuiltAutomatically(candidate, mode))) {
    const unbuiltKinds = mainJobKinds(pr).filter((kind) => hasNeverBeenBuilt(pr, kind));
    unbuiltKinds.forEach((kind) => enqueue({ prKey: pr.key, kind }));
    const needsGuide = isWalkthroughReady(pr) && hasNeverBeenBuilt(pr, "guide");
    if (needsGuide) enqueue({ prKey: pr.key, kind: "guide" });
  }
}

export function isAutoUpdateOn(prKey: string): boolean {
  return getSetting(autoUpdateSettingKey(prKey)) === "true";
}

export function setAutoUpdate(prKey: string, isOn: boolean): void {
  saveSetting(autoUpdateSettingKey(prKey), String(isOn));
}

/** Only PRs you turned it on for, and only finished builds that fell behind. */
function queueUpdates(prs: PullRequest[]): void {
  for (const pr of prs.filter((candidate) => isAutoUpdateOn(candidate.key))) {
    const behindKinds = mainJobKinds(pr).filter((kind) => isOutOfDate(pr, kind, getJob(pr.key, kind)));
    behindKinds.forEach((kind) => enqueue({ prKey: pr.key, kind }));
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
  const myPrs = await fetchAll(myRefs, "mine");
  const current = [...reviewPrs, ...myPrs];
  await cleanUpDroppedPrs(new Set(current.map((pr) => pr.key)));
  current.forEach(savePr);
  queueFirstBuilds(current);
  queueUpdates(current);
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
