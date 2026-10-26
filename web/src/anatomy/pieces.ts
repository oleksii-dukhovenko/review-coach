import {
  cameraOf, circleRing, cylinder, depthOf, iso, knurl, lineOnTop, onTop, pathOf, planOutline, pointsAt, radialTicks, ring,
  segment, sideArc, sideSeam, slabOf, type Flat, type LineTone, type Plan, type Plane, type Point3, type Projection,
  type SolidPaths, type Tone,
} from "./kit/iso-kit.ts";

/** A colour set a part or piece is painted in; "plain" keeps the drawing's greys. */
export type Ink = "plain" | "new" | "green" | "red" | "off" | "ghost";

/** What a flat closed shape is filled with. */
export type PatchFill = "cavity" | "face" | "glass" | "side" | "dial";

export type SolidPiece = { kind: "solid"; paths: SolidPaths; tone: Tone; crease: Tone | "none"; ink?: Ink; lit?: boolean; inner?: string };
export type LinePiece = { kind: "line"; path: string; tone: LineTone; free?: boolean; heavy?: boolean };
export type DotsPiece = { kind: "dots"; points: Flat[]; size: number; tone: Tone };
export type PatchPiece = { kind: "patch"; path: string; fill: PatchFill; tone: LineTone; ink?: Ink };
export type BallPiece = { kind: "ball"; center: Flat; radius: number; tone: Tone; ink?: Ink };
export type GlowPiece = { kind: "glow"; center: Flat; radius: number; ink: Ink };
export type HaloPiece = { kind: "halo"; path: string };

/** One drawable thing; a part is a list of these, bottom to top. */
export type Piece = SolidPiece | LinePiece | DotsPiece | PatchPiece | BallPiece | GlowPiece | HaloPiece;

export const solid = (paths: SolidPaths, tone: Tone, crease: Tone | "none" = "faint", ink?: Ink): SolidPiece => ({ kind: "solid", paths, tone, crease, ink });
export const seamed = (paths: SolidPaths, tone: Tone, inner: string): SolidPiece => ({ kind: "solid", paths, tone, crease: "faint", inner });
export const ball = (center: Flat, radius: number, tone: Tone = "mid", ink?: Ink): BallPiece => ({ kind: "ball", center, radius, tone, ink });
export const line = (path: string, tone: LineTone = "lo", free = false): LinePiece => ({ kind: "line", path, tone, free });
export const heavyLine = (path: string, tone: LineTone): LinePiece => ({ kind: "line", path, tone, heavy: true });
export const dots = (points: Flat[], tone: Tone = "mid", size = 0.55): DotsPiece => ({ kind: "dots", points, size, tone });
export const patch = (path: string, fill: PatchFill, tone: LineTone = "lo", ink?: Ink): PatchPiece => ({ kind: "patch", path, fill, tone, ink });

type Profile = Plane[];
type Axis = "x" | "y";

function viewVector(projection: Projection): Point3 {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  return [cosA * cosE, sinA * cosE, sinE];
}

const nextOf = (profile: Profile, index: number): Plane => profile[(index + 1) % profile.length]!;

function signedArea(profile: Profile): number {
  const twiceArea = profile.reduce((sum, [fromAcross, fromUp], index) => {
    const [toAcross, toUp] = nextOf(profile, index);
    return sum + fromAcross * toUp - toAcross * fromUp;
  }, 0);
  return twiceArea / 2;
}

/** Outward normal of each profile edge, as a world vector. */
function edgeNormals(profile: Profile, axis: Axis): Point3[] {
  const outwardSign = signedArea(profile) > 0 ? 1 : -1;
  return profile.map(([fromAcross, fromUp], index) => {
    const [toAcross, toUp] = nextOf(profile, index);
    const length = Math.hypot(toAcross - fromAcross, toUp - fromUp) || 1;
    const across = (outwardSign * (toUp - fromUp)) / length;
    const up = (outwardSign * (fromAcross - toAcross)) / length;
    return axis === "y" ? [across, 0, up] : [0, across, up];
  });
}

const worldOf = (axis: Axis, [across, up]: Plane, along: number): Point3 => (axis === "y" ? [across, along, up] : [along, across, up]);

function shadeOf(normal: Point3, projection: Projection): number {
  const { sinA, cosA } = cameraOf(projection);
  const light = (normal[0] * -sinA + normal[1] * cosA) * 0.5 + 0.5 + normal[2] * 0.35;
  return Math.min(3, Math.max(0, Math.floor(light * 4)));
}

