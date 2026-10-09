import type { PullRequest } from "./types.ts";

export type MyPrSection = "waiting-on-me" | "draft" | "no-reviewer" | "approved" | "waiting-on-others";

function isWaitingOnMe(pr: PullRequest): boolean {
  return pr.openThreads.length > 0 || pr.reviewDecision === "CHANGES_REQUESTED";
}

/** Where one of my PRs stands: the first rule that matches wins. */
export function sectionOf(pr: PullRequest): MyPrSection {
  if (isWaitingOnMe(pr)) return "waiting-on-me";
  if (pr.isDraft) return "draft";
  if (pr.reviewDecision === "APPROVED") return "approved";
  if ((pr.reviewerCount ?? 0) === 0) return "no-reviewer";
  return "waiting-on-others";
}

// - off: only Prepare clicks spend tokens. reviews: PRs I am asked to review. all: those plus my drafts and comments.
export type AutoPrepare = "off" | "reviews" | "all";

export const AUTO_PREPARE_MODES: AutoPrepare[] = ["off", "reviews", "all"];

function needsMe(pr: PullRequest): boolean {
  return pr.kind === "review" || pr.isDraft || pr.openThreads.length > 0;
}

/** Whether a PR gets built without a Prepare click, under the chosen setting. */
export function isBuiltAutomatically(pr: PullRequest, mode: AutoPrepare): boolean {
  if (mode === "off") return false;
  if (mode === "reviews") return pr.kind === "review";
  return needsMe(pr);
}
