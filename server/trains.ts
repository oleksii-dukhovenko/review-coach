import { fetchBranchFacts, fetchBranchLinks, type BranchFacts, type BranchLink, type LinkRequest, type LinkResult } from "./github.ts";
import type { Train, TrainMember } from "./sceneSchema.ts";
import type { PullRequest } from "./types.ts";

// - Most PRs followed in each direction.
export const MAX_PRS_EACH_WAY = 40;

const TRUNK_BRANCHES = ["develop", "main", "master"];

/** Finds the PRs one branch link away. Tests pass a fake. */
export type LinkLookup = (request: LinkRequest) => Promise<LinkResult>;

// - from: the branch to look at next.
// - from is null once this side stops.
type Line = { links: BranchLink[]; from: string | null };

type Walk = { down: Line; up: Line; seen: Set<number>; defaultBranch: string };

/** Trunk branches end a train; no PR stacks below them. */
export function isEndBranch(branch: string, defaultBranch: string): boolean {
  const isTrunk = branch === defaultBranch || TRUNK_BRANCHES.includes(branch);
  return isTrunk || branch.endsWith("-release");
}

function walkableBranch(branch: string, defaultBranch: string): string | null {
  return isEndBranch(branch, defaultBranch) ? null : branch;
}

function isOpen(link: BranchLink): boolean {
  return link.state === "OPEN";
}

function isMerged(link: BranchLink): boolean {
  return link.state === "MERGED";
}

function isSameRepo(link: BranchLink): boolean {
  return !link.isCrossRepository;
}

function onlyOne(links: BranchLink[]): BranchLink | undefined {
  return links.length === 1 ? links[0] : undefined;
}

function byNewestMerge(left: BranchLink, right: BranchLink): number {
  return (right.mergedAt ?? "").localeCompare(left.mergedAt ?? "");
}

function latestMerged(links: BranchLink[]): BranchLink | undefined {
  return links.filter(isMerged).toSorted(byNewestMerge)[0];
}

/**
 * The PR whose head branch this one sits on.
 * - One open PR wins; two open PRs is a split, so none.
 * - With no open PR, the most recently merged one.
 */
export function pickBelow(found: BranchLink[]): BranchLink | undefined {
  const sameRepo = found.filter(isSameRepo);
  const open = sameRepo.filter(isOpen);
  return open.length > 0 ? onlyOne(open) : latestMerged(sameRepo);
}

/** The one open PR stacked on this branch; none when the line splits. */
export function pickAbove(found: BranchLink[]): BranchLink | undefined {
  return onlyOne(found.filter(isSameRepo).filter(isOpen));
}

function isUnseen(walk: Walk, link: BranchLink | undefined): link is BranchLink {
  return link !== undefined && !walk.seen.has(link.number);
}

function hasRoom(line: Line): boolean {
  return line.links.length < MAX_PRS_EACH_WAY;
}

/** Adds the PR to the line and says which branch to look at next. */
function follow(walk: Walk, line: Line, link: BranchLink, nextBranchOf: (link: BranchLink) => string): string | null {
  walk.seen.add(link.number);
  line.links.push(link);
  return hasRoom(line) ? walkableBranch(nextBranchOf(link), walk.defaultBranch) : null;
}

function takeStep(walk: Walk, line: Line, next: BranchLink | undefined, nextBranchOf: (link: BranchLink) => string): void {
  line.from = isUnseen(walk, next) ? follow(walk, line, next, nextBranchOf) : null;
}

async function stepBothWays(walk: Walk, lookup: LinkLookup): Promise<void> {
  const found = await lookup({ below: walk.down.from, above: walk.up.from });
  takeStep(walk, walk.down, pickBelow(found.below), (link) => link.baseRef);
  takeStep(walk, walk.up, pickAbove(found.above), (link) => link.headRef);
}

function isWalking(walk: Walk): boolean {
  return walk.down.from !== null || walk.up.from !== null;
}

// - A fork's head branch lives in the fork.
function firstBranchUp(start: TrainMember, defaultBranch: string, isFromFork: boolean): string | null {
  return isFromFork ? null : walkableBranch(start.headRef, defaultBranch);
}

function startWalk(start: TrainMember, defaultBranch: string, isFromFork: boolean): Walk {
  return {
    down: { links: [], from: walkableBranch(start.baseRef, defaultBranch) },
    up: { links: [], from: firstBranchUp(start, defaultBranch, isFromFork) },
    seen: new Set([start.number]),
    defaultBranch,
  };
}

function toMember(link: BranchLink): TrainMember {
  const state = isMerged(link) ? "merged" : "open";
  return { number: link.number, title: link.title, state, baseRef: link.baseRef, headRef: link.headRef, url: link.url };
}

/**
 * The single line of stacked PRs through the start PR, bottom first.
 * - Down: open or merged PRs, until a trunk or release branch.
 * - Up: open PRs, until the line splits or ends.
 * - Never up from a fork PR.
 */
export async function walkTrain(start: TrainMember, defaultBranch: string, lookup: LinkLookup, isFromFork = false): Promise<TrainMember[]> {
  const walk = startWalk(start, defaultBranch, isFromFork);
  while (isWalking(walk)) await stepBothWays(walk, lookup);
  const below = walk.down.links.toReversed().map(toMember);
  const above = walk.up.links.map(toMember);
  return [...below, start, ...above];
}

type PrWithBranches = PullRequest & { headRef: string; defaultBranch: string; isFromFork: boolean };

function hasBranchFacts(pr: PullRequest): pr is PrWithBranches {
  const hasBranches = pr.headRef !== undefined && pr.defaultBranch !== undefined;
  return hasBranches && pr.isFromFork !== undefined;
}

/** Saved branches when the PR has them, else asks GitHub. */
async function branchesOf(pr: PullRequest): Promise<BranchFacts> {
  if (!hasBranchFacts(pr)) return fetchBranchFacts(pr);
  return { baseRef: pr.baseRef, headRef: pr.headRef, defaultBranch: pr.defaultBranch, isFromFork: pr.isFromFork };
}

// - Inbox PRs are open.
function startMember(pr: PullRequest, branches: BranchFacts): TrainMember {
  return { number: pr.number, title: pr.title, state: "open", baseRef: branches.baseRef, headRef: branches.headRef, url: pr.url };
}

// - Forked trains differ by their top branch.
function trainKeyOf(repo: { owner: string; repo: string }, members: TrainMember[]): string {
  const bottom = members[0].headRef;
  const top = members.at(-1)!.headRef;
  return `${repo.owner}/${repo.repo}@${bottom}..${top}`;
}

/** A train needs at least two PRs; one PR alone is null. */
export function trainFrom(repo: { owner: string; repo: string }, members: TrainMember[]): Train | null {
  if (members.length < 2) return null;
  return { key: trainKeyOf(repo, members), owner: repo.owner, repo: repo.repo, members };
}

/** The train this PR belongs to, or null when it stands alone. */
export async function findTrain(pr: PullRequest): Promise<Train | null> {
  const branches = await branchesOf(pr);
  const lookup: LinkLookup = (request) => fetchBranchLinks(pr.owner, pr.repo, request);
  const members = await walkTrain(startMember(pr, branches), branches.defaultBranch, lookup, branches.isFromFork);
  return trainFrom(pr, members);
}
