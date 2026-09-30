import fs from "node:fs";
import path from "node:path";

import { config } from "./config.ts";
import { runCommand, runOrThrow } from "./shell.ts";
import type { PullRequest } from "./types.ts";

const MAX_SEARCH_DEPTH = 3;

let localClonesByRepo: Map<string, string> | undefined;

function repoSlug(owner: string, repo: string): string {
  return `${owner}/${repo}`.toLowerCase();
}

/** Turns a GitHub remote URL into "owner/repo". */
export function slugFromRemoteUrl(remoteUrl: string): string | undefined {
  const match = remoteUrl.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return match ? repoSlug(match[1], match[2]) : undefined;
}

function childDirectories(directory: string): string[] {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function isGitCheckout(directory: string): boolean {
  return fs.existsSync(path.join(directory, ".git"));
}

async function readOriginSlug(directory: string): Promise<string | undefined> {
  const result = await runCommand("git", ["-C", directory, "remote", "get-url", "origin"]);
  return result.exitCode === 0 ? slugFromRemoteUrl(result.stdout) : undefined;
}

async function scanForClones(directory: string, depth: number, found: Map<string, string>): Promise<void> {
  if (isGitCheckout(directory)) {
    const slug = await readOriginSlug(directory);
    if (slug && !found.has(slug)) found.set(slug, directory);
    return;
  }
  if (depth === 0) return;
  for (const child of childDirectories(directory)) await scanForClones(child, depth - 1, found);
}

async function findLocalClone(owner: string, repo: string): Promise<string | undefined> {
  if (!localClonesByRepo) {
    localClonesByRepo = new Map();
    await scanForClones(config.projectsDir, MAX_SEARCH_DEPTH, localClonesByRepo);
  }
  return localClonesByRepo.get(repoSlug(owner, repo));
}

function mirrorPath(owner: string, repo: string): string {
  return path.join(config.mirrorsDir, owner, `${repo}.git`);
}

export function worktreePath(pr: PullRequest): string {
  return path.join(config.worktreesDir, `${pr.owner}-${pr.repo}-${pr.number}`);
}

/** Keeps a private bare clone so your own checkouts stay untouched. */
async function ensureMirror(owner: string, repo: string): Promise<string> {
  const mirror = mirrorPath(owner, repo);
  if (fs.existsSync(mirror)) return mirror;
  fs.mkdirSync(path.dirname(mirror), { recursive: true });
  const localClone = await findLocalClone(owner, repo);
  const borrowObjects = localClone ? ["--reference-if-able", localClone, "--dissociate"] : [];
  await runOrThrow("gh", ["repo", "clone", `${owner}/${repo}`, mirror, "--", "--bare", ...borrowObjects]);
  return mirror;
}

async function hasCommit(mirror: string, sha: string): Promise<boolean> {
  const result = await runCommand("git", ["-C", mirror, "cat-file", "-e", `${sha}^{commit}`]);
  return result.exitCode === 0;
}

async function fetchPrCommits(mirror: string, pr: PullRequest): Promise<void> {
  const haveBoth = (await hasCommit(mirror, pr.headSha)) && (await hasCommit(mirror, pr.baseSha));
  if (haveBoth) return;
  await runOrThrow("git", [
    "-C", mirror, "fetch", "--quiet", "origin",
    `+refs/pull/${pr.number}/head:refs/review-coach/pr-${pr.number}`,
    `+refs/heads/${pr.baseRef}:refs/review-coach/base-${pr.number}`,
  ]);
}

async function moveWorktreeTo(worktree: string, sha: string): Promise<void> {
  await runOrThrow("git", ["-C", worktree, "checkout", "--quiet", "--detach", "--force", sha]);
}

export type Checkout = { worktree: string; mirror: string; mergeBase: string };

async function findMergeBase(mirror: string, pr: PullRequest): Promise<string> {
  return (await runOrThrow("git", ["-C", mirror, "merge-base", pr.baseSha, pr.headSha])).trim();
}

/** Checks the PR out at its head in a separate folder. */
export async function ensureCheckout(pr: PullRequest): Promise<Checkout> {
  const mirror = await ensureMirror(pr.owner, pr.repo);
  await fetchPrCommits(mirror, pr);
  const worktree = worktreePath(pr);
  if (fs.existsSync(worktree)) {
    await moveWorktreeTo(worktree, pr.headSha);
  } else {
    fs.mkdirSync(config.worktreesDir, { recursive: true });
    await runOrThrow("git", ["-C", mirror, "worktree", "add", "--quiet", "--detach", worktree, pr.headSha]);
  }
  return { worktree, mirror, mergeBase: await findMergeBase(mirror, pr) };
}

export async function removeCheckout(pr: PullRequest): Promise<void> {
  const worktree = worktreePath(pr);
  if (!fs.existsSync(worktree)) return;
  await runCommand("git", ["-C", mirrorPath(pr.owner, pr.repo), "worktree", "remove", "--force", worktree]);
}
