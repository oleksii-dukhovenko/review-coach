import { describe, expect, it } from "vitest";

import { PART_KINDS, sceneSchema, type PartLook, type Scene, type Train, type TrainScene } from "../server/sceneSchema.ts";
import { depthOf } from "../web/src/anatomy/kit/iso-kit.ts";
import { CELL, frameOf, groupStatus, paintOrder, storyFrames, trainFrameOf } from "../web/src/anatomy/frame.ts";
import { labelLines } from "../web/src/anatomy/layout.ts";
import { buildPart, type Look } from "../web/src/anatomy/parts.ts";
import watchExit from "../web/src/anatomy/examples/watch-exit.json" with { type: "json" };

const PROJECTION = { origin: [0, 0] as [number, number], scale: 1, azimuth: 52, elevation: 30 };

const LOOKS: Look[] = [
  { light: null, open: null, level: null, count: null, isNew: false },
  { light: "off", open: false, level: 0, count: 0, isNew: false },
  { light: "green", open: true, level: 0.5, count: 3, isNew: true },
  { light: "red", open: true, level: 1, count: 5, isNew: false },
];

const scene: Scene = sceneSchema.parse(watchExit);

function lookOf(step: number, part: string): PartLook {
  return scene.steps[step]!.looks.find((look) => look.part === part)!;
}

describe("drawing parts", () => {
  it("builds every kind of part in every look", () => {
    for (const kind of PART_KINDS) {
      for (const look of LOOKS) {
        const pieces = buildPart(kind, [0, 0], look, PROJECTION);
        expect(pieces.length, `${kind} ${JSON.stringify(look)}`).toBeGreaterThan(5);
        expect(pieces.every((piece) => piece.kind !== "solid" || piece.paths.fill.length > 0)).toBe(true);
      }
    }
  });

  it("puts more cards in an open drawer when it holds more", () => {
    const solidsWith = (count: number) => buildPart("drawer", [0, 0], { ...LOOKS[2]!, count }, PROJECTION).filter((piece) => piece.kind === "solid").length;
    expect(solidsWith(4)).toBe(solidsWith(1) + 3);
  });

  it("tints a lamp by its light", () => {
    const lensInks = (light: Look["light"]) => buildPart("light", [0, 0], { ...LOOKS[0]!, light }, PROJECTION).flatMap((piece) => (piece.kind === "solid" && piece.ink ? [piece.ink] : []));
    expect(lensInks("green")).toEqual(["green"]);
    expect(lensInks("red")).toEqual(["red"]);
    expect(lensInks(null)).toEqual(["off"]);
  });
});

describe("story frames", () => {
  it("keeps the same view box in all three steps", () => {
    const boxes = storyFrames(scene).map((frame) => frame.viewBox);
    expect(boxes).toHaveLength(3);
    expect(new Set(boxes).size).toBe(1);
    expect(frameOf(scene, 2).viewBox).toBe(boxes[0]);
  });

  it("paints a nearer cell after a farther one", () => {
    const order = paintOrder([{ column: 1, row: 1 }, { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 0, row: 1 }]);
    expect(order.at(0)).toEqual({ column: 0, row: 0 });
    expect(order.at(-1)).toEqual({ column: 1, row: 1 });
    const depths = frameOf(scene, 0).parts.map((part) => part.depth);
    expect(depths).toEqual([...depths].sort((first, second) => first - second));
  });

  it("orders cells by how near they are at floor level", () => {
    const depthAt = (column: number, row: number) => depthOf([column * CELL, row * CELL, 0], PROJECTION);
    const order = paintOrder([{ column: 2, row: 0 }, { column: 0, row: 2 }]);
    expect(depthAt(order[0]!.column, order[0]!.row)).toBeLessThan(depthAt(order[1]!.column, order[1]!.row));
  });

  it("marks a part hidden in a step where it is not shown, and the links to it", () => {
    const before = frameOf(scene, 0);
    expect(lookOf(0, "exit-checker").shown).toBe(false);
    expect(before.parts.find((part) => part.id === "exit-checker")?.isHidden).toBe(true);
    expect(before.links.every((link) => link.isHidden)).toBe(true);
    expect(frameOf(scene, 1).parts.find((part) => part.id === "exit-checker")?.isHidden).toBe(false);
  });

  it("draws a part the PR adds in the yellow tone, and nothing else", () => {
    const change = frameOf(scene, 1);
    expect(change.parts.find((part) => part.id === "exit-checker")?.ink).toBe("new");
    expect(change.parts.filter((part) => part.id !== "exit-checker").every((part) => part.ink === "plain")).toBe(true);
  });

  it("gives every part with a code link that link, unchanged in every step", () => {
    const links = storyFrames(scene).map((frame) => frame.parts.map((part) => part.code));
    expect(links[0]).toEqual(links[2]);
    expect(links[0]!.every((code) => code !== null && code.startLine > 0)).toBe(true);
  });

  it("keeps each label in the same spot in every step", () => {
    const spots = storyFrames(scene).map((frame) => frame.parts.map((part) => part.labelAt.join(",")));
    expect(spots[0]).toEqual(spots[1]);
    expect(spots[0]).toEqual(spots[2]);
  });
});

describe("labels", () => {
  it("keeps a short label on one line", () => {
    expect(labelLines("exit checker")).toEqual(["exit checker"]);
  });

  it("splits a long label over two lines and keeps every word", () => {
    expect(labelLines("background watcher")).toEqual(["background", "watcher"]);
    expect(labelLines("cache never goes stale")).toEqual(["cache never", "goes stale"]);
  });
});

const train: Train = {
  key: "acme/app:first", owner: "acme", repo: "app",
  members: [1, 2, 3, 4, 5, 6].map((number) => ({ number, title: `PR ${number}`, state: number < 3 ? "merged" : "open", baseRef: "", headRef: "", url: `https://github.com/acme/app/pull/${number}` })),
};

const trainScene: TrainScene = {
  object: "A small machine.", summary: "The whole effort.",
  groups: [
    { id: "base", kind: "cabinet", column: 0, row: 0, label: "the base", prs: [1, 2] },
    { id: "middle", kind: "drawer", column: 1, row: 0, label: "the store", prs: [3] },
    { id: "top", kind: "gauge", column: 2, row: 0, label: "the gauge", prs: [4, 5] },
    { id: "end", kind: "lock", column: 3, row: 0, label: "the lock", prs: [6] },
  ],
  links: [{ from: "base", to: "middle", kind: "pipe" }],
};

describe("train frames", () => {
  it("calls the group holding this PR current, earlier groups done and later groups later", () => {
    const statuses = trainScene.groups.map((group) => groupStatus(group, train, 3));
    expect(statuses).toEqual(["done", "current", "later", "later"]);
  });

  it("draws this PR's part yellow, earlier parts solid and later parts as faint outlines", () => {
    const frame = trainFrameOf(trainScene, train, 4);
    const inkOf = (id: string) => frame.parts.find((part) => part.id === id)?.ink;
    expect([inkOf("base"), inkOf("middle"), inkOf("top"), inkOf("end")]).toEqual(["plain", "plain", "new", "ghost"]);
    expect(frame.parts.find((part) => part.id === "top")?.prs).toEqual([4, 5]);
  });
});

describe("example scene", () => {
  it("passes the scene schema", () => {
    expect(sceneSchema.safeParse(watchExit).success).toBe(true);
  });
});
