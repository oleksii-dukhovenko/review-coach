import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";

import { answerQuestion, type Question } from "./ask.ts";
import { listConcepts, saveConcept, type Concept } from "./concepts.ts";
import { getJob, getPr, getReviewState, getSetting, listAsks, listInboxPrs, saveReviewState, type JobRecord } from "./db.ts";
import { refreshAndRecord } from "./inbox.ts";
import { replyToThread, submitReview, type ReviewSubmission } from "./posting.ts";
import { enqueue, isPaused, resumeQueue } from "./queue.ts";
import { findReferences, isIdentifier, readSnippet } from "./references.ts";
import { prKeyOf, type PullRequest } from "./types.ts";
import { threadsFingerprint } from "./walkthrough.ts";

function jobKindFor(pr: PullRequest) {
  return pr.kind === "review" ? "walkthrough" : "triage";
}

function currentBuildTarget(pr: PullRequest): string {
  return pr.kind === "review" ? pr.headSha : threadsFingerprint(pr);
}

function isOutOfDate(pr: PullRequest, job: JobRecord | undefined): boolean {
  return job?.status === "ready" && job.builtFor !== currentBuildTarget(pr);
}

function inboxRow(pr: PullRequest) {
  const job = getJob(pr.key, jobKindFor(pr));
  return {
    key: pr.key, owner: pr.owner, repo: pr.repo, number: pr.number, kind: pr.kind,
    title: pr.title, author: pr.author, url: pr.url, additions: pr.additions, deletions: pr.deletions,
    updatedAt: pr.updatedAt, openThreadCount: pr.openThreads.length,
    status: job?.status ?? "none", error: job?.error ?? null, isOutOfDate: isOutOfDate(pr, job),
  };
}

function prKeyFromParams(context: Context): string {
  return prKeyOf(context.req.param("owner")!, context.req.param("repo")!, Number(context.req.param("number")));
}

function requirePr(context: Context): PullRequest {
  const pr = getPr(prKeyFromParams(context));
  if (!pr) throw new Error("PR not found in the inbox");
  return pr;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildRoutes(): Hono {
  const api = new Hono();
  const prPath = "/pr/:owner/:repo/:number";

  api.onError((error, context) => context.json({ error: errorMessage(error) }, 500));

  api.get("/inbox", (context) => {
    const rows = listInboxPrs().map(inboxRow);
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
    const job = getJob(pr.key, jobKindFor(pr));
    return context.json({
      pr, job: job ?? null, isOutOfDate: isOutOfDate(pr, job),
      reviewState: getReviewState(pr.key), asks: listAsks(pr.key), concepts: listConcepts(),
    });
  });

  api.post(`${prPath}/prepare`, (context) => {
    const pr = requirePr(context);
    enqueue({ prKey: pr.key, kind: jobKindFor(pr) });
    return context.json({ ok: true });
  });

  api.put(`${prPath}/state`, async (context) => {
    saveReviewState(requirePr(context).key, await context.req.json());
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
    const word = context.req.query("word") ?? "";
    if (!isIdentifier(word)) return context.json({ error: "Not a name" }, 400);
    return context.json(await findReferences(requirePr(context), word, context.req.query("file") ?? ""));
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
