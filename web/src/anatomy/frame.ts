import type { PartKind, Scene, SceneLink, ScenePart, Train, TrainGroup, TrainScene } from "../../../server/sceneSchema.ts";
import { corners, cylinder, depthOf, extrude, iso, onTop, planOutline, ring, slabOf, topTicks, type Flat, type Plan, type Plane, type Projection } from "./kit/iso-kit.ts";
import { bodyBox, boxAround, labelBox, placeLabels, pointsOfPiece, type Box, type LabelledPart } from "./layout.ts";
import { buildPart, canBuildPart, type Look } from "./parts.ts";
import { dots, line, solid, type Ink, type Piece } from "./pieces.ts";

/** Floor size of one grid cell, in drawing units. */
export const CELL = 46;

const PROJECTION: Projection = { origin: [0, 0], scale: 1, azimuth: 52, elevation: 30 };
const PLATE_MARGIN = 7;
const PLATE_DEPTH = 5;
const LABEL_SHIFT = 20;
const LINK_GAP = 15;
const VIEW_PAD = 5;
// - Label height, as a share of drawing height.
// - About 11 px on a 190 px drawing.
const LABEL_SHARE = 0.06;

export type CodeLink = { file: string; startLine: number; endLine: number };

/** Where a train group sits relative to the PR this page is about. */
export type PartStatus = "done" | "current" | "later";

export type FramePart = {
  id: string;
  kind: PartKind;
  label: string;
  pieces: Piece[];
  isHidden: boolean;
  ink: Ink;
  code: CodeLink | null;
  // - Floor point where the part's label starts.
  labelAt: Flat;
  centre: Plane;
  depth: number;
  prs: number[];
  status: PartStatus | null;
};

export type FrameLink = { id: string; kind: SceneLink["kind"]; pieces: Piece[]; isHidden: boolean; ink: Ink };

/** Everything needed to paint one moment of the drawing. */
export type Frame = {
  viewBox: string;
  width: number;
  height: number;
  labelSize: number;
  base: Piece[];
  links: FrameLink[];
  parts: FramePart[];
};

type Cell = Pick<ScenePart, "id" | "kind" | "column" | "row" | "label">;

type PlacedPart = Cell & { look: Look; isHidden: boolean; ink: Ink; code: CodeLink | null; prs: number[]; status: PartStatus | null };

const centreOf = (cell: Pick<Cell, "column" | "row">): Plane => [cell.column * CELL, cell.row * CELL];

// - Base plate

function plateOf(cells: Cell[]): Plan {
  const columns = cells.map((cell) => cell.column);
  const rows = cells.map((cell) => cell.row);
  const left = (Math.min(...columns) - 0.5) * CELL - PLATE_MARGIN;
  const back = (Math.min(...rows) - 0.5) * CELL - PLATE_MARGIN;
  const width = (Math.max(...columns) - Math.min(...columns) + 1) * CELL + PLATE_MARGIN * 2;
  const depth = (Math.max(...rows) - Math.min(...rows) + 1) * CELL + PLATE_MARGIN * 2;
  return { x: left, y: back, w: width, d: depth, r: 6 };
}

function plateFeet(plate: Plan): Piece[] {
  const byDepth = corners(plate, 14).sort((first, second) => depthOf([...first, 0], PROJECTION) - depthOf([...second, 0], PROJECTION));
  return byDepth.flatMap(([footX, footY]) => [
    solid(cylinder(footX, footY, 5.6, -PLATE_DEPTH - 4, 1.4, PROJECTION, 24), "lo"),
    solid(cylinder(footX, footY, 4.2, -PLATE_DEPTH - 2.6, 2.6, PROJECTION, 24), "mid"),
  ]);
}

type Inner = { x: number; y: number; w: number; d: number };

function columnLine(inner: Inner, edgeX: number): string {
  return onTop([[edgeX, inner.y], [edgeX, inner.y + inner.d]], 0, PROJECTION);
}

function rowLine(inner: Inner, edgeY: number): string {
  return onTop([[inner.x, edgeY], [inner.x + inner.w, edgeY]], 0, PROJECTION);
}

/** Faint lines between the cells, running groove to groove. */
function cellLines(plate: Plan): string {
  const inner: Inner = { x: plate.x + 4, y: plate.y + 4, w: plate.w - 8, d: plate.d - 8 };
  const columnLines = cellEdgesBetween(inner.x, inner.w, plate.x + PLATE_MARGIN).map((edgeX) => columnLine(inner, edgeX));
  const rowLines = cellEdgesBetween(inner.y, inner.d, plate.y + PLATE_MARGIN).map((edgeY) => rowLine(inner, edgeY));
  return [...columnLines, ...rowLines].join("");
}

