import { createHash } from "node:crypto";

import {
  GRID_COLUMNS, GRID_ROWS, STEP_KEYS,
  type PartKind, type PartLook, type Scene, type SceneLink, type ScenePart, type StoryStep, type Train, type TrainGroup, type TrainScene,
} from "./sceneSchema.ts";
import type { Walkthrough } from "./schemas.ts";

const MAX_PARTS = 8;
const MAX_SCENE_LINKS = 6;
const MAX_GROUPS = 8;
const MAX_TRAIN_LINKS = 8;
const MAX_CODE_LINES = 160;
const MAX_LABEL_WORDS = 3;

/** A part's first and last code line, to find it again. */
export type PartAnchor = { first: string; last: string };

/** What the anatomy job saves for one PR. */
export type AnatomyData = {
  scene: Scene | null;
  // - Story and big picture the scene was made from.
  basedOn: string;
  // - Keyed by part id; only parts with code.
  anchors?: Record<string, PartAnchor>;
};

/** A file's lines in the checkout; empty when it is gone. */
export type FileLines = (file: string) => string[];

/** What the train job saves for one train. */
export type TrainSceneData = { scene: TrainScene | null };

type CodeLink = { file: string; startLine: number; endLine: number };

type Cell = { column: number; row: number };

type Placed = Cell & { id: string };

type LookField = "light" | "open" | "level" | "count";

const LOOK_FIELDS: LookField[] = ["light", "open", "level", "count"];

const LOOK_FIELDS_BY_KIND: Record<PartKind, LookField[]> = {
  cabinet: ["light"], light: ["light"], drawer: ["open", "count"], card: [], probe: [], gauge: ["level"],
  lock: ["open"], conveyor: ["count"], lever: ["level"], press: ["count"], bin: ["count"], clock: ["level"],
};

function fingerprintOf(text: string): string {
  return createHash("sha1").update(text).digest("hex");
}

/** Drops paths that do not exist and keeps line ranges inside the file. */
export function checkedCodeLink<T extends CodeLink>(item: T, lineCount: number): T {
  if (!item.file || lineCount === 0) return { ...item, file: "", startLine: 0, endLine: 0 };
  const startLine = Math.min(Math.max(1, item.startLine), lineCount);
  const endLine = Math.min(Math.max(startLine, item.endLine), lineCount, startLine + MAX_CODE_LINES - 1);
  return { ...item, startLine, endLine };
}

/** The first item for each key, in the order given. */
function firstOfEach<T>(items: T[], keyOf: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    if (!byKey.has(keyOf(item))) byKey.set(keyOf(item), item);
  }
  return [...byKey.values()];
}

function cellKey(cell: Cell): string {
  return `${cell.column},${cell.row}`;
}

function cellDistance(left: Cell, right: Cell): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

function allCells(): Cell[] {
  const rows = Array.from({ length: GRID_ROWS }, (_unused, row) => row);
  return rows.flatMap((row) => Array.from({ length: GRID_COLUMNS }, (_unused, column) => ({ column, row })));
}

function nearestFreeCell(wanted: Cell, taken: Set<string>): Cell | undefined {
  const freeCells = allCells().filter((cell) => !taken.has(cellKey(cell)));
  return freeCells.sort((left, right) => cellDistance(left, wanted) - cellDistance(right, wanted))[0];
}

/** Moves items that share a cell to the nearest free one. */
function onFreeCells<T extends Placed>(items: T[]): T[] {
  const taken = new Set<string>();
  const placed: T[] = [];
  for (const item of items) {
    const cell = taken.has(cellKey(item)) ? nearestFreeCell(item, taken) : item;
    if (!cell) continue;
    taken.add(cellKey(cell));
    placed.push({ ...item, column: cell.column, row: cell.row });
  }
  return placed;
}

function joinsNeighbours(link: SceneLink, placedById: Map<string, Placed>): boolean {
  const fromItem = placedById.get(link.from);
  const toItem = placedById.get(link.to);
  if (!fromItem || !toItem) return false;
  return cellDistance(fromItem, toItem) === 1;
}

function linkEnds(link: SceneLink): string {
  return [link.from, link.to].sort().join(" ");
}

/** Keeps links whose two ends exist and stand side by side. */
function neighbourLinks(links: SceneLink[], items: Placed[], maxLinks: number): SceneLink[] {
  const placedById = new Map(items.map((item) => [item.id, item]));
  const kept = links.filter((link) => joinsNeighbours(link, placedById));
  return firstOfEach(kept, linkEnds).slice(0, maxLinks);
}

/** At most three words, so every view shows the same label. */
function shortLabel<T extends { label: string }>(item: T): T {
  const words = item.label.trim().split(/\s+/);
  return { ...item, label: words.slice(0, MAX_LABEL_WORDS).join(" ") };
}

