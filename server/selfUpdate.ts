import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { stopAllServers } from "./languageServers.ts";
import { runCommand, runOrThrow } from "./shell.ts";

// - sha: the commit this copy was built from. tools: a hash of what the Docker image provides, so an
//   update that needs a new image is caught. repo and branch say where newer commits come from.
export type BuildInfo = { sha: string; branch: string; repo: string; tools: string };

export type UpdatePhase = "idle" | "downloading" | "installing" | "building" | "restarting" | "failed" | "needs-install";

export type NewCommit = { sha: string; title: string };

export type VersionInfo = {
  current: BuildInfo | null;
  // - Null until GitHub answers, or when this copy's commit is unknown there.
  behindBy: number | null;
  newCommits: NewCommit[];
  checkedAt: string | null;
  checkError: string | null;
  // - Only Docker restarts the app by itself after an update.
  canUpdate: boolean;
  phase: UpdatePhase;
  updateError: string | null;
};

const APP_ROOT = path.join(import.meta.dirname, "..");
const CHECK_EVERY_MS = 30 * 60_000;
const SHOWN_COMMITS = 5;
// - Files baked into the Docker image; an update that changes them needs the install command.
export const TOOL_FILES = ["Dockerfile", "docker/entrypoint.sh"];

const isInDocker = process.env.REVIEW_COACH_IN_DOCKER === "1";
// - The image's own build, set by the entrypoint; an update is only used on the image it was built on.
const imageSha = process.env.REVIEW_COACH_IMAGE_SHA ?? "";
const updatesDir = path.join(os.homedir(), "app-updates");
const nextDir = path.join(updatesDir, "next");
// - The entrypoint runs this copy when its .built-on matches the image.
export const updatedAppDir = path.join(os.homedir(), "app");

/** "owner/name" from an https or ssh GitHub remote. */
export function repoFromRemote(remote: string): string {
  const match = remote.trim().match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  return match ? match[1] : "";
}

/** One hash over the files the Docker image bakes in. */
export function toolsHashOf(root: string): string {
  const hash = createHash("sha256");
  for (const file of TOOL_FILES) {
    const fullPath = path.join(root, file);
    hash.update(`${file}\n${fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : ""}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

async function gitValue(root: string, args: string[]): Promise<string> {
  const result = await runCommand("git", ["-C", root, ...args]);
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

/** What a git checkout is: its commit, branch and GitHub repo. */
export async function buildInfoFromGit(root: string): Promise<BuildInfo> {
  const sha = await gitValue(root, ["rev-parse", "HEAD"]);
  const branch = await gitValue(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const repo = repoFromRemote(await gitValue(root, ["remote", "get-url", "origin"]));
  return { sha, branch, repo, tools: toolsHashOf(root) };
}

/** What this copy is: version.json from the build, or the git checkout it runs from. */
async function readBuildInfo(): Promise<BuildInfo | null> {
  const file = path.join(APP_ROOT, "version.json");
  const info = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as BuildInfo) : await buildInfoFromGit(APP_ROOT);
  return info.sha ? info : null;
}

/** Tells the entrypoint an updated copy started fine, so it stops counting failed starts. */
export function confirmStarted(): void {
  if (path.resolve(APP_ROOT) === path.resolve(updatedAppDir)) fs.writeFileSync(path.join(updatedAppDir, ".confirmed"), "");
}

type Compare = { status: string; ahead_by: number; commits: { sha: string; commit: { message: string } }[] };

const state: Omit<VersionInfo, "canUpdate"> = {
  current: null, behindBy: null, newCommits: [], checkedAt: null, checkError: null, phase: "idle", updateError: null,
};

/** Asks GitHub how many commits the branch has that this copy does not. */
export async function checkForUpdate(): Promise<void> {
  state.current ??= await readBuildInfo();
  const current = state.current;
  if (!current?.repo || !current.branch || current.branch === "HEAD") {
    state.checkError = "This copy is not on a GitHub branch, so it cannot check for updates.";
    return;
  }
  try {
    const raw = await runOrThrow("gh", ["api", `repos/${current.repo}/compare/${current.sha}...${current.branch}`]);
    const compare = JSON.parse(raw) as Compare;
    const isBehind = compare.status === "ahead" || compare.status === "diverged";
    state.behindBy = isBehind ? compare.ahead_by : 0;
    state.newCommits = isBehind
      ? compare.commits.slice(-SHOWN_COMMITS).reverse().map((commit) => ({ sha: commit.sha, title: commit.commit.message.split("\n")[0] }))
      : [];
    state.checkError = null;
  } catch (error) {
    state.behindBy = null;
    state.checkError = error instanceof Error ? error.message : String(error);
  }
  state.checkedAt = new Date().toISOString();
}

export function versionInfo(): VersionInfo {
  return { ...state, canUpdate: isInDocker && imageSha !== "" };
}

export function startUpdateChecks(): void {
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_EVERY_MS).unref();
}

async function step(phase: UpdatePhase, command: string, args: string[], cwd?: string): Promise<void> {
  state.phase = phase;
  await runOrThrow(command, args, { cwd });
}

/** Downloads the branch, builds it beside the running copy, swaps it in, and restarts. */
async function runUpdate(current: BuildInfo): Promise<void> {
  fs.rmSync(nextDir, { recursive: true, force: true });
  fs.mkdirSync(updatesDir, { recursive: true });
  await step("downloading", "git", ["clone", "--quiet", "--depth", "1", "--branch", current.branch, `https://github.com/${current.repo}.git`, nextDir]);
  if (toolsHashOf(nextDir) !== current.tools) {
    state.phase = "needs-install";
    return;
  }
  await step("installing", "npm", ["ci", "--no-audit", "--no-fund"], nextDir);
  await step("building", "npm", ["run", "build"], nextDir);
  const info: BuildInfo = { ...(await buildInfoFromGit(nextDir)), branch: current.branch, repo: current.repo };
  fs.writeFileSync(path.join(nextDir, "version.json"), JSON.stringify(info));
  fs.writeFileSync(path.join(nextDir, ".built-on"), imageSha);
  const previousDir = path.join(updatesDir, "previous");
  fs.rmSync(previousDir, { recursive: true, force: true });
  if (fs.existsSync(updatedAppDir)) fs.renameSync(updatedAppDir, previousDir);
  fs.renameSync(nextDir, updatedAppDir);
  state.phase = "restarting";
  // - Docker's restart policy starts the container again, and the entrypoint picks the new copy.
  setTimeout(() => {
    stopAllServers();
    process.exit(0);
  }, 500);
}

/** Starts an update in the background; the page polls versionInfo for progress. */
export function startUpdate(): VersionInfo {
  const current = state.current;
  const isBusy = !["idle", "failed", "needs-install"].includes(state.phase);
  if (!versionInfo().canUpdate || !current || isBusy) return versionInfo();
  state.updateError = null;
  runUpdate(current).catch((error: unknown) => {
    state.phase = "failed";
    state.updateError = error instanceof Error ? error.message : String(error);
    fs.rmSync(nextDir, { recursive: true, force: true });
  });
  return versionInfo();
}
