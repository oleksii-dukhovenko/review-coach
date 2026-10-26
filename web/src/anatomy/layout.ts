import { iso, type Flat, type Plane, type Projection } from "./kit/iso-kit.ts";
import type { Piece } from "./pieces.ts";

/** A screen rectangle. */
export type Box = { left: number; top: number; right: number; bottom: number };

const NUMBER_PAIR = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;

function isRound(piece: Piece): piece is Extract<Piece, { kind: "ball" | "glow" }> {
  return piece.kind === "ball" || piece.kind === "glow";
}

function cornersOfRound(piece: Extract<Piece, { kind: "ball" | "glow" }>): Flat[] {
  const [centreX, centreY] = piece.center;
  return [[centreX - piece.radius, centreY - piece.radius], [centreX + piece.radius, centreY + piece.radius]];
}

/** Screen points a piece covers, read from its path data. */
export function pointsOfPiece(piece: Piece): Flat[] {
  if (piece.kind === "dots") return piece.points;
  if (isRound(piece)) return cornersOfRound(piece);
  const text = piece.kind === "solid" ? piece.paths.fill : piece.path;
  return [...text.matchAll(NUMBER_PAIR)].map((match) => [Number(match[1]), Number(match[2])] as Flat);
}

export function boxAround(points: Flat[]): Box {
  const xs = points.map(([pointX]) => pointX);
  const ys = points.map(([, pointY]) => pointY);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

// - Soft shadows and glows are not the body.
function isBodyPiece(piece: Piece): boolean {
  const isSoft = piece.kind === "halo" || piece.kind === "glow";
  return !isSoft;
}

/** The solid body of a part on screen, without its soft shadow or glow. */
export function bodyBox(pieces: Piece[]): Box {
  return boxAround(pieces.filter(isBodyPiece).flatMap(pointsOfPiece));
}

function overlapArea(first: Box, second: Box): number {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function areaOf(box: Box): number {
  return (box.right - box.left) * (box.bottom - box.top);
}

// - Longer labels go on two lines.
const ONE_LINE_CHARS = 12;

function linesSplitAt(words: string[], splitAt: number): string[] {
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

function longestLine(lines: string[]): number {
  return Math.max(...lines.map((text) => text.length));
}

/** Two lines, split where the longer line is shortest. */
function balancedLines(words: string[]): string[] {
  const splits = words.slice(1).map((_unused, index) => linesSplitAt(words, index + 1));
  return splits.reduce((best, lines) => (longestLine(lines) < longestLine(best) ? lines : best));
}

/** Lines a label is set on: one line, or two when it is long. */
export function labelLines(label: string): string[] {
  const words = label.trim().split(/\s+/);
  const fitsOnOneLine = words.join(" ").length <= ONE_LINE_CHARS || words.length < 2;
  return fitsOnOneLine ? [words.join(" ")] : balancedLines(words);
}

function labelWidth(label: string, size: number): number {
  return longestLine(labelLines(label)) * size * 0.55;
}

function labelHeight(label: string, size: number): number {
  return labelLines(label).length * size * 1.15 + size * 0.3;
}

/** The rectangle a label takes when it hangs centred below `at`. */
export function labelBox(label: string, at: Flat, size: number): Box {
  const halfWidth = labelWidth(label, size) / 2;
  return { left: at[0] - halfWidth, top: at[1], right: at[0] + halfWidth, bottom: at[1] + labelHeight(label, size) };
}

/** Floor spots in front of a part where its label may go, best first. */
const LABEL_SPOTS: Plane[] = [[19, 19], [4, 23], [23, 4], [-9, 25], [25, -9], [32, -16], [-16, 32]];

// - Covering its own part costs less than a neighbour.
const OWN_PART_WEIGHT = 0.3;
const OTHER_PART_WEIGHT = 1.5;
const OTHER_LABEL_WEIGHT = 3;
// - Growing the drawing costs most.
const OUTSIDE_WEIGHT = 4;
const LATER_SPOT_COST = 0.5;
// - Above the part only when the floor is crowded.
const OVERHEAD_COST = 12;
const OVERHEAD_GAP = 1.5;
// - Sideways nudges, as a share of the label's width.
const FLOOR_NUDGES = [0, -0.25, 0.25];
const OVERHEAD_NUDGES = [0, 0.25, -0.25, 0.5, -0.5];
const NUDGE_COST = 2;
// - Labels keep this share of their size apart.
const LABEL_MARGIN = 0.9;

export type LabelledPart = { id: string; label: string; centre: Plane; body: Box };

// - extraCost: how much less natural the spot is.
type Spot = { at: Flat; extraCost: number };

// - frame: the drawing, which labels should stay inside.
type Room = { parts: LabelledPart[]; placed: Map<string, Box>; frame: Box; size: number; projection: Projection };

function nudged(spot: Spot, part: LabelledPart, share: number, size: number): Spot {
  const shift = share * labelWidth(part.label, size);
  return { at: [spot.at[0] + shift, spot.at[1]], extraCost: spot.extraCost + Math.abs(share) * NUDGE_COST };
}

function floorSpot(part: LabelledPart, room: Room, [across, deep]: Plane, index: number): Spot {
  const at = iso([part.centre[0] + across, part.centre[1] + deep, 0], room.projection);
  return { at, extraCost: index * LATER_SPOT_COST };
}

/** Floor spots in front of the part, each also nudged sideways. */
function floorSpots(part: LabelledPart, room: Room): Spot[] {
  const spots = LABEL_SPOTS.map((offset, index) => floorSpot(part, room, offset, index));
  return spots.flatMap((spot) => FLOOR_NUDGES.map((share) => nudged(spot, part, share, room.size)));
}

/** Just above the part's top, centred or nudged sideways. */
function overheadSpots(part: LabelledPart, room: Room): Spot[] {
  const centreX = (part.body.left + part.body.right) / 2;
  const top = part.body.top - OVERHEAD_GAP - labelHeight(part.label, room.size);
  const overhead: Spot = { at: [centreX, top], extraCost: OVERHEAD_COST };
  return OVERHEAD_NUDGES.map((share) => nudged(overhead, part, share, room.size));
}

function grown(box: Box, margin: number): Box {
  return { left: box.left - margin, top: box.top - margin, right: box.right + margin, bottom: box.bottom + margin };
}

function weightFor(other: LabelledPart, part: LabelledPart): number {
  return other.id === part.id ? OWN_PART_WEIGHT : OTHER_PART_WEIGHT;
}

function overOtherLabels(part: LabelledPart, box: Box, room: Room): number {
  const others = [...room.placed].filter(([id]) => id !== part.id).map(([, placed]) => placed);
  const spaced = grown(box, room.size * LABEL_MARGIN);
  return others.reduce((sum, other) => sum + overlapArea(spaced, other) * OTHER_LABEL_WEIGHT, 0);
}

function outsideFrame(box: Box, frame: Box): number {
  return (areaOf(box) - overlapArea(box, frame)) * OUTSIDE_WEIGHT;
}

function overParts(part: LabelledPart, box: Box, room: Room): number {
  return room.parts.reduce((sum, other) => sum + overlapArea(box, other.body) * weightFor(other, part), 0);
}

function spotCost(part: LabelledPart, spot: Spot, room: Room): number {
  const box = labelBox(part.label, spot.at, room.size);
  const covered = overParts(part, box, room) + overOtherLabels(part, box, room);
  return covered + outsideFrame(box, room.frame) + spot.extraCost;
}

function bestSpot(part: LabelledPart, room: Room): Flat {
  const spots = [...floorSpots(part, room), ...overheadSpots(part, room)];
  const costed = spots.map((spot) => ({ at: spot.at, cost: spotCost(part, spot, room) }));
  return costed.reduce((best, choice) => (choice.cost < best.cost ? choice : best)).at;
}

function placeEach(parts: LabelledPart[], room: Room, spots: Map<string, Flat>): void {
  for (const part of parts) {
    const at = bestSpot(part, room);
    spots.set(part.id, at);
    room.placed.set(part.id, labelBox(part.label, at, room.size));
  }
}

/**
 * Puts each label where it covers the least.
 * - First pass: nearest part first.
 * - Second pass: each label again, seeing every other label.
 */
export function placeLabels(parts: LabelledPart[], size: number, projection: Projection, frame: Box): Map<string, Flat> {
  const room: Room = { parts, placed: new Map(), frame, size, projection };
  const spots = new Map<string, Flat>();
  placeEach(parts, room, spots);
  placeEach(parts, room, spots);
  return spots;
}
