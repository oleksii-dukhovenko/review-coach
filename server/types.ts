export type PrKind = "review" | "mine";

export type ThreadComment = { databaseId: number; author: string; body: string; createdAt: string };

export type ReviewThread = {
  id: string;
  path: string;
  line: number | null;
  side: "LEFT" | "RIGHT";
  isOutdated: boolean;
  comments: ThreadComment[];
};

export type PullRequest = {
  key: string;
  owner: string;
  repo: string;
  number: number;
  kind: PrKind;
  isDraft: boolean;
  title: string;
  body: string;
  author: string;
  url: string;
  headSha: string;
  baseSha: string;
  baseRef: string;
  additions: number;
  deletions: number;
  // - Missing on PRs saved before it was fetched.
  createdAt?: string;
  updatedAt: string;
  openThreads: ReviewThread[];
  // - Missing on PRs saved before they were fetched.
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviewerCount?: number;
};

export type DiffLineKind = "add" | "del" | "ctx";

export type DiffLine = { kind: DiffLineKind; oldLine: number | null; newLine: number | null; text: string };

export type DiffHunk = { header: string; lines: DiffLine[] };

export type FileTag = "important" | "normal" | "skim";

export type DiffFile = {
  path: string;
  oldPath: string;
  status: "added" | "deleted" | "modified" | "renamed";
  isBinary: boolean;
  hunks: DiffHunk[];
  tag: FileTag;
  tagReason: string;
};

export type SymbolUse = { file: string; line: number; text: string };

export type CommitSummary = { sha: string; author: string; date: string; subject: string };

export type RemovedSymbol = {
  name: string;
  file: string;
  usedBeforeCount: number;
  usedAfterCount: number;
  // - First few mentions only.
  usedBefore: SymbolUse[];
  usedAfter: SymbolUse[];
  recentCommits: CommitSummary[];
};

export type JobStatus = "none" | "queued" | "building" | "ready" | "failed";

export function prKeyOf(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`;
}
