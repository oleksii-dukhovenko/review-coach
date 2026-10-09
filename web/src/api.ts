import type { Concept } from "../../server/concepts.ts";
import type { AskRecord, JobRecord } from "../../server/db.ts";
import type { ReviewCommentInput, ReviewEvent } from "../../server/github.ts";
import type { MainJobKind } from "../../server/jobKinds.ts";
import type { MyPrSection } from "../../server/myPrSections.ts";
import type { JobStatus, PrKind, PullRequest } from "../../server/types.ts";

export type { MyPrSection };
export type { Concept, AskRecord, JobRecord, MainJobKind, ReviewCommentInput, ReviewEvent, PullRequest };
export type { Walkthrough, Triage, Guide, HardIdea, PictureNode } from "../../server/schemas.ts";
import type { PictureNode } from "../../server/schemas.ts";
export type { WalkthroughData, TriageData } from "../../server/walkthrough.ts";
export type { WalkthroughChange } from "../../server/walkthroughMerge.ts";
export type { DiffFile, DiffHunk, DiffLine, RemovedSymbol, SymbolUse } from "../../server/types.ts";
export type { FileView, Reference, ReferenceQuery, ReferenceSearch, Snippet } from "../../server/references.ts";
import type { FileView, ReferenceQuery, ReferenceSearch, Snippet } from "../../server/references.ts";

export type InboxRow = {
  key: string;
  owner: string;
  repo: string;
  number: number;
  kind: PrKind;
  isDraft: boolean;
  title: string;
  author: string;
  url: string;
  additions: number;
  deletions: number;
  updatedAt: string;
  openThreadCount: number;
  autoUpdate: boolean;
  status: JobStatus;
  error: string | null;
  isOutOfDate: boolean;
  // - Only on my own PRs.
  section: MyPrSection | null;
};

export type Inbox = {
  review: InboxRow[];
  mine: InboxRow[];
  paused: boolean;
  lastPollAt: string | null;
  lastPollError: string | null;
};

export type PrPageData = {
  pr: PullRequest;
  // - Triage first, then walkthrough.
  jobKinds: MainJobKind[];
  walkthrough: JobRecord | null;
  triage: JobRecord | null;
  guide: JobRecord | null;
  outOfDate: Record<MainJobKind, boolean>;
  autoUpdate: boolean;
  reviewState: Record<string, unknown>;
  asks: AskRecord[];
  concepts: Concept[];
};

export type PrRoute = { owner: string; repo: string; number: number };

async function requestJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Request failed: ${response.status}`);
  return payload as T;
}

function queryString(values: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();
}

function prUrl(route: PrRoute): string {
  return `/api/pr/${route.owner}/${route.repo}/${route.number}`;
}

export const api = {
  inbox: () => requestJson<Inbox>("GET", "/api/inbox"),
  refreshInbox: () => requestJson("POST", "/api/inbox/refresh"),
  resumeQueue: () => requestJson("POST", "/api/queue/resume"),
  setAutoUpdate: (route: PrRoute, isOn: boolean) => requestJson<{ isOn: boolean }>("PUT", `${prUrl(route)}/auto-update`, { isOn }),
  prPage: (route: PrRoute) => requestJson<PrPageData>("GET", prUrl(route)),
  prepare: (route: PrRoute) => requestJson("POST", `${prUrl(route)}/prepare`),
  rebuild: (route: PrRoute) => requestJson("POST", `${prUrl(route)}/prepare?force=1`),
  prepareGuide: (route: PrRoute) => requestJson("POST", `${prUrl(route)}/prepare-guide`),
  saveState: (route: PrRoute, state: unknown) => requestJson("PUT", `${prUrl(route)}/state`, state),
  // - keepalive lets the save finish while the page closes or reloads.
  saveStateWhileLeaving: (route: PrRoute, state: unknown) =>
    void fetch(`${prUrl(route)}/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state), keepalive: true }),
  submitReview: (route: PrRoute, review: { event: ReviewEvent; body: string; comments: ReviewCommentInput[] }) =>
    requestJson<{ url: string }>("POST", `${prUrl(route)}/review`, review),
  reply: (route: PrRoute, threadId: string, body: string) =>
    requestJson<{ url: string }>("POST", `${prUrl(route)}/reply`, { threadId, body }),
  saveConcept: (concept: Concept) => requestJson<Concept>("POST", "/api/concepts", concept),
  references: (route: PrRoute, query: ReferenceQuery) =>
    requestJson<ReferenceSearch>("GET", `${prUrl(route)}/references?${queryString(query)}`),
  file: (route: PrRoute, file: string) => requestJson<FileView>("GET", `${prUrl(route)}/file?${new URLSearchParams({ file })}`),
  snippet: (route: PrRoute, file: string, line: number) =>
    requestJson<Snippet>("GET", `${prUrl(route)}/snippet?${new URLSearchParams({ file, line: String(line) })}`),
  rewriteInPlainWords: (route: PrRoute) => requestJson<{ ok: boolean }>("POST", `${prUrl(route)}/plain-words`),
  openInEditor: (route: PrRoute, file?: string) =>
    requestJson<{ ok: boolean }>("POST", `${prUrl(route)}/open-in-editor${file ? `?${new URLSearchParams({ file })}` : ""}`),
  pictureNodes: (route: PrRoute) => requestJson<PictureNode[]>("POST", `${prUrl(route)}/picture-nodes`),
};

export type AskInput = {
  file: string;
  line: number;
  side: "LEFT" | "RIGHT";
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  question: string;
  keepInHistory?: boolean;
};

type SseEvent = { event: string; data: string };

function parseSseBlocks(buffer: string): { events: SseEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.map((block) => {
    const eventLine = block.split("\n").find((line) => line.startsWith("event:"));
    const dataLines = block.split("\n").filter((line) => line.startsWith("data:"));
    return { event: eventLine?.slice(6).trim() ?? "message", data: dataLines.map((line) => line.slice(5).trim()).join("\n") };
  });
  return { events, rest };
}

/** Streams an answer; onText gets the full answer so far. */
export async function askQuestion(route: PrRoute, input: AskInput, onText: (answerSoFar: string) => void): Promise<string> {
  const response = await fetch(`${prUrl(route)}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.body) throw new Error("No answer stream");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let answer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return answer;
    const parsed = parseSseBlocks(buffer + value);
    buffer = parsed.rest;
    for (const sseEvent of parsed.events) {
      if (sseEvent.event === "error") throw new Error(JSON.parse(sseEvent.data));
      if (sseEvent.event === "text") onText((answer += JSON.parse(sseEvent.data)));
    }
  }
}
