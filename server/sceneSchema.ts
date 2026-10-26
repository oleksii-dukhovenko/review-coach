import { z } from "zod";

/** Parts the drawing library can build. Keep in sync with web/src/anatomy/parts.ts. */
export const PART_KINDS = [
  "cabinet", "light", "drawer", "card", "probe", "gauge", "lock",
  "conveyor", "lever", "press", "bin", "clock",
] as const;

export const LINK_KINDS = ["pipe", "wire", "belt"] as const;
export const LIGHT_COLOURS = ["off", "green", "red"] as const;
export const STEP_KEYS = ["before", "change", "after"] as const;

/** Floor grid the parts stand on: columns run left to right, rows back to front. */
export const GRID_COLUMNS = 4;
export const GRID_ROWS = 3;

const partId = z.string().describe("Short kebab-case id, unique in this scene, e.g. 'healthy-node'");

const scenePart = z.object({
  id: partId,
  kind: z.enum(PART_KINDS),
  column: z.number().int().min(0).max(GRID_COLUMNS - 1),
  row: z.number().int().min(0).max(GRID_ROWS - 1).describe("0 = back, 2 = front"),
  label: z.string().describe("Max 3 plain words, written on the floor in front of the part, e.g. 'healthy terminal'"),
  file: z.string().describe("Repo path of the code this part stands for, at the PR head. Empty if it is not code in this repo."),
  startLine: z.number().int().describe("First line of that function or block, new-file line numbers. 0 if file is empty."),
  endLine: z.number().int().describe("Last line of that function or block, max 120 lines after startLine. 0 if file is empty."),
});

const sceneLink = z.object({
  from: partId,
  to: partId,
  kind: z.enum(LINK_KINDS).describe("pipe = data moving; wire = a signal or call; belt = items carried in order"),
});

const partLook = z.object({
  part: partId,
  shown: z.boolean().describe("false hides the part in this step, e.g. a part the PR adds is hidden in 'before'"),
  isNew: z.boolean().describe("true draws the part yellow: this PR adds or changes it. Only in 'change' and 'after'."),
  light: z.enum(LIGHT_COLOURS).nullable().describe("light, cabinet: status lamp colour. null for other kinds."),
  open: z.boolean().nullable().describe("drawer: pulled out; lock: unlocked. null for other kinds."),
  level: z.number().min(0).max(1).nullable().describe("gauge: needle 0-1; clock: hand 0-1; lever: 0 off, 1 on. null for other kinds."),
  count: z.number().int().min(0).max(5).nullable().describe("drawer, conveyor, bin, press: how many cards it holds, 0-5. null for other kinds."),
});

const storyStep = z.object({
  key: z.enum(STEP_KEYS),
  say: z.string().describe("One plain sentence, max 18 words, for a reader who knows nothing. What a person would see happen."),
  looks: z.array(partLook).describe("Exactly one entry per part in the scene"),
});

export const sceneSchema = z.object({
  object: z.string().describe("One sentence: which real object this is, and what its motion stands for in the code"),
  tldr: z.string().describe("The whole PR in one plain sentence, max 20 words"),
  parts: z.array(scenePart).describe("2-8 parts. One part per grid cell."),
  links: z.array(sceneLink).describe("Max 6. Each joins two parts that are next to each other on the grid."),
  steps: z.array(storyStep).describe("Exactly three steps, in order: before, change, after"),
  why: z.string().describe("Why the 'after' is better, one plain sentence, max 18 words, consequence first"),
});

export const anatomySchema = z.object({
  scene: sceneSchema.nullable().describe("null when no object would honestly explain this PR, e.g. a rename or docs-only change"),
});

export type Scene = z.infer<typeof sceneSchema>;
export type ScenePart = z.infer<typeof scenePart>;
export type SceneLink = z.infer<typeof sceneLink>;
export type PartLook = z.infer<typeof partLook>;
export type StoryStep = z.infer<typeof storyStep>;
export type PartKind = (typeof PART_KINDS)[number];
export type Anatomy = z.infer<typeof anatomySchema>;

const trainGroup = z.object({
  id: partId,
  kind: z.enum(PART_KINDS),
  column: z.number().int().min(0).max(GRID_COLUMNS - 1),
  row: z.number().int().min(0).max(GRID_ROWS - 1),
  label: z.string().describe("Max 3 plain words naming what this group of PRs builds, e.g. 'Consul key store'"),
  prs: z.array(z.number().int()).describe("PR numbers in this group, in train order. Every train PR is in exactly one group."),
});

export const trainSceneSchema = z.object({
  object: z.string().describe("One sentence: which real machine the whole train builds, and what each part stands for"),
  summary: z.string().describe("What the whole train delivers, one plain sentence, max 20 words"),
  groups: z.array(trainGroup).describe("2-8 groups, in train order, one grid cell each"),
  links: z.array(sceneLink).describe("Max 8, between groups next to each other on the grid"),
});

export type TrainScene = z.infer<typeof trainSceneSchema>;
export type TrainGroup = z.infer<typeof trainGroup>;

/** One PR in a stacked train, bottom first. */
export interface TrainMember {
  number: number;
  title: string;
  state: "open" | "merged";
  baseRef: string;
  headRef: string;
  url: string;
}

/** A straight line of stacked PRs through one PR. */
export interface Train {
  /** Stable id: owner/repo plus the bottom PR's head branch. */
  key: string;
  owner: string;
  repo: string;
  /** Bottom (closest to the main branch) first. */
  members: TrainMember[];
}

function toClaudeJsonSchema(schema: z.ZodType): object {
  const { $schema: _unused, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
}

export const anatomyJsonSchema = toClaudeJsonSchema(anatomySchema);
export const trainSceneJsonSchema = toClaudeJsonSchema(trainSceneSchema);
