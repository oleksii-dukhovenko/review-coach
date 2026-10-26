import { describe, expect, it } from "vitest";

import type { BranchLink, LinkRequest, LinkResult } from "../server/github.ts";
import type { TrainMember } from "../server/sceneSchema.ts";
import { MAX_PRS_EACH_WAY, trainFrom, walkTrain, type LinkLookup } from "../server/trains.ts";

type FakePr = Partial<BranchLink> & Pick<BranchLink, "number" | "baseRef" | "headRef">;

function fakePr(fields: FakePr): BranchLink {
  return {
    title: `PR ${fields.number}`,
    url: `https://github.com/acme/shop/pull/${fields.number}`,
    state: "OPEN",
    isCrossRepository: false,
    mergedAt: null,
    ...fields,
  };
}

/** Answers like GitHub would, from a fixed list of PRs, and counts calls. */
function fakeGitHub(prs: BranchLink[]): LinkLookup & { calls: LinkRequest[] } {
  const calls: LinkRequest[] = [];
  const lookup = async (request: LinkRequest): Promise<LinkResult> => {
    calls.push(request);
    const below = prs.filter((pr) => pr.headRef === request.below);
    const above = prs.filter((pr) => pr.baseRef === request.above);
    return { below, above };
  };
  return Object.assign(lookup, { calls });
}

function startOn(baseRef: string, headRef: string, number = 100): TrainMember {
  return { number, title: "This PR", state: "open", baseRef, headRef, url: `https://github.com/acme/shop/pull/${number}` };
}

function numbersOf(members: TrainMember[]): number[] {
  return members.map((member) => member.number);
}

