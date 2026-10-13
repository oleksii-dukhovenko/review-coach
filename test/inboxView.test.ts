import { describe, expect, it } from "vitest";

import type { Inbox, InboxRow } from "../web/src/api.ts";
import { isReadyToRead, matchesQuery, matchesShow, rowsOfSection, timeAgo } from "../web/src/inboxView.ts";

function row(overrides: Partial<InboxRow>): InboxRow {
  return {
    key: "acme/api#1", owner: "acme", repo: "api", number: 1, kind: "review", isDraft: false, title: "Retry webhooks",
    author: "dana", url: "", additions: 1, deletions: 1, updatedAt: "2026-01-01T00:00:00Z", openThreadCount: 0,
    autoUpdate: false, status: "none", error: null, isOutOfDate: false, section: null, ...overrides,
  };
}

describe("inbox rows", () => {
  it("counts a ready row as readable only while it is current", () => {
    expect(isReadyToRead(row({ status: "ready" }))).toBe(true);
    expect(isReadyToRead(row({ status: "ready", isOutOfDate: true }))).toBe(false);
  });

  it("shows never-built and failed rows as unprepared", () => {
    expect(matchesShow(row({ status: "none" }), "unprepared")).toBe(true);
    expect(matchesShow(row({ status: "failed" }), "unprepared")).toBe(true);
    expect(matchesShow(row({ status: "building" }), "unprepared")).toBe(false);
    expect(matchesShow(row({ status: "building" }), "all")).toBe(true);
  });

  it("matches every word against title, repo, author and number", () => {
    const pr = row({ title: "Retry webhook deliveries", number: 412 });
    expect(matchesQuery(pr, "webhook dana")).toBe(true);
    expect(matchesQuery(pr, "acme/api #412")).toBe(true);
    expect(matchesQuery(pr, "webhook billing")).toBe(false);
  });

  it("splits my PRs by section", () => {
    const inbox = {
      review: [row({ key: "r" })],
      mine: [row({ key: "d", kind: "mine", section: "draft" }), row({ key: "a", kind: "mine", section: "approved" })],
    } as Inbox;
    expect(rowsOfSection(inbox, "review").map((pr) => pr.key)).toEqual(["r"]);
    expect(rowsOfSection(inbox, "draft").map((pr) => pr.key)).toEqual(["d"]);
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");
  it("reads like a person would say it", () => {
    expect(timeAgo("2026-03-10T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-03-10T11:35:00Z", now)).toBe("25 min ago");
    expect(timeAgo("2026-03-10T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-03-09T09:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-03-06T12:00:00Z", now)).toBe("4 days ago");
  });
});