function withCheckedCode(part: ScenePart, lineCountOf: (file: string) => number): ScenePart {
  const lineCount = part.file ? lineCountOf(part.file) : 0;
  return checkedCodeLink(part, lineCount);
}

function checkedParts(parts: ScenePart[], lineCountOf: (file: string) => number): ScenePart[] {
  const uniqueParts = firstOfEach(parts, (part) => part.id).slice(0, MAX_PARTS);
  return onFreeCells(uniqueParts).map(shortLabel).map((part) => withCheckedCode(part, lineCountOf));
}

function defaultLook(partId: string): PartLook {
  return { part: partId, shown: true, isNew: false, light: null, open: null, level: null, count: null };
}

/** Clears look fields the part's kind does not use. */
function fittedToKind(look: PartLook, kind: PartKind): PartLook {
  const fitted = { ...look };
  const unusedFields = LOOK_FIELDS.filter((field) => !LOOK_FIELDS_BY_KIND[kind].includes(field));
  for (const field of unusedFields) fitted[field] = null;
  return fitted;
}

function looksByPart(looks: PartLook[]): Map<string, PartLook> {
  return new Map(firstOfEach(looks, (look) => look.part).map((look) => [look.part, look]));
}

/** The part's look in this step; a missing one keeps the last step's look. */
function lookFor(part: ScenePart, given: Map<string, PartLook>, previous: Map<string, PartLook>): PartLook {
  const look = given.get(part.id) ?? previous.get(part.id) ?? defaultLook(part.id);
  return fittedToKind({ ...look, part: part.id }, part.kind);
}

function withoutNewParts(looks: PartLook[]): PartLook[] {
  return looks.map((look) => ({ ...look, isNew: false }));
}

/** Before, change, after, each with one look per part; null if a step is missing. */
function orderedSteps(steps: StoryStep[], parts: ScenePart[]): StoryStep[] | null {
  const ordered: StoryStep[] = [];
  let previous = new Map<string, PartLook>();
  for (const key of STEP_KEYS) {
    const step = steps.find((candidate) => candidate.key === key);
    if (!step) return null;
    const looks = parts.map((part) => lookFor(part, looksByPart(step.looks), previous));
    const stepLooks = key === "before" ? withoutNewParts(looks) : looks;
    ordered.push({ key, say: step.say, looks: stepLooks });
    previous = looksByPart(stepLooks);
  }
  return ordered;
}

/** A scene the drawing can trust, or null when too little of it holds up. */
export function checkedScene(scene: Scene, lineCountOf: (file: string) => number): Scene | null {
  const parts = checkedParts(scene.parts, lineCountOf);
  const steps = orderedSteps(scene.steps, parts);
  if (parts.length === 0 || !steps) return null;
  return { ...scene, parts, links: neighbourLinks(scene.links, parts, MAX_SCENE_LINKS), steps };
}

function anchorOf(part: ScenePart, linesOf: FileLines): PartAnchor {
  const lines = linesOf(part.file);
  return { first: lines[part.startLine - 1] ?? "", last: lines[part.endLine - 1] ?? "" };
}

/** Each code part's first and last line, as text. */
export function anchorsOf(scene: Scene, linesOf: FileLines): Record<string, PartAnchor> {
  const withCode = scene.parts.filter((part) => part.file !== "");
  return Object.fromEntries(withCode.map((part) => [part.id, anchorOf(part, linesOf)]));
}

/** The 1-based number of the line with this text nearest `near`. */
function nearestLineWith(lines: string[], text: string, near: number): number | undefined {
  const matches = lines.flatMap((line, index) => (line === text ? [index + 1] : []));
  const byDistance = (left: number, right: number) => Math.abs(left - near) - Math.abs(right - near);
  return matches.sort(byDistance)[0];
}

function withoutCode(part: ScenePart): ScenePart {
  return { ...part, file: "", startLine: 0, endLine: 0 };
}

/** The part at its lines' new place, or without code. */
function movedPart(part: ScenePart, anchor: PartAnchor | undefined, linesOf: FileLines): ScenePart {
  if (!part.file || !anchor) return part;
  const lines = linesOf(part.file);
  const startLine = nearestLineWith(lines, anchor.first, part.startLine);
  const length = part.endLine - part.startLine;
  const endLine = nearestLineWith(lines, anchor.last, (startLine ?? part.startLine) + length);
  const isFound = startLine !== undefined && endLine !== undefined && endLine >= startLine;
  return isFound ? { ...part, startLine, endLine } : withoutCode(part);
}

/** A kept scene, its code links moved and checked again. */
export function movedAnatomy(data: AnatomyData, linesOf: FileLines): AnatomyData {
  if (!data.scene) return data;
  const parts = data.scene.parts.map((part) => movedPart(part, data.anchors?.[part.id], linesOf));
  const scene = checkedScene({ ...data.scene, parts }, (file) => linesOf(file).length);
  return { ...data, scene, anchors: scene ? anchorsOf(scene, linesOf) : {} };
}

