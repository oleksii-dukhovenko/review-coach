import { describe, expect, it } from "vitest";

import { isBuiltAutomatically, sectionOf } from "../server/myPrSections.ts";
import type { PullRequest, ReviewThread } from "../server/types.ts";

function myPr(changes: Partial<PullRequest>): PullRequest {
  return {
    key: "o/r#1", owner: "o", repo: "r", number: 1, kind: "mine", isDraft: false, title: "", body: "", author: "me", url: "",
    headSha: "", baseSha: "", baseRef: "main", additions: 0, deletions: 0, updatedAt: "", openThreads: [],
    reviewDecision: null, reviewerCount: 1, ...changes,
  };
}

const thread = {} as ReviewThread;

describe("sectionOf", () => {
  it("puts comments waiting on me first, even on a draft", () => {
    expect(sectionOf(myPr({ isDraft: true, openThreads: [thread] }))).toBe("waiting-on-me");
  });

  it("counts requested changes as waiting on me", () => {
    expect(sectionOf(myPr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("waiting-on-me");
  });

  it("sorts the rest into draft, approved, no reviewer, and waiting on others", () => {
    expect(sectionOf(myPr({ isDraft: true }))).toBe("draft");
    expect(sectionOf(myPr({ reviewDecision: "APPROVED" }))).toBe("approved");
    expect(sectionOf(myPr({ reviewerCount: 0 }))).toBe("no-reviewer");
    expect(sectionOf(myPr({}))).toBe("waiting-on-others");
  });
});

describe("isBuiltAutomatically", () => {
  it("builds drafts and PRs with comments for me, not ones waiting on others", () => {
    expect(isBuiltAutomatically(myPr({ isDraft: true }))).toBe(true);
    expect(isBuiltAutomatically(myPr({ openThreads: [thread] }))).toBe(true);
    expect(isBuiltAutomatically(myPr({}))).toBe(false);
  });
});
