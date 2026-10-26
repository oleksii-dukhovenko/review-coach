import type { Inbox, InboxRow, MyPrSection } from "./api.ts";

// - "review" is other people's PRs; the rest are the sections of mine.
export type InboxSectionKey = "review" | MyPrSection;

// - ready: prepared and current. unprepared: never built, or the build failed.
export type InboxShow = "all" | "ready" | "unprepared";

export function isReadyToRead(row: InboxRow): boolean {
  return row.status === "ready" && !row.isOutOfDate;
}

export function isUnprepared(row: InboxRow): boolean {
  return row.status === "none" || row.status === "failed";
}

export function rowsOfSection(inbox: Inbox, key: InboxSectionKey): InboxRow[] {
  return key === "review" ? inbox.review : inbox.mine.filter((row) => row.section === key);
}

const SHOW_ORDER: readonly InboxShow[] = ["all", "ready", "unprepared"];

/** The Show filter after this one: all, ready, unprepared, then all again. */
export function nextShow(show: InboxShow): InboxShow {
  const nextIndex = (SHOW_ORDER.indexOf(show) + 1) % SHOW_ORDER.length;
  return SHOW_ORDER[nextIndex];
}

export function matchesShow(row: InboxRow, show: InboxShow): boolean {
  if (show === "ready") return isReadyToRead(row);
  if (show === "unprepared") return isUnprepared(row);
  return true;
}

/** Every word must appear in the title, repo, author, or number. */
export function matchesQuery(row: InboxRow, query: string): boolean {
  const haystack = `${row.title} ${row.owner}/${row.repo} ${row.author} #${row.number}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", or a date. */
export function timeAgo(isoTime: string, now = Date.now()): string {
  const elapsed = now - new Date(isoTime).getTime();
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(isoTime).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