/** Changes only when the walkthrough's story or big picture changes. */
export function storyFingerprint(walkthrough: Walkthrough): string {
  const { caption, diagram } = walkthrough.picture;
  return fingerprintOf(JSON.stringify({ story: walkthrough.story, caption, diagram }));
}

/** True when the saved scene was made from this same story and picture. */
export function canReuseAnatomy(previousData: unknown, walkthrough: Walkthrough, isFullRebuild: boolean): boolean {
  const basedOn = (previousData as Partial<AnatomyData> | null | undefined)?.basedOn;
  if (isFullRebuild || !basedOn) return false;
  return basedOn === storyFingerprint(walkthrough);
}

/** Changes whenever a PR joins or leaves the train, or is renamed. */
export function trainFingerprint(train: Train): string {
  return fingerprintOf(train.members.map((member) => `${member.number}:${member.title}`).join("\n"));
}

type SavedTrainJob = { builtFor: string | null; data: unknown };

/** True when a train scene was already made for these exact members. */
export function hasTrainSceneFor(job: SavedTrainJob | undefined, fingerprint: string): boolean {
  if (!job?.data) return false;
  return job.builtFor === fingerprint;
}

/** Each PR stays in the first group that names it; unknown numbers go. */
function claimPrs(groups: TrainGroup[], memberNumbers: number[]): TrainGroup[] {
  const known = new Set(memberNumbers);
  const claimed = new Set<number>();
  const isUnclaimedMember = (prNumber: number) => known.has(prNumber) && !claimed.has(prNumber);
  return groups.map((group) => {
    const prs = group.prs.filter(isUnclaimedMember);
    prs.forEach((prNumber) => claimed.add(prNumber));
    return { ...group, prs };
  });
}

function distanceToGroup(group: TrainGroup, position: number, positions: Map<number, number>): number {
  return Math.min(...group.prs.map((prNumber) => Math.abs(positions.get(prNumber)! - position)));
}

/** The group holding the PR closest in train order; earlier wins a tie. */
function nearestGroup(groups: TrainGroup[], prNumber: number, positions: Map<number, number>): TrainGroup {
  const position = positions.get(prNumber)!;
  let nearest = groups[0];
  const isNearer = (group: TrainGroup) => distanceToGroup(group, position, positions) < distanceToGroup(nearest, position, positions);
  for (const group of groups) {
    if (isNearer(group)) nearest = group;
  }
  return nearest;
}

function missingMembers(groups: TrainGroup[], memberNumbers: number[]): number[] {
  const grouped = new Set(groups.flatMap((group) => group.prs));
  return memberNumbers.filter((prNumber) => !grouped.has(prNumber));
}

function inTrainOrder(prs: number[], positions: Map<number, number>): number[] {
  return [...prs].sort((left, right) => positions.get(left)! - positions.get(right)!);
}

/** Adds each PR no group named to the group whose own PRs sit nearest it. */
function withEveryMember(groups: TrainGroup[], memberNumbers: number[]): TrainGroup[] {
  const positions = new Map(memberNumbers.map((prNumber, position) => [prNumber, position]));
  const addedById = new Map(groups.map((group) => [group.id, [] as number[]]));
  const groupIdNearest = (prNumber: number) => nearestGroup(groups, prNumber, positions).id;
  const addedPrsOf = (groupId: string) => addedById.get(groupId)!;
  for (const prNumber of missingMembers(groups, memberNumbers)) addedPrsOf(groupIdNearest(prNumber)).push(prNumber);
  const withAddedPrs = (group: TrainGroup) => ({ ...group, prs: inTrainOrder([...group.prs, ...addedPrsOf(group.id)], positions) });
  return groups.map(withAddedPrs);
}

function knownGroups(groups: TrainGroup[], memberNumbers: number[]): TrainGroup[] {
  const uniqueGroups = firstOfEach(groups, (group) => group.id).slice(0, MAX_GROUPS);
  const nonEmpty = claimPrs(uniqueGroups, memberNumbers).filter((group) => group.prs.length > 0);
  return onFreeCells(nonEmpty).map(shortLabel);
}

/** Every train PR in exactly one group, or null when no group holds up. */
export function checkedTrainScene(scene: TrainScene, train: Train): TrainScene | null {
  const memberNumbers = train.members.map((member) => member.number);
  const groups = knownGroups(scene.groups, memberNumbers);
  if (groups.length === 0) return null;
  const filled = withEveryMember(groups, memberNumbers);
  return { ...scene, groups: filled, links: neighbourLinks(scene.links, filled, MAX_TRAIN_LINKS) };
}
