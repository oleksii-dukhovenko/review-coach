import { iso, type Flat, type Plane, type Projection } from "./kit/iso-kit.ts";
import type { Piece } from "./pieces.ts";

/** A screen rectangle. */
export type Box = { left: number; top: number; right: number; bottom: number };

const NUMBER_PAIR = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;

/** Screen points a piece covers, read from its path data. */
export function pointsOfPiece(piece: Piece): Flat[] {
  if (piece.kind === "dots") return piece.points;
  if (piece.kind === "ball" || piece.kind === "glow") {
    const [centreX, centreY] = piece.center;
    return [[centreX - piece.radius, centreY - piece.radius], [centreX + piece.radius, centreY + piece.radius]];
  }
  const text = piece.kind === "solid" ? piece.paths.fill : piece.path;
  return [...text.matchAll(NUMBER_PAIR)].map((match) => [Number(match[1]), Number(match[2])] as Flat);
}

export function boxAround(points: Flat[]): Box {
  const xs = points.map(([pointX]) => pointX);
  const ys = points.map(([, pointY]) => pointY);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/** The solid body of a part on screen, without its soft shadow or glow. */
export function bodyBox(pieces: Piece[]): Box {
  const body = pieces.filter((piece) => piece.kind !== "halo" && piece.kind !== "glow");
  return boxAround(body.flatMap(pointsOfPiece));
}

function overlapArea(first: Box, second: Box): number {
  const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
  const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Lines a label is set on: one line, or two when it is long. */
export function labelLines(label: string): string[] {
  const words = label.trim().split(/\s+/).slice(0, 3);
  if (words.join(" ").length <= 12 || words.length < 2) return [words.join(" ")];
  const isFirstPairShorter = words.length === 3 && words[0]!.length + words[1]!.length < words[1]!.length + words[2]!.length;
  const splitAt = isFirstPairShorter ? 2 : 1;
  return [words.slice(0, splitAt).join(" "), words.slice(splitAt).join(" ")];
}

/** The rectangle a label takes when it hangs centred below `at`. */
export function labelBox(label: string, at: Flat, size: number): Box {
  const lines = labelLines(label);
  const halfWidth = (Math.max(...lines.map((text) => text.length)) * size * 0.55) / 2;
  return { left: at[0] - halfWidth, top: at[1], right: at[0] + halfWidth, bottom: at[1] + lines.length * size * 1.15 + size * 0.3 };
}

/** Floor spots in front of a part where its label may go, best first. */
const LABEL_SPOTS: Plane[] = [[19, 19], [4, 23], [23, 4], [-9, 25], [25, -9], [32, -16], [-16, 32]];

// - A label over its own part costs less than one over a neighbour.
const OWN_PART_WEIGHT = 0.3;
const OTHER_LABEL_WEIGHT = 2;
const LATER_SPOT_COST = 0.5;

export type LabelledPart = { id: string; label: string; centre: Plane; body: Box };

function spotCost(part: LabelledPart, box: Box, parts: LabelledPart[], placed: Box[]): number {
  const overParts = parts.reduce((sum, other) => sum + overlapArea(box, other.body) * (other.id === part.id ? OWN_PART_WEIGHT : 1), 0);
  const overLabels = placed.reduce((sum, other) => sum + overlapArea(box, other) * OTHER_LABEL_WEIGHT, 0);
  return overParts + overLabels;
}

function bestSpot(part: LabelledPart, parts: LabelledPart[], placed: Box[], size: number, projection: Projection): Flat {
  const choices = LABEL_SPOTS.map(([across, deep], index) => {
    const at = iso([part.centre[0] + across, part.centre[1] + deep, 0], projection);
    return { at, cost: spotCost(part, labelBox(part.label, at, size), parts, placed) + index * LATER_SPOT_COST };
  });
  return choices.reduce((best, choice) => (choice.cost < best.cost ? choice : best)).at;
}

/** Puts each label on the floor in front of its part, where it covers the least. */
export function placeLabels(parts: LabelledPart[], size: number, projection: Projection): Map<string, Flat> {
  const spots = new Map<string, Flat>();
  const placed: Box[] = [];
  for (const part of parts) {
    const at = bestSpot(part, parts, placed, size, projection);
    spots.set(part.id, at);
    placed.push(labelBox(part.label, at, size));
  }
  return spots;
}
