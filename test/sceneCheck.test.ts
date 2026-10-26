import { describe, expect, it } from "vitest";

import {
  anchorsOf, canReuseAnatomy, checkedScene, checkedTrainScene, hasTrainSceneFor, movedAnatomy, storyFingerprint, trainFingerprint, type AnatomyData,
} from "../server/sceneCheck.ts";
import type { PartLook, Scene, ScenePart, StoryStep, Train, TrainScene } from "../server/sceneSchema.ts";
import type { Walkthrough } from "../server/schemas.ts";

const FILE_LINES: Record<string, number> = { "src/terminal.sh": 100, "src/checker.sh": 30 };

const lineCountOf = (file: string) => FILE_LINES[file] ?? 0;

function part(overrides: Partial<ScenePart>): ScenePart {
  return { id: "terminal", kind: "cabinet", column: 0, row: 1, label: "terminal", file: "src/terminal.sh", startLine: 10, endLine: 20, ...overrides };
}

function look(partId: string, overrides: Partial<PartLook> = {}): PartLook {
  return { part: partId, shown: true, isNew: false, light: null, open: null, level: null, count: null, ...overrides };
}

function step(key: StoryStep["key"], looks: PartLook[]): StoryStep {
  return { key, say: `${key} sentence`, looks };
}

const TERMINAL = part({});
const CHECKER = part({ id: "checker", kind: "probe", column: 1, row: 1, label: "file checker", file: "src/checker.sh", startLine: 5, endLine: 9 });

function scene(overrides: Partial<Scene>): Scene {
  const looks = [look("terminal", { light: "red" }), look("checker")];
  return {
    object: "A terminal with a checker", tldr: "The checker picks the colour", parts: [TERMINAL, CHECKER],
    links: [{ from: "checker", to: "terminal", kind: "wire" }],
    steps: [step("before", looks), step("change", looks), step("after", looks)],
    why: "Red means look again", ...overrides,
  };
}

describe("checkedScene", () => {
  it("keeps a scene that already fits the rules", () => {
    expect(checkedScene(scene({}), lineCountOf)).toEqual(scene({}));
  });

  it("keeps only the first eight parts", () => {
    const parts = Array.from({ length: 10 }, (_unused, position) => part({ id: `part-${position}`, column: position % 4, row: Math.floor(position / 4) % 3 }));
    const keptIds = checkedScene(scene({ parts }), lineCountOf)!.parts.map((kept) => kept.id);
    expect(keptIds).toEqual(["part-0", "part-1", "part-2", "part-3", "part-4", "part-5", "part-6", "part-7"]);
  });

  it("cuts a label to its first three words", () => {
    const wordy = { ...CHECKER, label: "cache never goes stale" };
    expect(checkedScene(scene({ parts: [TERMINAL, wordy] }), lineCountOf)!.parts[1].label).toBe("cache never goes");
  });

  it("drops a second part that reuses an id", () => {
    const copy = part({ column: 3, row: 2, label: "copy" });
    const checked = checkedScene(scene({ parts: [TERMINAL, CHECKER, copy] }), lineCountOf)!;
    expect(checked.parts.map((kept) => kept.label)).toEqual(["terminal", "file checker"]);
  });

  it("moves a part that shares a cell to the nearest free cell", () => {
    const crowded = { ...CHECKER, column: 0, row: 1 };
    const moved = checkedScene(scene({ parts: [TERMINAL, crowded] }), lineCountOf)!.parts[1];
    expect([moved.column, moved.row]).toEqual([0, 0]);
  });

  it("drops links whose ends are missing or not next to each other", () => {
    const far = { ...CHECKER, column: 3, row: 2 };
    const links = [{ from: "checker", to: "terminal", kind: "wire" as const }, { from: "ghost", to: "terminal", kind: "pipe" as const }];
    expect(checkedScene(scene({ parts: [TERMINAL, far], links }), lineCountOf)!.links).toEqual([]);
  });

  it("puts the steps in before, change, after order", () => {
    const shuffled = [step("after", []), step("before", []), step("change", [])];
    expect(checkedScene(scene({ steps: shuffled }), lineCountOf)!.steps.map((kept) => kept.key)).toEqual(["before", "change", "after"]);
  });

  it("gives up on a scene with a missing step", () => {
    expect(checkedScene(scene({ steps: [step("before", []), step("after", [])] }), lineCountOf)).toBeNull();
  });

  it("gives every part exactly one look per step, filling gaps with a plain look", () => {
    const steps = [step("before", [look("terminal"), look("terminal"), look("ghost")]), step("change", []), step("after", [])];
    const firstStep = checkedScene(scene({ steps }), lineCountOf)!.steps[0];
    expect(firstStep.looks).toEqual([look("terminal"), look("checker")]);
  });

  it("carries a part's look forward when a later step leaves it out", () => {
    const steps = [step("before", [look("checker", { shown: false })]), step("change", []), step("after", [])];
    const changeStep = checkedScene(scene({ steps }), lineCountOf)!.steps[1];
    expect(changeStep.looks[1].shown).toBe(false);
  });

  it("never marks a part new in the before step", () => {
    const steps = [step("before", [look("checker", { isNew: true })]), step("change", [look("checker", { isNew: true })]), step("after", [])];
    const checked = checkedScene(scene({ steps }), lineCountOf)!;
    expect(checked.steps.map((kept) => kept.looks[1].isNew)).toEqual([false, true, true]);
  });

  it("clears look settings the part's kind does not use", () => {
    const steps = [step("before", [look("checker", { light: "red", level: 0.5 })]), step("change", []), step("after", [])];
    expect(checkedScene(scene({ steps }), lineCountOf)!.steps[0].looks[1]).toEqual(look("checker"));
  });

  it("clears the code link of a part whose file does not exist", () => {
    const missing = { ...CHECKER, file: "src/gone.sh" };
    expect(checkedScene(scene({ parts: [TERMINAL, missing] }), lineCountOf)!.parts[1]).toMatchObject({ file: "", startLine: 0, endLine: 0 });
  });

  it("pulls a code link's lines inside the file", () => {
    const tooLong = { ...CHECKER, startLine: 25, endLine: 90 };
    expect(checkedScene(scene({ parts: [TERMINAL, tooLong] }), lineCountOf)!.parts[1]).toMatchObject({ startLine: 25, endLine: 30 });
  });
});

