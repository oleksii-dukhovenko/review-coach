import { describe, expect, it } from "vitest";

import { combinedStatus, mainJobKinds, needsPreparing } from "../server/jobKinds.ts";
import type { PullRequest, ReviewThread } from "../server/types.ts";

const OPEN_THREAD: ReviewThread = {
  id: "thread-1", path: "server/order.go", line: 3, side: "RIGHT", isOutdated: false,
  comments: [{ databaseId: 7, author: "reviewer", body: "Why?", createdAt: "2026-10-01T00:00:00Z" }],
};

function pullRequest(overrides: Partial<PullRequest>): PullRequest {
  return {
    key: "acme/shop#1", owner: "acme", repo: "shop", number: 1, kind: "mine", isDraft: false,
    title: "Title", body: "", author: "me", url: "", headSha: "head", baseSha: "base", baseRef: "develop",
    additions: 1, deletions: 0, updatedAt: "", openThreads: [], ...overrides,
  };
}

describe("mainJobKinds", () => {
  it("gives someone else's PR a walkthrough", () => {
    expect(mainJobKinds(pullRequest({ kind: "review" }))).toEqual(["walkthrough"]);
  });

  it("gives my draft a walkthrough", () => {
    expect(mainJobKinds(pullRequest({ isDraft: true }))).toEqual(["walkthrough"]);
  });

  it("puts comments before the walkthrough on my draft", () => {
    expect(mainJobKinds(pullRequest({ isDraft: true, openThreads: [OPEN_THREAD] }))).toEqual(["triage", "walkthrough"]);
  });

  it("gives my ready PR with comments both comment help and a walkthrough", () => {
    expect(mainJobKinds(pullRequest({ openThreads: [OPEN_THREAD] }))).toEqual(["triage", "walkthrough"]);
  });

  it("offers my ready PR without comments a walkthrough", () => {
    expect(mainJobKinds(pullRequest({}))).toEqual(["walkthrough"]);
  });
});

describe("needsPreparing", () => {
  const draft = pullRequest({ isDraft: true });

  it("is true when never built", () => {
    expect(needsPreparing(draft, "walkthrough", undefined)).toBe(true);
  });

  it("is false when built for the current head", () => {
    expect(needsPreparing(draft, "walkthrough", { status: "ready", builtFor: "head" })).toBe(false);
  });

  it("is true when built for older code", () => {
    expect(needsPreparing(draft, "walkthrough", { status: "ready", builtFor: "older" })).toBe(true);
  });

  it("is false while building", () => {
    expect(needsPreparing(draft, "walkthrough", { status: "building", builtFor: null })).toBe(false);
  });
});

describe("combinedStatus", () => {
  it("shows a failure over a ready job", () => {
    expect(combinedStatus(["ready", "failed"])).toBe("failed");
  });

  it("is ready only when every job is ready", () => {
    expect(combinedStatus(["ready", "ready"])).toBe("ready");
    expect(combinedStatus(["ready", "none"])).toBe("none");
  });
});
