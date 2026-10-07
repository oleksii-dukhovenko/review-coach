import { runOrThrow } from "./shell.ts";
import { prKeyOf, type PrKind, type PullRequest, type ReviewThread } from "./types.ts";

type PrRef = { owner: string; repo: string; number: number };

type SearchHit = { number: number; repository: { nameWithOwner: string } };

const PULL_REQUEST_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      title body url state isDraft updatedAt additions deletions
      headRefOid baseRefOid baseRefName author { login }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line diffSide
          comments(first: 50) { nodes { databaseId author { login } body createdAt } }
        }
      }
    }
  }
}`;

let cachedViewerLogin: string | undefined;

async function runGh(args: string[], input?: string): Promise<string> {
  return runOrThrow("gh", args, { input });
}

async function runGhJson<T>(args: string[], input?: string): Promise<T> {
  return JSON.parse(await runGh(args, input)) as T;
}

export async function fetchViewerLogin(): Promise<string> {
  cachedViewerLogin ??= (await runGh(["api", "user", "--jq", ".login"])).trim();
  return cachedViewerLogin;
}

async function searchOpenPrs(filter: string): Promise<PrRef[]> {
  const hits = await runGhJson<SearchHit[]>([
    "search", "prs", filter, "--state=open", "--json", "number,repository", "--limit", "50",
  ]);
  return hits.map(toPrRef);
}

function toPrRef(hit: SearchHit): PrRef {
  const [owner, repo] = hit.repository.nameWithOwner.split("/");
  return { owner, repo, number: hit.number };
}

export function searchReviewRequests(): Promise<PrRef[]> {
  return searchOpenPrs("--review-requested=@me");
}

export function searchMyOpenPrs(): Promise<PrRef[]> {
  return searchOpenPrs("--author=@me");
}

type RawComment = { databaseId: number; author: { login: string } | null; body: string; createdAt: string };

type RawThread = {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  diffSide: "LEFT" | "RIGHT";
  comments: { nodes: RawComment[] };
};

type RawPullRequest = {
  title: string;
  body: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  updatedAt: string;
  additions: number;
  deletions: number;
  headRefOid: string;
  baseRefOid: string;
  baseRefName: string;
  author: { login: string } | null;
  reviewThreads: { nodes: RawThread[] };
};

async function fetchRawPullRequest(ref: PrRef): Promise<RawPullRequest> {
  const response = await runGhJson<{ data: { repository: { pullRequest: RawPullRequest } } }>([
    "api", "graphql",
    "-F", `owner=${ref.owner}`, "-F", `name=${ref.repo}`, "-F", `number=${ref.number}`,
    "-f", `query=${PULL_REQUEST_QUERY}`,
  ]);
  return response.data.repository.pullRequest;
}

function toReviewThread(raw: RawThread): ReviewThread {
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line,
    side: raw.diffSide,
    isOutdated: raw.isOutdated,
    comments: raw.comments.nodes.map((comment) => ({
      databaseId: comment.databaseId,
      author: comment.author?.login ?? "ghost",
      body: comment.body,
      createdAt: comment.createdAt,
    })),
  };
}

/** A thread waits on me when it is open and someone else spoke last. */
function isWaitingOnMe(thread: ReviewThread, viewerLogin: string): boolean {
  const lastComment = thread.comments.at(-1);
  return lastComment !== undefined && lastComment.author !== viewerLogin;
}

function openThreadsWaitingOnMe(raw: RawPullRequest, viewerLogin: string): ReviewThread[] {
  const openThreads = raw.reviewThreads.nodes.filter((thread) => !thread.isResolved).map(toReviewThread);
  return openThreads.filter((thread) => isWaitingOnMe(thread, viewerLogin));
}

export async function fetchPullRequest(ref: PrRef, kind: PrKind): Promise<PullRequest> {
  const raw = await fetchRawPullRequest(ref);
  const viewerLogin = await fetchViewerLogin();
  return {
    key: prKeyOf(ref.owner, ref.repo, ref.number),
    ...ref,
    kind,
    isDraft: raw.isDraft,
    title: raw.title,
    body: raw.body,
    author: raw.author?.login ?? "ghost",
    url: raw.url,
    headSha: raw.headRefOid,
    baseSha: raw.baseRefOid,
    baseRef: raw.baseRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    updatedAt: raw.updatedAt,
    openThreads: kind === "mine" ? openThreadsWaitingOnMe(raw, viewerLogin) : [],
  };
}

export async function fetchPrState(ref: PrRef): Promise<RawPullRequest["state"]> {
  return (await fetchRawPullRequest(ref)).state;
}

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

// - start_line and start_side make it a comment on several lines.
export type ReviewCommentInput = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  start_line?: number;
  start_side?: "LEFT" | "RIGHT";
};

export type ReviewInput = { event: ReviewEvent; body: string; comments: ReviewCommentInput[]; commitSha: string };

type PostedReview = { id: number; state: string; html_url: string };

const EXPECTED_REVIEW_STATE: Record<ReviewEvent, string> = {
  APPROVE: "APPROVED",
  REQUEST_CHANGES: "CHANGES_REQUESTED",
  COMMENT: "COMMENTED",
};

/** Posts a review, then reads it back to prove it landed. */
export async function postReview(ref: PrRef, review: ReviewInput): Promise<string> {
  const reviewsPath = `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/reviews`;
  const payload = JSON.stringify({
    event: review.event, body: review.body, comments: review.comments, commit_id: review.commitSha,
  });
  const posted = await runGhJson<PostedReview>(["api", "-X", "POST", reviewsPath, "--input", "-"], payload);
  const readBack = await runGhJson<PostedReview>(["api", `${reviewsPath}/${posted.id}`]);
  if (readBack.state !== EXPECTED_REVIEW_STATE[review.event]) {
    throw new Error(`Review ${posted.id} reads back as ${readBack.state}, not ${EXPECTED_REVIEW_STATE[review.event]}`);
  }
  return readBack.html_url;
}

type PostedComment = { id: number; body: string; html_url: string };

/** Replies to a review thread, then reads the reply back. */
export async function postThreadReply(ref: PrRef, lastCommentId: number, body: string): Promise<string> {
  const repliesPath = `repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/comments/${lastCommentId}/replies`;
  const posted = await runGhJson<PostedComment>(["api", "-X", "POST", repliesPath, "--input", "-"], JSON.stringify({ body }));
  const readBack = await runGhJson<PostedComment>(["api", `repos/${ref.owner}/${ref.repo}/pulls/comments/${posted.id}`]);
  if (readBack.body !== body) throw new Error(`Reply ${posted.id} did not read back with the posted text`);
  return readBack.html_url;
}

export async function fetchRepoFile(owner: string, repo: string, filePath: string): Promise<string> {
  const encoded = await runGh(["api", `repos/${owner}/${repo}/contents/${filePath}`, "--jq", ".content"]);
  return Buffer.from(encoded, "base64").toString("utf8");
}