/** One run around every edge, or none, when all edges face one way. */
function wholeLoopRun(flags: boolean[], want: boolean): number[][] {
  const loop = Array.from({ length: flags.length + 1 }, (_unused, index) => index % flags.length);
  return flags[0] === want ? [loop] : [];
}

/** Indexes of each run of edges whose facing equals `want`, as vertex lists. */
function runsOf(flags: boolean[], want: boolean): number[][] {
  const count = flags.length;
  const start = flags.findIndex((flag, index) => flag !== flags[(index + count - 1) % count]);
  if (start < 0) return wholeLoopRun(flags, want);
  const runs: number[][] = [];
  let run: number[] | null = null;
  for (let step = 0; step < count; step++) {
    const index = (start + step) % count;
    if (flags[index] === want) {
      run ??= [index];
      run.push((index + 1) % count);
    } else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** A prism on screen: its near cap, far cap, and which sides face the viewer. */
type Prism = { near: Flat[]; far: Flat[]; normals: Point3[]; facing: boolean[] };

function prismOf(profile: Profile, axis: Axis, from: number, to: number, projection: Projection): Prism {
  const view = viewVector(projection);
  const normals = edgeNormals(profile, axis);
  const facesViewer = (normal: Point3) => normal[0] * view[0] + normal[1] * view[1] + normal[2] * view[2] > 1e-9;
  return {
    near: profile.map((point) => iso(worldOf(axis, point, to), projection)),
    far: profile.map((point) => iso(worldOf(axis, point, from), projection)),
    normals,
    facing: normals.map(facesViewer),
  };
}

function sideQuad(prism: Prism, index: number): string {
  const next = (index + 1) % prism.near.length;
  return pathOf([prism.near[index]!, prism.near[next]!, prism.far[next]!, prism.far[index]!], true);
}

const visibleSides = (prism: Prism): number[] => prism.facing.flatMap((isFacing, index) => (isFacing ? [index] : []));

function sideShades(prism: Prism, projection: Projection): string[] {
  const buckets: string[][] = [[], [], [], []];
  const bucketOf = (index: number) => buckets[shadeOf(prism.normals[index]!, projection)]!;
  visibleSides(prism).forEach((index) => bucketOf(index).push(sideQuad(prism, index)));
  return buckets.map((paths) => paths.join(""));
}

/**
 * The silhouette of a prism.
 * - Cap edges on hidden sides.
 * - Far edges on visible sides.
 * - The corners where they meet.
 */
function prismOutline(prism: Prism): string {
  const { near, far, facing } = prism;
  const count = facing.length;
  const capEdges = runsOf(facing, false).map((run) => pathOf(run.map((index) => near[index]!)));
  const farEdges = runsOf(facing, true).map((run) => pathOf(run.map((index) => far[index]!)));
  const isTurn = (index: number) => facing[(index + count - 1) % count] !== facing[index];
  const corners = near.flatMap((_unused, index) => (isTurn(index) ? [pathOf([near[index]!, far[index]!])] : []));
  return [...capEdges, ...farEdges, ...corners].join("");
}

/**
 * A prism whose profile lies across `axis`, extruded along it from `from` to `to`.
 * - The cap at `to` faces the viewer and is painted as the top.
 * - Profile points are (across, height) pairs.
 */
export function extrudeAlong(profile: Profile, axis: Axis, from: number, to: number, projection: Projection): SolidPaths {
  const prism = prismOf(profile, axis, from, to, projection);
  return {
    fill: [pathOf(prism.near, true), pathOf(prism.far, true), ...visibleSides(prism).map((index) => sideQuad(prism, index))].join(""),
    outline: prismOutline(prism),
    crease: runsOf(prism.facing, true).map((run) => pathOf(run.map((index) => prism.near[index]!))).join(""),
    top: pathOf(prism.near, true),
    shades: sideShades(prism, projection),
  };
}

/** A circle as a profile, for drums, pins and knobs lying on their side. */
export function circleProfile(across: number, height: number, radius: number, steps = 28): Profile {
  return Array.from({ length: steps }, (_unused, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return [across + radius * Math.cos(angle), height + radius * Math.sin(angle)] as Plane;
  });
}

/**
 * Drawing tools that place everything relative to one floor point.
 * - Each part is built at its cell's centre with one of these.
 */
export function penAt(origin: Plane, projection: Projection) {
  const [originX, originY] = origin;
  const moved = (plan: Plan): Plan => ({ ...plan, x: plan.x + originX, y: plan.y + originY });
  const floor = (pointX: number, pointY: number): Plane => [originX + pointX, originY + pointY];
  const world = ([pointX, pointY, height]: Point3): Point3 => [originX + pointX, originY + pointY, height];
  const axisOrigin = (axis: Axis) => (axis === "y" ? originY : originX);
  return {
    projection,
    world,
    point: (at: Point3): Flat => iso(world(at), projection),
    points: (list: Point3[]): Flat[] => pointsAt(list.map(world), projection),
    depth: (at: Point3) => depthOf(world(at), projection),
    slab: (plan: Plan, bottom: number, height: number, steps = 3, bevel = 0) => slabOf(moved(plan), bottom, height, projection, steps, bevel),
    cylinder: (centreX: number, centreY: number, radius: number, bottom: number, height: number, steps = 24, bevel = 0) => cylinder(originX + centreX, originY + centreY, radius, bottom, height, projection, steps, bevel),
    ring: (centreX: number, centreY: number, radius: number, height: number, steps = 28) => ring(originX + centreX, originY + centreY, radius, height, projection, steps),
    planOutline: (plan: Plan, height: number, steps = 3) => planOutline(moved(plan), height, projection, steps),
    sideSeam: (plan: Plan, height: number, steps = 3) => sideSeam(moved(plan), height, projection, steps),
    sideArc: (centreX: number, centreY: number, radius: number, height: number, steps = 18) => sideArc(originX + centreX, originY + centreY, radius, height, projection, steps),
    knurl: (centreX: number, centreY: number, radius: number, bottom: number, top: number, count: number) => knurl(originX + centreX, originY + centreY, radius, bottom, top, count, projection),
    onTop: (list: Plane[], height: number, closed = false) => onTop(list.map(([pointX, pointY]) => floor(pointX, pointY)), height, projection, closed),
    lineOnTop: (from: Plane, to: Plane, height: number) => lineOnTop(floor(...from), floor(...to), height, projection),
    segment: (from: Point3, to: Point3) => segment(world(from), world(to), projection),
    path: (list: Point3[], closed = false) => pathOf(list.map((at) => iso(world(at), projection)), closed),
    radialTicks: (centreX: number, centreY: number, radius: number, count: number, every: number, height: number, lengths: [number, number], from = 0, span = Math.PI * 2) =>
      radialTicks(originX + centreX, originY + centreY, radius, count, every, height, lengths, projection, from, span),
    along: (profile: Profile, axis: Axis, from: number, to: number) =>
      extrudeAlong(shiftProfile(profile, axis, origin), axis, from + axisOrigin(axis), to + axisOrigin(axis), projection),
    circleOnTop: (centreX: number, centreY: number, radius: number, height: number, steps = 28) => onTop(circleRing(originX + centreX, originY + centreY, radius, steps), height, projection, true),
  };
}

export type Pen = ReturnType<typeof penAt>;

function shiftProfile(profile: Profile, axis: Axis, [originX, originY]: Plane): Profile {
  const shift = axis === "y" ? originX : originY;
  return profile.map(([across, height]) => [across + shift, height]);
}

/** A closed rectangle on a vertical face: a screen, a slot or a plate. */
export function faceRect(pen: Pen, face: { axis: Axis; at: number }, from: number, to: number, bottom: number, top: number): string {
  const corner = (across: number, height: number): Point3 => (face.axis === "y" ? [across, face.at, height] : [face.at, across, height]);
  return pen.path([corner(from, bottom), corner(to, bottom), corner(to, top), corner(from, top)], true);
}

/** A circle on a vertical face, centred at (across, height). */
export function faceCircle(pen: Pen, face: { axis: Axis; at: number }, across: number, height: number, radius: number, steps = 24): string {
  const pointAt = (step: number): Point3 => {
    const angle = (step / steps) * Math.PI * 2;
    const sideways = across + radius * Math.cos(angle);
    const up = height + radius * Math.sin(angle);
    return face.axis === "y" ? [sideways, face.at, up] : [face.at, sideways, up];
  };
  return pen.path(Array.from({ length: steps }, (_unused, step) => pointAt(step)), true);
}

/** The near half of a cylinder wall between two heights, as one closed shape. */
export function frontBand(pen: Pen, centreX: number, centreY: number, radius: number, bottom: number, top: number, steps = 20): string {
  const facing = Math.atan2(cameraOf(pen.projection).sinA, cameraOf(pen.projection).cosA);
  const arc = (height: number): Point3[] => Array.from({ length: steps + 1 }, (_unused, step) => {
    const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
    return [centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle), height];
  });
  return pen.path([...arc(top), ...arc(bottom).reverse()], true);
}

/** Screen radius of a ball of this world radius. */
export function ballRadius(radius: number, projection: Projection): number {
  return radius * cameraOf(projection).k;
}
