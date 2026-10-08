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

/** Drafts and comments for me get built right away; the rest wait for Prepare. */
export function isBuiltAutomatically(pr: PullRequest): boolean {
  if (pr.kind === "review") return true;
  return pr.isDraft || pr.openThreads.length > 0;
}