function cellEdgesBetween(start: number, length: number, firstCell: number): number[] {
  const edges: number[] = [];
  for (let edge = firstCell + CELL; edge < start + length - 1; edge += CELL) edges.push(edge);
  return edges;
}

/** A thin ruler strip along the front right edge, ticks hanging from its inner edge. */
function rulerStrip(plate: Plan): Piece[] {
  const strip: Plan = { x: plate.x + plate.w - 10, y: plate.y + 14, w: 4.5, d: plate.d - 28, r: 0.8 };
  const ticks = topTicks(strip.y + 2, strip.y + strip.d - 2, 3, 5, strip.x, 0.6, [1.5, 2.8], PROJECTION, "y");
  return [solid(slabOf(strip, 0, 0.6, PROJECTION, 2), "lo", "none"), line(ticks.minor, "lo"), line(ticks.major, "mid")];
}

function basePieces(cells: Cell[]): Piece[] {
  const plate = plateOf(cells);
  const groove: Plan = { x: plate.x + 4, y: plate.y + 4, w: plate.w - 8, d: plate.d - 8, r: 3 };
  const screws = corners(plate, 7);
  return [
    { kind: "halo", path: slabOf(plate, -PLATE_DEPTH - 4, PLATE_DEPTH, PROJECTION).fill },
    ...plateFeet(plate),
    solid(slabOf(plate, -PLATE_DEPTH, PLATE_DEPTH, PROJECTION, 6, 1.2), "mid"),
    line(planOutline(groove, 0, PROJECTION, 4), "lo"),
    line(cellLines(plate), "faint"),
    ...rulerStrip(plate),
    line(screws.map(([screwX, screwY]) => ring(screwX, screwY, 2, 0, PROJECTION, 14)).join(""), "lo"),
    dots(screws.map(([screwX, screwY]) => iso([screwX, screwY, 0], PROJECTION)), "mid", 0.6),
  ];
}

// - Links, flat on the floor

type Run = { from: Plane; to: Plane; along: Plane; across: Plane };

function runBetween(from: Plane, to: Plane): Run {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const along: Plane = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const start: Plane = [from[0] + along[0] * LINK_GAP, from[1] + along[1] * LINK_GAP];
  const end: Plane = [to[0] - along[0] * LINK_GAP, to[1] - along[1] * LINK_GAP];
  return { from: start, to: end, along, across: [-along[1], along[0]] };
}

/** A floor point `distance` along the run and `side` across it. */
function pointOnRun(run: Run, distance: number, side: number): Plane {
  return [run.from[0] + run.along[0] * distance + run.across[0] * side, run.from[1] + run.along[1] * distance + run.across[1] * side];
}

/** A box lying on the floor between two points along the run. */
function floorBox(run: Run, from: number, to: number, halfWidth: number, height: number): Piece[] {
  const at = (distance: number, side: number) => pointOnRun(run, distance, side);
  const outline = [at(from, -halfWidth), at(to, -halfWidth), at(to, halfWidth), at(from, halfWidth)];
  return [solid(extrude(outline, 0, height, PROJECTION, { bevel: 0.3 }), "mid")];
}

function runLength(run: Run): number {
  return Math.hypot(run.to[0] - run.from[0], run.to[1] - run.from[1]);
}

/** Ends ordered far first, so the nearer flange covers the pipe. */
function endsFarFirst(run: Run): [number, number] {
  const startDepth = depthOf([...run.from, 0], PROJECTION);
  const endDepth = depthOf([...run.to, 0], PROJECTION);
  return startDepth < endDepth ? [0, runLength(run)] : [runLength(run), 0];
}

function pipePieces(run: Run): Piece[] {
  const length = runLength(run);
  const [far, near] = endsFarFirst(run);
  const flange = (at: number) => floorBox(run, Math.max(0, at - 0.9), Math.min(length, at + 0.9), 3, 3.6);
  const band = (at: number) => floorBox(run, at - 0.6, at + 0.6, 2.1, 3);
  return [...flange(far), ...floorBox(run, 0, length, 1.6, 2.6), ...band(length / 3), ...band((length * 2) / 3), ...flange(near)];
}

function wirePieces(run: Run): Piece[] {
  const length = runLength(run);
  const clip = (at: number) => floorBox(run, at - 0.7, at + 0.7, 1.4, 1.2);
  return [
    line(onTop([run.from, run.to], 0.4, PROJECTION), "mid"),
    ...clip(length / 2),
    dots([iso([...run.from, 0.4], PROJECTION), iso([...run.to, 0.4], PROJECTION)], "hi", 1),
  ];
}

function beltPieces(run: Run): Piece[] {
  const length = runLength(run);
  const slatAt = (distance: number) => onTop([pointOnRun(run, distance, -3.2), pointOnRun(run, distance, 3.2)], 1, PROJECTION);
  const slats = Array.from({ length: Math.floor(length / 3) }, (_unused, index) => slatAt(1.5 + index * 3));
  return [...floorBox(run, 0, length, 3.6, 1), line(slats.join(""), "faint")];
}

