import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { answerQuestion, type Question } from "./ask.ts";
import { listConcepts, saveConcept, type Concept } from "./concepts.ts";
import { getJob, getPr, getReviewState, getSetting, listAsks, listInboxPrs, saveReviewState } from "./db.ts";
import { isAutoUpdateOn, refreshAndRecord, setAutoUpdate } from "./inbox.ts";
import { combinedStatus, isOutOfDate, mainJobKinds, needsPreparing, type MainJobKind } from "./jobKinds.ts";
import { replyToThread, submitReview, type ReviewSubmission } from "./posting.ts";
import { enqueue, isPaused, resumeQueue } from "./queue.ts";
import { findReferences, isIdentifier, readFileView, readSnippet, warmUpForPr, type ReferenceQuery } from "./references.ts";
import { prKeyOf, type PullRequest } from "./types.ts";

function mainJobs(pr: PullRequest) {
  return mainJobKinds(pr).map((kind) => ({ kind, job: getJob(pr.key, kind) }));
}

/** Most recently changed PRs first, so new commits and comments are on top. */
function byNewestActivity(left: PullRequest, right: PullRequest): number {
  return right.updatedAt.localeCompare(left.updatedAt);
}

function inboxRow(pr: PullRequest) {
  const jobs = mainJobs(pr);
  const failedJob = jobs.find(({ job }) => job?.status === "failed")?.job;
  return {
    key: pr.key, owner: pr.owner, repo: pr.repo, number: pr.number, kind: pr.kind, isDraft: pr.isDraft,
    title: pr.title, author: pr.author, url: pr.url, additions: pr.additions, deletions: pr.deletions,
    updatedAt: pr.updatedAt, openThreadCount: pr.openThreads.length, autoUpdate: isAutoUpdateOn(pr.key),
    status: combinedStatus(jobs.map(({ job }) => job?.status ?? "none")),
    error: failedJob?.error ?? null,
    isOutOfDate: jobs.some(({ kind, job }) => isOutOfDate(pr, kind, job)),
  };
}

function isKindOutOfDate(pr: PullRequest, kind: MainJobKind): boolean {
  return isOutOfDate(pr, kind, getJob(pr.key, kind));
}

/** Saves only the keys sent, so each page section keeps its own. */
function mergeReviewState(prKey: string, changes: object): void {
  saveReviewState(prKey, { ...(getReviewState(prKey) as object), ...changes });
}

function prKeyFromParams(context: Context): string {
  return prKeyOf(context.req.param("owner")!, context.req.param("repo")!, Number(context.req.param("number")));
}

function requirePr(context: Context): PullRequest {
  const pr = getPr(prKeyFromParams(context));
  if (!pr) throw new Error("PR not found in the inbox");
  return pr;
}

function referenceQueryFrom(context: Context): ReferenceQuery {
  return {
    word: context.req.query("word") ?? "",
    file: context.req.query("file") ?? "",
    line: Number(context.req.query("line")),
    column: Number(context.req.query("column")),
    side: context.req.query("side") === "LEFT" ? "LEFT" : "RIGHT",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildRoutes(): Hono {
  const api = new Hono();
  const prPath = "/pr/:owner/:repo/:number";

  api.onError((error, context) => context.json({ error: errorMessage(error) }, 500));

  api.get("/inbox", (context) => {
    const rows = listInboxPrs().sort(byNewestActivity).map(inboxRow);
    return context.json({
      review: rows.filter((row) => row.kind === "review"),
      mine: rows.filter((row) => row.kind === "mine"),
      paused: isPaused(),
      lastPollAt: getSetting("lastPollAt") ?? null,
      lastPollError: getSetting("lastPollError") || null,
    });
  });

  api.post("/inbox/refresh", async (context) => {
    await refreshAndRecord();
    return context.json({ ok: true });
  });

  api.post("/queue/resume", (context) => {
    resumeQueue();
    return context.json({ ok: true });
  });

  api.get(prPath, (context) => {
    const pr = requirePr(context);
    warmUpForPr(pr);
    return context.json({
      pr,
      jobKinds: mainJobKinds(pr),
      walkthrough: getJob(pr.key, "walkthrough") ?? null,
      triage: getJob(pr.key, "triage") ?? null,
      guide: getJob(pr.key, "guide") ?? null,
      outOfDate: { walkthrough: isKindOutOfDate(pr, "walkthrough"), triage: isKindOutOfDate(pr, "triage") },
      autoUpdate: isAutoUpdateOn(pr.key),
      reviewState: getReviewState(pr.key), asks: listAsks(pr.key), concepts: listConcepts(),
    });
  });

  api.post(`${prPath}/prepare`, (context) => {
    const pr = requirePr(context);
    const isForced = context.req.query("force") === "1";
    const jobsToBuild = mainJobs(pr).filter(({ kind, job }) => isForced || needsPreparing(pr, kind, job));
    jobsToBuild.forEach(({ kind }) => enqueue({ prKey: pr.key, kind, isFullRebuild: isForced }));
    return context.json({ ok: true });
  });

  api.put(`${prPath}/auto-update`, async (context) => {
    const pr = requirePr(context);
    const { isOn } = (await context.req.json()) as { isOn: boolean };
    setAutoUpdate(pr.key, isOn === true);
    return context.json({ isOn: isAutoUpdateOn(pr.key) });
  });

  api.post(`${prPath}/prepare-guide`, (context) => {
    enqueue({ prKey: requirePr(context).key, kind: "guide" });
    return context.json({ ok: true });
  });

  api.put(`${prPath}/state`, async (context) => {
    mergeReviewState(requirePr(context).key, await context.req.json());
    return context.json({ ok: true });
  });

  api.post(`${prPath}/ask`, async (context) => {
    const pr = requirePr(context);
    const question = (await context.req.json()) as Question;
    return streamSSE(context, async (stream) => {
      try {
        await answerQuestion(pr.key, question, (text) => void stream.writeSSE({ event: "text", data: JSON.stringify(text) }));
        await stream.writeSSE({ event: "done", data: "{}" });
      } catch (error) {
        await stream.writeSSE({ event: "error", data: JSON.stringify(errorMessage(error)) });
      }
    });
  });

  api.post(`${prPath}/review`, async (context) => {
    const url = await submitReview(requirePr(context).key, (await context.req.json()) as ReviewSubmission);
    return context.json({ url });
  });

  api.post(`${prPath}/reply`, async (context) => {
    const { threadId, body } = (await context.req.json()) as { threadId: string; body: string };
    const url = await replyToThread(requirePr(context).key, threadId, body);
    return context.json({ url });
  });

  api.get(`${prPath}/references`, async (context) => {
    const query = referenceQueryFrom(context);
    if (!isIdentifier(query.word)) return context.json({ error: "Not a name" }, 400);
    return context.json(await findReferences(requirePr(context), query));
  });

  api.get(`${prPath}/file`, async (context) => {
    return context.json(await readFileView(requirePr(context), context.req.query("file") ?? ""));
  });

  api.get(`${prPath}/snippet`, async (context) => {
    const file = context.req.query("file") ?? "";
    const line = Number(context.req.query("line"));
    return context.json(await readSnippet(requirePr(context), file, line, 7));
  });

  api.get("/concepts", (context) => context.json(listConcepts()));

  api.post("/concepts", async (context) => context.json(saveConcept((await context.req.json()) as Concept)));

  return api;
}