function walkthrough(tldr: string): Walkthrough {
  return {
    story: { tldr, before: "", after: "", whatItDoes: "", whyNeeded: "", glossary: [] },
    picture: { caption: "caption", diagram: "flowchart LR", nodes: [] },
    hardIdeas: [], flow: [], tour: [],
  };
}

describe("canReuseAnatomy", () => {
  const story = walkthrough("The checker picks the colour");
  const saved = { scene: null, basedOn: storyFingerprint(story) };

  it("reuses the picture when the story and big picture did not change", () => {
    expect(canReuseAnatomy(saved, story, false)).toBe(true);
  });

  it("reuses the picture when only the big picture's code links were added", () => {
    const withNodes = { ...story, picture: { ...story.picture, nodes: [{ id: "A", file: "src/a.ts", startLine: 1, endLine: 2 }] } };
    expect(canReuseAnatomy(saved, withNodes, false)).toBe(true);
  });

  it("asks again when the story changed", () => {
    expect(canReuseAnatomy(saved, walkthrough("Something else happens"), false)).toBe(false);
  });

  it("asks again when someone asked to rebuild the picture", () => {
    expect(canReuseAnatomy(saved, story, true)).toBe(false);
  });

  it("asks when there is no picture yet", () => {
    expect(canReuseAnatomy(undefined, story, false)).toBe(false);
  });
});

describe("movedAnatomy", () => {
  const terminalLines = Array.from({ length: 100 }, (_unused, index) => `terminal line ${index + 1}`);
  const checkerLines = Array.from({ length: 30 }, (_unused, index) => `checker line ${index + 1}`);
  const linesOn = (files: Record<string, string[]>) => (file: string) => files[file] ?? [];
  const oldCode = linesOn({ "src/terminal.sh": terminalLines, "src/checker.sh": checkerLines });
  const saved: AnatomyData = { scene: scene({}), basedOn: "story", anchors: anchorsOf(scene({}), oldCode) };

  it("still opens the same code after 20 lines are added above a part", () => {
    const shifted = [...Array.from({ length: 20 }, () => "added line"), ...terminalLines];
    const moved = movedAnatomy(saved, linesOn({ "src/terminal.sh": shifted, "src/checker.sh": checkerLines }));
    const [terminal, checker] = moved.scene!.parts;
    expect([terminal.startLine, terminal.endLine]).toEqual([30, 40]);
    expect([checker.startLine, checker.endLine]).toEqual([5, 9]);
  });

  it("stops linking a part to code whose file was deleted", () => {
    const moved = movedAnatomy(saved, linesOn({ "src/checker.sh": checkerLines }));
    expect(moved.scene!.parts[0].file).toBe("");
  });
});

