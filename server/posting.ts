import { isSpanInOneHunk } from "./anchors.ts";
import { getJob, getPr } from "./db.ts";
import { isLineInDiff } from "./diff.ts";
import { postReview, postThreadReply, type ReviewCommentInput, type ReviewEvent } from "./github.ts";
import type { DiffFile, PullRequest } from "./types.ts";

export type ReviewSubmission = { event: ReviewEvent; body: string; comments: ReviewCommentInput[] };

function requirePr(prKey: string): PullRequest {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`Unknown PR ${prKey}`);
  return pr;
}

function isAnchorable(comment: ReviewCommentInput, files: DiffFile[]): boolean {
  const file = files.find((diffFile) => diffFile.path === comment.path);
  return file !== undefined && isLineInDiff(file, comment.line, comment.side);
}

function asBodyBullet(comment: ReviewCommentInput): string {
  return `- \`${comment.path}:${comment.line}\`: ${comment.body.replace(/\n/g, " ")}`;
}

function spanOf(comment: ReviewCommentInput) {
  return { line: comment.line, side: comment.side, startLine: comment.start_line, startSide: comment.start_side };
}

/** A range GitHub would reject becomes a one-line comment that names the range. */
function fitRangeToDiff(comment: ReviewCommentInput, files: DiffFile[]): ReviewCommentInput {
  if (comment.start_line === undefined) return comment;
  const file = files.find((diffFile) => diffFile.path === comment.path);
  if (file && isSpanInOneHunk(file, spanOf(comment))) return comment;
  const { start_line: startLine, start_side: _startSide, ...oneLine } = comment;
  return { ...oneLine, body: `Lines ${startLine}-${comment.line}: ${comment.body}` };
}

/** Comments GitHub cannot pin to a diff line go into the body. */
function splitByAnchor(comments: ReviewCommentInput[], files: DiffFile[]) {
  const anchored = comments.filter((comment) => isAnchorable(comment, files));
  const unanchored = comments.filter((comment) => !isAnchorable(comment, files));
  return { anchored, unanchored };
}

function bodyWithUnanchored(body: string, unanchored: ReviewCommentInput[]): string {
  if (unanchored.length === 0) return body;
  return [body, "", ...unanchored.map(asBodyBullet)].join("\n").trim();
}

export async function submitReview(prKey: string, submission: ReviewSubmission): Promise<string> {
  const pr = requirePr(prKey);
  const job = getJob(prKey, "walkthrough");
  if (!job?.builtFor) throw new Error("This PR has no walkthrough to review against");
  const files = (job.data as { files: DiffFile[] }).files;
  const fitted = submission.comments.map((comment) => fitRangeToDiff(comment, files));
  const { anchored, unanchored } = splitByAnchor(fitted, files);
  return postReview(pr, {
    event: submission.event,
    body: bodyWithUnanchored(submission.body, unanchored),
    comments: anchored,
    commitSha: job.builtFor,
  });
}

export async function replyToThread(prKey: string, threadId: string, body: string): Promise<string> {
  const pr = requirePr(prKey);
  const thread = pr.openThreads.find((openThread) => openThread.id === threadId);
  const lastComment = thread?.comments.at(-1);
  if (!lastComment) throw new Error(`Thread ${threadId} is no longer open`);
  return postThreadReply(pr, lastComment.databaseId, body);
}