const LINK_BUILDERS: Record<SceneLink["kind"], (run: Run) => Piece[]> = { pipe: pipePieces, wire: wirePieces, belt: beltPieces };

function linkInk(ends: PlacedPart[]): Ink {
  if (ends.some((end) => end.ink === "ghost")) return "ghost";
  return ends.some((end) => end.ink === "new") ? "new" : "plain";
}

/** True for a link kind this build can draw. */
export function canBuildLink(kind: string): boolean {
  return Object.hasOwn(LINK_BUILDERS, kind);
}

type Ends = [PlacedPart, PlacedPart];

/** Both placed parts a link joins, or null when one is missing. */
function endsOf(link: SceneLink, byId: Map<string, PlacedPart>): Ends | null {
  const from = byId.get(link.from);
  const to = byId.get(link.to);
  return from && to ? [from, to] : null;
}

function frameLink(link: SceneLink, ends: Ends, index: number): FrameLink {
  const pieces = LINK_BUILDERS[link.kind](runBetween(centreOf(ends[0]), centreOf(ends[1])));
  const isHidden = ends.some((end) => end.isHidden);
  return { id: `${link.from}-${link.to}-${index}`, kind: link.kind, pieces, isHidden, ink: linkInk(ends) };
}

function frameLinks(links: SceneLink[], placed: PlacedPart[]): FrameLink[] {
  const byId = new Map(placed.map((part) => [part.id, part]));
  return links.flatMap((link, index) => {
    const ends = endsOf(link, byId);
    return ends ? [frameLink(link, ends, index)] : [];
  });
}

// - Parts in painter's order

function depthOfCell(cell: Pick<Cell, "column" | "row">): number {
  return depthOf([...centreOf(cell), 0], PROJECTION);
}

type GridSpot = Pick<Cell, "column" | "row">;

function farFirst(first: GridSpot, second: GridSpot): number {
  return depthOfCell(first) - depthOfCell(second) || first.row - second.row || first.column - second.column;
}

/** Far before near; equal depths keep a fixed order by row, then column. */
export function paintOrder<T extends GridSpot>(cells: T[]): T[] {
  return [...cells].sort(farFirst);
}

function framePart(part: PlacedPart): FramePart {
  const centre = centreOf(part);
  return {
    id: part.id, kind: part.kind, label: part.label, isHidden: part.isHidden, ink: part.ink, code: part.code, prs: part.prs, status: part.status,
    pieces: buildPart(part.kind, centre, part.look, PROJECTION),
    labelAt: iso([centre[0] + LABEL_SHIFT, centre[1] + LABEL_SHIFT, 0], PROJECTION),
    centre,
    depth: depthOfCell(part),
  };
}

// - Fitting one view box and the labels over every step

type Layer = { base: Piece[]; links: FrameLink[]; parts: FramePart[] };

function piecesOfLayer(layer: Layer): Piece[] {
  return [...layer.base, ...layer.links.flatMap((link) => link.pieces), ...layer.parts.flatMap((part) => part.pieces)];
}

function boxOfBoxes(boxes: Box[]): Box {
  return boxAround(boxes.flatMap((box): Flat[] => [[box.left, box.top], [box.right, box.bottom]]));
}

/** The same part in every step. */
function versionsOf(part: FramePart, layers: Layer[]): FramePart[] {
  return layers.map((layer) => layer.parts.find((candidate) => candidate.id === part.id)!);
}

/** The room a part takes in any step. */
function roomOf(part: FramePart, layers: Layer[]): Box {
  return boxOfBoxes(versionsOf(part, layers).map((version) => bodyBox(version.pieces)));
}

/** Each part once, nearest first, with the room it takes in any step. */
function labelledParts(layers: Layer[]): LabelledPart[] {
  const nearestFirst = [...layers[0]!.parts].reverse();
  return nearestFirst.map((part) => ({ id: part.id, label: part.label, centre: part.centre, body: roomOf(part, layers) }));
}

function withLabelSpots(layer: Layer, spots: Map<string, Flat>): Layer {
  return { ...layer, parts: layer.parts.map((part) => ({ ...part, labelAt: spots.get(part.id) ?? part.labelAt })) };
}

function viewAround(drawn: Box, labels: Box[]): Pick<Frame, "viewBox" | "width" | "height"> {
  const box = boxOfBoxes([drawn, ...labels]);
  const width = box.right - box.left + VIEW_PAD * 2;
  const height = box.bottom - box.top + VIEW_PAD * 2;
  const numbers = [box.left - VIEW_PAD, box.top - VIEW_PAD, width, height].map((value) => Math.round(value * 10) / 10);
  return { viewBox: numbers.join(" "), width: numbers[2]!, height: numbers[3]! };
}