function train(titles: Record<number, string>): Train {
  const members = Object.entries(titles).map(([number, title]) => ({
    number: Number(number), title, state: "open" as const, baseRef: "develop", headRef: `branch-${number}`, url: "",
  }));
  return { key: "acme/shop:branch-1", owner: "acme", repo: "shop", members };
}

describe("trainFingerprint", () => {
  const base = train({ 1: "Add the store", 2: "Read from the store" });

  it("stays the same for the same members", () => {
    expect(trainFingerprint(base)).toBe(trainFingerprint(train({ 1: "Add the store", 2: "Read from the store" })));
  });

  it("changes when a PR joins the train", () => {
    expect(trainFingerprint(base)).not.toBe(trainFingerprint(train({ 1: "Add the store", 2: "Read from the store", 3: "Show it" })));
  });

  it("changes when a PR is renamed", () => {
    expect(trainFingerprint(base)).not.toBe(trainFingerprint(train({ 1: "Add the store", 2: "Read the store" })));
  });
});

describe("hasTrainSceneFor", () => {
  it("is true for a saved scene made for the same members", () => {
    expect(hasTrainSceneFor({ builtFor: "abc", data: { scene: null } }, "abc")).toBe(true);
  });

  it("is false for a scene made for other members", () => {
    expect(hasTrainSceneFor({ builtFor: "old", data: { scene: null } }, "abc")).toBe(false);
  });

  it("is false when nothing was saved yet", () => {
    expect(hasTrainSceneFor(undefined, "abc")).toBe(false);
  });
});

function trainScene(groups: { id: string; column: number; row: number; prs: number[] }[]): TrainScene {
  return {
    object: "A small factory", summary: "Builds the store",
    groups: groups.map((group) => ({ kind: "drawer", label: group.id, ...group })),
    links: [{ from: "store", to: "reader", kind: "pipe" }],
  };
}

describe("checkedTrainScene", () => {
  const fivePrs = train({ 1: "one", 2: "two", 3: "three", 4: "four", 5: "five" });

  it("keeps a scene where every PR is in one group", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1, 2] }, { id: "reader", column: 1, row: 0, prs: [3, 4, 5] }];
    expect(checkedTrainScene(trainScene(groups), fivePrs)).toEqual(trainScene(groups));
  });

  it("drops PR numbers that are not in the train", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1, 2, 99] }, { id: "reader", column: 1, row: 0, prs: [3, 4, 5] }];
    expect(checkedTrainScene(trainScene(groups), fivePrs)!.groups[0].prs).toEqual([1, 2]);
  });

  it("keeps a PR named twice only in its first group", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1, 2, 3] }, { id: "reader", column: 1, row: 0, prs: [3, 4, 5] }];
    expect(checkedTrainScene(trainScene(groups), fivePrs)!.groups.map((group) => group.prs)).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("adds a forgotten PR to the group nearest it in the train", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1] }, { id: "reader", column: 1, row: 0, prs: [4, 5] }];
    expect(checkedTrainScene(trainScene(groups), fivePrs)!.groups.map((group) => group.prs)).toEqual([[1, 2], [3, 4, 5]]);
  });

  it("drops a group left with no PRs", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1, 2, 3, 4, 5] }, { id: "reader", column: 1, row: 0, prs: [99] }];
    const checked = checkedTrainScene(trainScene(groups), fivePrs)!;
    expect([checked.groups.map((group) => group.id), checked.links]).toEqual([["store"], []]);
  });

  it("keeps at most eight groups", () => {
    const tenPrs = train(Object.fromEntries(Array.from({ length: 10 }, (_unused, position) => [position + 1, `pr ${position + 1}`])));
    const groups = Array.from({ length: 10 }, (_unused, position) => ({ id: `group-${position}`, column: position % 4, row: Math.floor(position / 4), prs: [position + 1] }));
    const checked = checkedTrainScene(trainScene(groups), tenPrs)!;
    expect([checked.groups.length, checked.groups.flatMap((group) => group.prs).length]).toEqual([8, 10]);
  });

  it("moves a group that shares a cell", () => {
    const groups = [{ id: "store", column: 0, row: 0, prs: [1, 2] }, { id: "reader", column: 0, row: 0, prs: [3, 4, 5] }];
    const moved = checkedTrainScene(trainScene(groups), fivePrs)!.groups[1];
    expect([moved.column, moved.row]).toEqual([1, 0]);
  });

  it("gives up when no group names a PR in the train", () => {
    expect(checkedTrainScene(trainScene([{ id: "store", column: 0, row: 0, prs: [99] }]), fivePrs)).toBeNull();
  });
});