describe("walkTrain", () => {
  it("lists a straight line of stacked PRs, bottom first", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1" }),
      fakePr({ number: 2, baseRef: "step-1", headRef: "step-2" }),
      fakePr({ number: 4, baseRef: "step-3", headRef: "step-4" }),
      fakePr({ number: 5, baseRef: "step-4", headRef: "step-5" }),
    ]);
    const members = await walkTrain(startOn("step-2", "step-3", 3), "develop", github);
    expect(numbersOf(members)).toEqual([1, 2, 3, 4, 5]);
    expect(members[0].url).toBe("https://github.com/acme/shop/pull/1");
  });

  it("asks for the PR below and the PR above in one call", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1" }),
      fakePr({ number: 3, baseRef: "step-2", headRef: "step-3" }),
    ]);
    await walkTrain(startOn("step-1", "step-2", 2), "develop", github);
    expect(github.calls[0]).toEqual({ below: "step-1", above: "step-2" });
  });

  it("stops going down at develop, even when a PR has develop as its head", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "main", headRef: "develop" }),
      fakePr({ number: 2, baseRef: "develop", headRef: "step-2" }),
    ]);
    const members = await walkTrain(startOn("step-2", "step-3"), "develop", github);
    expect(numbersOf(members)).toEqual([2, 100]);
  });

  it("stops going down at a release branch", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "2.12.1-release", state: "MERGED", mergedAt: "2026-09-01T00:00:00Z" }),
      fakePr({ number: 2, baseRef: "2.12.1-release", headRef: "hotfix-a" }),
    ]);
    const members = await walkTrain(startOn("hotfix-a", "hotfix-b"), "develop", github);
    expect(numbersOf(members)).toEqual([2, 100]);
  });

  it("stops at the repo's own main branch when it has another name", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "trunk", headRef: "step-1" }),
      fakePr({ number: 2, baseRef: "step-1", headRef: "trunk" }),
    ]);
    const members = await walkTrain(startOn("step-1", "step-2"), "trunk", github);
    expect(numbersOf(members)).toEqual([1, 100]);
  });

  it("keeps a merged PR at the bottom and marks it merged", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1", state: "MERGED", mergedAt: "2026-10-01T00:00:00Z" }),
    ]);
    const members = await walkTrain(startOn("step-1", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([1, 100]);
    expect(members[0].state).toBe("merged");
  });

  it("skips a closed PR and uses the open one on the same branch", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1", state: "CLOSED" }),
      fakePr({ number: 2, baseRef: "develop", headRef: "step-1" }),
    ]);
    const members = await walkTrain(startOn("step-1", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([2, 100]);
  });

  it("stops going down when only a closed PR made the branch", async () => {
    const github = fakeGitHub([fakePr({ number: 1, baseRef: "develop", headRef: "step-1", state: "CLOSED" })]);
    const members = await walkTrain(startOn("step-1", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([100]);
  });

  it("picks the most recently merged PR when no open PR made the branch", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1", state: "MERGED", mergedAt: "2026-01-01T00:00:00Z" }),
      fakePr({ number: 2, baseRef: "develop", headRef: "step-1", state: "MERGED", mergedAt: "2026-05-01T00:00:00Z" }),
    ]);
    const members = await walkTrain(startOn("step-1", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([2, 100]);
  });

  it("stops going up where two open PRs sit on the same branch", async () => {
    const github = fakeGitHub([
      fakePr({ number: 101, baseRef: "step-2", headRef: "option-a" }),
      fakePr({ number: 102, baseRef: "step-2", headRef: "option-b" }),
    ]);
    const members = await walkTrain(startOn("develop", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([100]);
  });

  it("ignores PRs from other people's copies of the repo", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "develop", headRef: "step-1", isCrossRepository: true }),
      fakePr({ number: 101, baseRef: "step-2", headRef: "step-3" }),
      fakePr({ number: 102, baseRef: "step-2", headRef: "step-3", isCrossRepository: true }),
    ]);
    const members = await walkTrain(startOn("step-1", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([100, 101]);
  });

  it("does not loop forever when branches point at each other", async () => {
    const github = fakeGitHub([
      fakePr({ number: 1, baseRef: "loop-b", headRef: "loop-a" }),
      fakePr({ number: 2, baseRef: "loop-a", headRef: "loop-b" }),
    ]);
    const members = await walkTrain(startOn("loop-a", "step-2"), "develop", github);
    expect(numbersOf(members)).toEqual([2, 1, 100]);
  });

  it("follows at most 40 PRs each way", async () => {
    const below = Array.from({ length: 50 }, (_unused, index) =>
      fakePr({ number: index + 1, baseRef: index === 0 ? "develop" : `low-${index}`, headRef: `low-${index + 1}` }));
    const above = Array.from({ length: 50 }, (_unused, index) =>
      fakePr({ number: 201 + index, baseRef: `high-${index}`, headRef: `high-${index + 1}` }));
    const members = await walkTrain(startOn("low-50", "high-0"), "develop", fakeGitHub([...below, ...above]));
    expect(members).toHaveLength(MAX_PRS_EACH_WAY * 2 + 1);
    expect(members[0].number).toBe(11);
    expect(members.at(-1)?.number).toBe(240);
  });

  it("returns only this PR when nothing is stacked below or above it", async () => {
    const github = fakeGitHub([]);
    const members = await walkTrain(startOn("develop", "step-1"), "develop", github);
    expect(numbersOf(members)).toEqual([100]);
    expect(github.calls).toEqual([{ below: null, above: "step-1" }]);
  });
});

describe("trainFrom", () => {
  it("names the train after the bottom PR's branch", () => {
    const members = [startOn("develop", "step-1", 1), startOn("step-1", "step-2", 2)];
    const train = trainFrom({ owner: "acme", repo: "shop" }, members);
    expect(train?.key).toBe("acme/shop@step-1");
    expect(numbersOf(train?.members ?? [])).toEqual([1, 2]);
  });

  it("gives no train for a PR that stands alone", () => {
    expect(trainFrom({ owner: "acme", repo: "shop" }, [startOn("develop", "step-1")])).toBeNull();
  });
});