function layerOf(cells: Cell[], placed: PlacedPart[], links: SceneLink[]): Layer {
  return { base: basePieces(cells), links: frameLinks(links, placed), parts: paintOrder(placed).map(framePart) };
}

function framesOf(cells: Cell[], steps: PlacedPart[][], links: SceneLink[]): Frame[] {
  const layers = steps.map((placed) => layerOf(cells, placed, links));
  const drawn = boxAround(layers.flatMap(piecesOfLayer).flatMap(pointsOfPiece));
  const labelSize = (drawn.bottom - drawn.top) * LABEL_SHARE;
  const spots = placeLabels(labelledParts(layers), labelSize, PROJECTION, drawn);
  const labelled = layers.map((layer) => withLabelSpots(layer, spots));
  const view = viewAround(drawn, labelled[0]!.parts.map((part) => labelBox(part.label, part.labelAt, labelSize)));
  return labelled.map((layer) => ({ ...view, labelSize, ...layer }));
}

// - Story scenes

const EMPTY_LOOK: Look = { light: null, open: null, level: null, count: null, isNew: false };

function codeOf(part: ScenePart): CodeLink | null {
  return part.file ? { file: part.file, startLine: part.startLine, endLine: part.endLine } : null;
}

function placedInStep(scene: Scene, stepIndex: number): PlacedPart[] {
  const looks = scene.steps[stepIndex]?.looks ?? [];
  return scene.parts.map((part) => {
    const look = looks.find((candidate) => candidate.part === part.id);
    const isShown = look?.shown ?? true;
    return { ...part, look: look ?? EMPTY_LOOK, isHidden: !isShown, ink: look?.isNew ? "new" : "plain", code: codeOf(part), prs: [], status: null };
  });
}

/** Every step of a story, all fitted to one view box so the drawing never jumps. */
export function storyFrames(scene: Scene): Frame[] {
  const steps = scene.steps.map((_unused, stepIndex) => placedInStep(scene, stepIndex));
  return framesOf(scene.parts, steps.length ? steps : [placedInStep(scene, 0)], scene.links);
}

/** The scene without parts or links this build cannot draw. */
export function drawableScene(scene: Scene): Scene {
  const parts = scene.parts.filter((part) => canBuildPart(part.kind));
  return { ...scene, parts, links: scene.links.filter((link) => canBuildLink(link.kind)) };
}

/** One step of a story. */
export function frameOf(scene: Scene, stepIndex: number): Frame {
  const frames = storyFrames(scene);
  return frames[Math.min(Math.max(stepIndex, 0), frames.length - 1)]!;
}

// - Train scenes

const TRAIN_LOOK: Record<PartKind, Partial<Look>> = {
  cabinet: { light: "green" }, light: { light: "green" }, drawer: { open: true, count: 3 }, card: {}, probe: {}, gauge: { level: 0.5 },
  lock: { open: false }, conveyor: { count: 3 }, lever: { level: 1 }, press: { count: 3 }, bin: { count: 2 }, clock: { level: 0.3 },
};

function positionOf(train: Train, number: number): number {
  return train.members.findIndex((member) => member.number === number);
}

function comesBefore(train: Train, number: number, currentNumber: number): boolean {
  const position = positionOf(train, number);
  const isInTrain = position >= 0;
  return isInTrain && position < positionOf(train, currentNumber);
}

/** Current if it holds this PR, done if all its PRs come before it, later otherwise. */
export function groupStatus(group: TrainGroup, train: Train, currentNumber: number): PartStatus {
  if (group.prs.includes(currentNumber)) return "current";
  const isAllBefore = group.prs.every((number) => comesBefore(train, number, currentNumber));
  return isAllBefore ? "done" : "later";
}

const STATUS_INK: Record<PartStatus, Ink> = { done: "plain", current: "new", later: "ghost" };

function placedGroup(group: TrainGroup, status: PartStatus): PlacedPart {
  const look = { ...EMPTY_LOOK, ...TRAIN_LOOK[group.kind] };
  return { ...group, look, isHidden: false, ink: STATUS_INK[status], code: null, prs: group.prs, status };
}

/** The train scene without groups or links this build cannot draw. */
export function drawableTrainScene(scene: TrainScene): TrainScene {
  const groups = scene.groups.filter((group) => canBuildPart(group.kind));
  return { ...scene, groups, links: scene.links.filter((link) => canBuildLink(link.kind)) };
}

/**
 * The whole train as one still drawing.
 * - Done parts solid, this PR's part yellow.
 * - Later parts faint.
 */
export function trainFrameOf(scene: TrainScene, train: Train, currentNumber: number): Frame {
  const placed = scene.groups.map((group) => placedGroup(group, groupStatus(group, train, currentNumber)));
  return framesOf(scene.groups, [placed], scene.links)[0]!;
}
