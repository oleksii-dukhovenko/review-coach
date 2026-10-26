import type { PartKind, PartLook } from "../../../server/sceneSchema.ts";
import type { Plan, Plane, Point3, Projection } from "./kit/iso-kit.ts";
import {
  ball, ballRadius, circleProfile, dots, faceCircle, faceRect, frontBand, heavyLine, line, patch, penAt, seamed, solid,
  type Ink, type Pen, type Piece,
} from "./pieces.ts";

/**
 * The settings a part is drawn with in one step.
 * - `isNew` is painted by the frame, as the whole part's ink.
 */
export type Look = Pick<PartLook, "light" | "open" | "level" | "count" | "isNew">;

type Builder = (pen: Pen, look: Look) => Piece[];

/** How far the drawer slides out when open. */
const DRAWER_PULL = 9;

const FRONT = { axis: "y", at: 0 } as const;
const faceY = (at: number) => ({ ...FRONT, at });
const faceX = (at: number) => ({ axis: "x" as const, at });

function isLit(light: Look["light"]): light is "green" | "red" {
  return light === "green" || light === "red";
}

function lampInk(light: Look["light"]): Ink {
  return isLit(light) ? light : "off";
}

/** A floor point on a circle round the part's centre, at a height. */
function onCircle(radius: number, degrees: number, height: number): Point3 {
  const angle = (degrees * Math.PI) / 180;
  return [radius * Math.cos(angle), radius * Math.sin(angle), height];
}

function haloUnder(pen: Pen, plan: Plan): Piece {
  return { kind: "halo", path: pen.slab(plan, 0, 1).fill };
}

function screwsAt(pen: Pen, spots: Point3[]): Piece[] {
  return [dots(pen.points(spots), "mid", 0.6)];
}

/** A lamp lens: tinted by its light, with a soft glow when lit. */
function lens(pen: Pen, light: Look["light"], at: Point3, radius: number, height: number): Piece[] {
  const ink = lampInk(light);
  const glass = { ...solid(pen.cylinder(at[0], at[1], radius, at[2], height, 28), "hi", "lo", ink), lit: ink !== "off" };
  const ribs = line([1, 2].map((rib) => pen.sideArc(at[0], at[1], radius, at[2] + (height * rib) / 3)).join(""), "faint");
  const glow = { kind: "glow" as const, center: pen.point([at[0], at[1], at[2] + height / 2]), radius: radius * 2.6, ink };
  return ink === "off" ? [glass, ribs] : [glow, glass, ribs];
}

// - Cabinet: a terminal or server tower.

const CABINET: Plan = { x: -12, y: -10, w: 24, d: 20, r: 1.2 };

function cabinetBody(pen: Pen): Piece[] {
  const seams = [6, 29].map((height) => pen.sideSeam(CABINET, height)).join("");
  return [
    solid(pen.slab({ x: -14, y: -12, w: 28, d: 24, r: 1.6 }, 0, 2.4), "lo"),
    ...screwsAt(pen, [[13, 11, 2.4], [-13, 11, 2.4], [13, -11, 2.4]]),
    seamed(pen.slab(CABINET, 2.4, 30, 3, 0.6), "mid", seams),
    solid(pen.slab({ x: -12.6, y: -10.6, w: 25.2, d: 21.2, r: 1.4 }, 32.4, 1.6, 3, 0.4), "mid"),
    ...screwsAt(pen, [[11, 9, 34], [-11, 9, 34], [11, -9, 34], [-11, -9, 34]]),
  ];
}

/** The screen shows the log; its last line takes the lamp's colour. */
function cabinetScreen(pen: Pen, light: Look["light"]): Piece[] {
  const face = faceY(10);
  const logLine = (height: number, end: number) => pen.segment([-7.4, 10, height], [end, 10, height]);
  const lastTone = isLit(light) ? light : "faint";
  return [
    line(faceRect(pen, face, -10, 8, 15.6, 29), "faint"),
    patch(faceRect(pen, face, -9, 7, 16.6, 28), "cavity", "lo"),
    line([logLine(26, 3), logLine(24, 5), logLine(22, 0)].join(""), "lo", true),
    heavyLine(logLine(19.4, 4.6), lastTone),
    patch(faceRect(pen, face, -9, 1, 11.8, 13), "cavity", "lo"),
    dots(pen.points([[4.4, 10, 12.4], [6.6, 10, 12.4]]), "hi", 0.75),
    line(faceRect(pen, face, -6, 6, 5, 8.4), "faint"),
    ...screwsAt(pen, [[-4.8, 10, 6.7], [4.8, 10, 6.7]]),
  ];
}

function cabinetVents(pen: Pen): Piece[] {
  const slots = [24, 21.6, 19.2, 16.8, 14.4].map((height) => faceRect(pen, faceX(12), -6.5, 6.5, height, height + 1));
  return [line(slots.join(""), "lo")];
}

function cabinetLamp(pen: Pen, light: Look["light"]): Piece[] {
  return [
    solid(pen.cylinder(-6, -5, 1.6, 34, 1.6, 16), "lo"),
    solid(pen.cylinder(5, -3, 3.4, 34, 1.2, 28), "mid"),
    ...lens(pen, light, [5, -3, 35.2], 2.8, 3.4),
    solid(pen.cylinder(5, -3, 3, 38.6, 0.8, 28), "mid"),
  ];
}

const cabinet: Builder = (pen, look) => [
  haloUnder(pen, { x: -14, y: -12, w: 28, d: 24, r: 2 }),
  ...cabinetBody(pen),
  ...cabinetScreen(pen, look.light),
  ...cabinetVents(pen),
  ...cabinetLamp(pen, look.light),
];

// - Light: a signal lamp on a post.

function lampBase(pen: Pen): Piece[] {
  const screwSpots = [45, 135, 315].map((degrees) => onCircle(7, degrees, 2.6));
  return [
    solid(pen.cylinder(0, 0, 9, 0, 2.6, 36), "lo"),
    line(pen.ring(0, 0, 4.6, 2.6), "faint"),
    ...screwsAt(pen, screwSpots),
    solid(pen.cylinder(5.4, 5.4, 1.4, 2.6, 1.4, 14), "lo"),
  ];
}

const light: Builder = (pen, look) => [
  haloUnder(pen, { x: -9, y: -9, w: 18, d: 18, r: 9 }),
  ...lampBase(pen),
  seamed(pen.cylinder(0, 0, 2.4, 2.6, 15, 20), "mid", [8.6, 13].map((height) => pen.sideArc(0, 0, 2.4, height)).join("")),
  solid(pen.cylinder(0, 0, 5, 17.6, 2.2, 32, 0.4), "mid"),
  ...lens(pen, look.light, [0, 0, 19.8], 4.4, 9),
  solid(pen.cylinder(0, 0, 5, 28.8, 2, 32, 0.4), "mid"),
  solid(pen.cylinder(0, 0, 1.8, 30.8, 1.4, 16), "mid"),
];

// - Drawer: a filing cabinet whose top drawer holds cards.

const DRAWER_FRONT_Y = 11;

function drawerFront(pen: Pen, bottom: number, pull: number): Piece[] {
  const front = DRAWER_FRONT_Y + pull + 1.2;
  return [
    solid(pen.slab({ x: -11.5, y: DRAWER_FRONT_Y + pull, w: 23, d: 1.2, r: 0.4 }, bottom, 10.4, 2, 0.3), "mid"),
    patch(faceRect(pen, faceY(front), -3, 3, bottom + 7.4, bottom + 9.4), "face", "lo"),
    ...screwsAt(pen, [[-3.8, front, bottom + 8.4], [3.8, front, bottom + 8.4]]),
    solid(pen.slab({ x: -4.5, y: front, w: 9, d: 1.4, r: 0.6 }, bottom + 4.4, 1.2, 2), "hi"),
  ];
}

/** The pulled-out drawer: a box with cards standing in it. */
function openDrawer(pen: Pen, bottom: number, count: number): Piece[] {
  const box: Plan = { x: -11, y: DRAWER_FRONT_Y - 20 + DRAWER_PULL, w: 22, d: 20, r: 0.6 };
  const cards = Array.from({ length: count }, (_unused, index) =>
    solid(pen.slab({ x: -8, y: box.y + 4 + index * 3, w: 16, d: 0.8, r: 0.3 }, bottom + 1.6, 10.2, 2), "hi", "none"));
  return [
    patch(faceRect(pen, faceY(DRAWER_FRONT_Y), -11.5, 11.5, bottom, bottom + 10.4), "cavity", "lo"),
    solid(pen.slab(box, bottom + 0.6, 8.6, 2), "mid"),
    patch(pen.planOutline({ ...box, x: box.x + 1.2, y: box.y + 1.2, w: box.w - 2.4, d: box.d - 2.4 }, bottom + 9.2, 2), "cavity", "lo"),
    ...cards,
    ...drawerFront(pen, bottom, DRAWER_PULL),
  ];
}

const drawer: Builder = (pen, look) => [
  haloUnder(pen, { x: -14, y: -12, w: 28, d: 24, r: 2 }),
  solid(pen.slab({ x: -14, y: -12, w: 28, d: 24, r: 1.6 }, 0, 2.4), "lo"),
  seamed(pen.slab({ x: -13, y: -11, w: 26, d: 22, r: 1 }, 2.4, 26, 3, 0.6), "mid", pen.sideSeam({ x: -13, y: -11, w: 26, d: 22, r: 1 }, 15.4)),
  solid(pen.slab({ x: -13.6, y: -11.6, w: 27.2, d: 23.2, r: 1.2 }, 28.4, 1.6, 3, 0.4), "mid"),
  ...drawerFront(pen, 4, 0),
  ...(look.open ? openDrawer(pen, 16.4, look.count ?? 0) : drawerFront(pen, 16.4, 0)),
];

// - Card: a record card standing in a holder.

function cardText(pen: Pen): Piece[] {
  const rule = (height: number, end: number) => pen.segment([-8, 0.95, height], [end, 0.95, height]);
  return [
    heavyLine(rule(21.8, 1), "mid"),
    line([rule(18.6, 6.4), rule(16.2, 7.6), rule(13.8, 4), rule(11.4, 7), rule(9, 5)].join(""), "lo", true),
    line(faceRect(pen, faceY(0.95), 4, 8, 19.6, 23.4), "faint"),
  ];
}

const card: Builder = (pen) => [
  haloUnder(pen, { x: -12, y: -6, w: 24, d: 12, r: 2 }),
  solid(pen.slab({ x: -12, y: -6, w: 24, d: 12, r: 1.6 }, 0, 3.6, 3, 0.5), "lo"),
  patch(pen.onTop([[-10.5, -1.4], [10.5, -1.4], [10.5, 1.4], [-10.5, 1.4]], 3.6, true), "cavity", "lo"),
  ...screwsAt(pen, [[-10.2, 4.2, 3.6], [10.2, 4.2, 3.6]]),
  solid(pen.slab({ x: -8, y: -1.2, w: 19, d: 0.8, r: 0.3 }, 3.6, 22.4, 2), "mid"),
  solid(pen.slab({ x: 4, y: -1.2, w: 5, d: 0.8, r: 0.3 }, 26, 2.6, 2), "mid"),
  solid(pen.slab({ x: -10, y: 0, w: 20, d: 0.9, r: 0.3 }, 3.6, 22, 2), "hi"),
  ...cardText(pen),
];

// - Probe: a checker on a stand, touching a test block.

function probeStand(pen: Pen): Piece[] {
  const corners: Point3[] = [[-10, -10, 3], [10, -10, 3], [-10, 10, 3], [10, 10, 3]];
  return [
    solid(pen.slab({ x: -12, y: -12, w: 24, d: 24, r: 1.6 }, 0, 3, 3, 0.6), "lo"),
    line([pen.planOutline({ x: -9.8, y: -9.8, w: 19.6, d: 19.6, r: 0.6 }, 3), ...corners.map(([screwX, screwY]) => pen.ring(screwX, screwY, 1.1, 3, 12))].join(""), "faint"),
    ...screwsAt(pen, corners),
    solid(pen.cylinder(-7, 0, 3.4, 3, 2, 24), "mid"),
    seamed(pen.cylinder(-7, 0, 2, 5, 28, 18), "mid", [14, 21].map((height) => pen.sideArc(-7, 0, 2, height)).join("")),
    solid(pen.cylinder(-7, 0, 2.4, 33, 1.2, 18), "mid"),
  ];
}

function probeHead(pen: Pen): Piece[] {
  return [
    solid(pen.slab({ x: -10.4, y: -3.4, w: 6.8, d: 6.8, r: 0.8 }, 24, 6, 2, 0.4), "mid"),
    solid(pen.along(circleProfile(-7, 27, 1.5, 18), "y", 3.4, 6), "mid"),
    solid(pen.slab({ x: 1, y: -5, w: 10, d: 10, r: 0.8 }, 3, 3, 2, 0.4), "mid"),
    line(pen.ring(6, 0, 2.8, 6, 20), "faint"),
    solid(pen.slab({ x: -3.6, y: -1.6, w: 9.6, d: 3.2, r: 0.6 }, 26, 3.2, 2, 0.3), "mid"),
    solid(pen.cylinder(6, 0, 1, 8.6, 10, 12), "mid"),
    solid(pen.cylinder(6, 0, 2, 6, 2.6, 18), "hi", "lo"),
    seamed(pen.cylinder(6, 0, 3.6, 18, 12, 28), "hi", [22, 26].map((height) => pen.sideArc(6, 0, 3.6, height)).join("")),
    solid(pen.cylinder(6, 0, 4.2, 18, 1.6, 28), "mid"),
    solid(pen.cylinder(6, 0, 4.2, 30, 1.4, 28, 0.3), "mid"),
  ];
}

const probe: Builder = (pen) => [haloUnder(pen, { x: -12, y: -12, w: 24, d: 24, r: 2 }), ...probeStand(pen), ...probeHead(pen)];

// - Gauge: a dial gauge on a stand.

const GAUGE_START = -0.75 * Math.PI;
const GAUGE_SPAN = 1.5 * Math.PI;

function dialArc(pen: Pen, from: number, to: number, radius: number, top: number): string {
  const steps = 16;
  const points = Array.from({ length: steps + 1 }, (_unused, step): Plane => {
    const angle = GAUGE_START + GAUGE_SPAN * (from + ((to - from) * step) / steps);
    return [Math.sin(angle) * radius, -Math.cos(angle) * radius];
  });
  return pen.onTop(points, top);
}

function needle(pen: Pen, level: number, top: number): string {
  const angle = GAUGE_START + GAUGE_SPAN * level;
  const towards = (radius: number): Plane => [Math.sin(angle) * radius, -Math.cos(angle) * radius];
  return pen.lineOnTop(towards(-2), towards(7.4), top);
}

function gaugeFace(pen: Pen, level: number): Piece[] {
  const top = 12;
  const ticks = pen.radialTicks(0, 0, 8.2, 20, 5, top, [1, 2], GAUGE_START, GAUGE_SPAN);
  return [
    line(pen.ring(0, 0, 9.6, top, 48), "lo"),
    line(pen.ring(0, 0, 8.4, top, 48), "faint"),
    line(ticks.minor, "lo"),
    line(ticks.major, "mid"),
    heavyLine(dialArc(pen, 0, 0.7, 6.4, top), "green"),
    heavyLine(dialArc(pen, 0.82, 1, 6.4, top), "red"),
    heavyLine(needle(pen, level, top + 0.1), "lit"),
    dots(pen.points([[0, 0, top + 0.1]]), "hi", 0.9),
  ];
}

const gauge: Builder = (pen, look) => [
  haloUnder(pen, { x: -11, y: -10, w: 22, d: 20, r: 2 }),
  seamed(pen.slab({ x: -11, y: -10, w: 22, d: 20, r: 1.4 }, 0, 7, 3, 0.6), "mid", pen.sideSeam({ x: -11, y: -10, w: 22, d: 20, r: 1.4 }, 1.6)),
  line(faceRect(pen, faceY(10), -6, 6, 2.6, 5.2), "faint"),
  ...screwsAt(pen, [[9.4, 8.4, 7], [-9.4, 8.4, 7], [9.4, -8.4, 7], [-5, 10, 3.9], [5, 10, 3.9]]),
  solid(pen.along(circleProfile(0, 9.6, 1.4, 16), "x", 9.6, 12.4), "mid"),
  solid(pen.along(circleProfile(0, 9.6, 2, 18), "x", 12.4, 13.8), "mid"),
  seamed(pen.cylinder(0, 0, 10.5, 7, 5, 48), "hi", pen.sideArc(0, 0, 10.5, 9.6, 30)),
  line(pen.knurl(0, 0, 10.5, 9.6, 12, 44), "lo"),
  ...gaugeFace(pen, look.level ?? 0),
];

// - Lock: a padlock on a hasp plate; open lifts the shackle.

function shackleProfile(isOpen: boolean): Plane[] {
  const lift = isOpen ? 4.5 : 0;
  const centre = 22.4 + lift;
  const arc = (radius: number, from: number, to: number): Plane[] =>
    Array.from({ length: 13 }, (_unused, step) => {
      const angle = from + ((to - from) * step) / 12;
      return [radius * Math.cos(angle), centre + radius * Math.sin(angle)];
    });
  return [[3.6, 16.4], [6.2, 16.4], ...arc(6.2, 0, Math.PI), [-6.2, 16.4 + lift], [-3.6, 16.4 + lift], ...arc(3.6, Math.PI, 0)];
}

const LOCK_BODY: Plan = { x: -8, y: -3.6, w: 16, d: 7.2, r: 1.6 };

const lock: Builder = (pen, look) => [
  haloUnder(pen, { x: -11, y: -8, w: 22, d: 16, r: 2 }),
  solid(pen.slab({ x: -11, y: -8, w: 22, d: 16, r: 1.4 }, 0, 2.4, 3, 0.4), "lo"),
  line([[-9.2, -6.2], [9.2, -6.2], [-9.2, 6.2], [9.2, 6.2]].map(([screwX, screwY]) => pen.ring(screwX!, screwY!, 1.1, 2.4, 12)).join(""), "faint"),
  ...screwsAt(pen, [[-9.2, -6.2, 2.4], [9.2, -6.2, 2.4], [-9.2, 6.2, 2.4], [9.2, 6.2, 2.4]]),
  seamed(pen.slab(LOCK_BODY, 2.4, 14, 4, 0.6), "mid", [5.4, 13.6].map((height) => pen.sideSeam(LOCK_BODY, height, 4)).join("")),
  patch(faceCircle(pen, faceY(3.6), 0, 9.8, 1.3, 16), "cavity", "lo"),
  patch(faceRect(pen, faceY(3.6), -0.5, 0.5, 6.6, 9), "cavity", "lo"),
  solid(pen.along(shackleProfile(Boolean(look.open)), "y", -1.3, 1.3), "hi", "lo"),
];

// - Lever: a switch whose handle tilts back (off) or forward (on).

const PIVOT_HEIGHT = 7.2;

function handleProfile(level: number): Plane[] {
  const angle = ((level - 0.5) * 70 * Math.PI) / 180;
  const along: Plane = [Math.sin(angle), Math.cos(angle)];
  const across: Plane = [along[1] * 1.1, -along[0] * 1.1];
  const at = (reach: number, side: number): Plane => [along[0] * reach + across[0] * side, PIVOT_HEIGHT + along[1] * reach + across[1] * side];
  return [at(-1.4, 1), at(-1.4, -1), at(15, -1), at(15, 1)];
}

function leverKnob(pen: Pen, level: number): Piece {
  const angle = ((level - 0.5) * 70 * Math.PI) / 180;
  const tip: Plane = [Math.sin(angle) * 16.2, PIVOT_HEIGHT + Math.cos(angle) * 16.2];
  return solid(pen.along(circleProfile(tip[0], tip[1], 2.4, 22), "x", -2.4, 2.4), "hi", "lo");
}

const lever: Builder = (pen, look) => [
  haloUnder(pen, { x: -11, y: -8, w: 22, d: 16, r: 2 }),
  solid(pen.slab({ x: -11, y: -8, w: 22, d: 16, r: 1.4 }, 0, 1.6), "lo"),
  solid(pen.slab({ x: -9, y: -6.4, w: 18, d: 12.8, r: 1.2 }, 1.6, 4.6, 3, 0.5), "mid"),
  patch(pen.onTop([[-1.8, -5], [1.8, -5], [1.8, 5], [-1.8, 5]], 6.2, true), "cavity", "lo"),
  line(pen.ring(5.4, -4, 1.1, 6.2, 14), "mid"),
  dots(pen.points([[5.4, 4, 6.2]]), "hi", 0.9),
  ...screwsAt(pen, [[-7.4, -4.8, 6.2], [-7.4, 4.8, 6.2]]),
  solid(pen.along(circleProfile(0, PIVOT_HEIGHT, 1.3, 16), "x", -3.4, -1.3), "mid"),
  solid(pen.along(handleProfile(look.level ?? 0), "x", -1.2, 1.2), "mid"),
  solid(pen.along(circleProfile(0, PIVOT_HEIGHT, 1.3, 16), "x", 1.3, 3.4), "mid"),
  leverKnob(pen, look.level ?? 0),
];

// - Conveyor: a short belt carrying parcels.

function conveyorFrame(pen: Pen, back: number): Piece {
  return solid(pen.slab({ x: -18, y: back, w: 36, d: 2, r: 0.6 }, 7.2, 4, 2, 0.3), "mid");
}

function frameTicks(pen: Pen): Piece[] {
  const marks = Array.from({ length: 17 }, (_unused, index) => -16 + index * 2);
  const tick = (along: number, index: number) => pen.segment([along, 7, 11.2], [along, 7, index % 4 === 0 ? 9 : 10]);
  return [
    line(marks.filter((_unused, index) => index % 4 !== 0).map(tick).join(""), "lo"),
    line(marks.map((along, index) => (index % 4 === 0 ? tick(along, index) : "")).join(""), "mid"),
  ];
}

function parcels(pen: Pen, count: number): Piece[] {
  return Array.from({ length: count }, (_unused, index) => {
    const left = -15.4 + index * 6.4;
    return [
      solid(pen.slab({ x: left, y: -3.2, w: 4.6, d: 6.4, r: 0.4 }, 10, 4.2, 2, 0.3), "hi"),
      line(pen.lineOnTop([left + 2.3, -3.2], [left + 2.3, 3.2], 14.2), "faint"),
    ];
  }).flat();
}

function conveyorMotor(pen: Pen): Piece[] {
  const vents = [5, 6.6].map((height) => faceRect(pen, faceY(10.6), 13, 17, height, height + 0.8));
  return [solid(pen.slab({ x: 12, y: 7, w: 6, d: 3.6, r: 0.6 }, 3, 6, 2, 0.3), "mid"), line(vents.join(""), "lo")];
}

const conveyor: Builder = (pen, look) => [
  haloUnder(pen, { x: -18, y: -7, w: 36, d: 14, r: 2 }),
  ...[[-15, -5.6], [15, -5.6], [-15, 3.6], [15, 3.6]].map(([legX, legY]) => solid(pen.slab({ x: legX! - 1, y: legY!, w: 2, d: 2, r: 0.4 }, 0, 7.2, 2), "lo")),
  conveyorFrame(pen, -7),
  solid(pen.slab({ x: -17, y: -5, w: 34, d: 10, r: 1 }, 8.2, 1.8, 3), "lo", "none"),
  line(Array.from({ length: 13 }, (_unused, index) => pen.lineOnTop([-15 + index * 2.5, -5], [-15 + index * 2.5, 5], 10)).join(""), "faint"),
  ...parcels(pen, look.count ?? 0),
  conveyorFrame(pen, 5),
  ...frameTicks(pen),
  line([faceCircle(pen, faceY(7), -16.4, 9.2, 1.2, 14), faceCircle(pen, faceY(7), 16.4, 9.2, 1.2, 14)].join(""), "lo"),
  dots(pen.points([[-16.4, 7, 9.2], [16.4, 7, 9.2]]), "hi", 0.6),
  ...conveyorMotor(pen),
];

// - Press: a stamp press over a stack of sheets.

function pressSheets(pen: Pen, count: number): Piece[] {
  return Array.from({ length: count }, (_unused, index) => solid(pen.slab({ x: -4.6, y: -0.8, w: 9.2, d: 7.6, r: 0.3 }, 6.4 + index * 1.1, 0.8, 2), "hi", "none"));
}

function handwheel(pen: Pen): Piece[] {
  const spokeEnd = (radius: number, degrees: number): Plane => {
    const [across, deep] = onCircle(radius, degrees, 0);
    return [across, deep - 2.3];
  };
  const spokes = [0, 120, 240].map((degrees) => pen.lineOnTop(spokeEnd(1.6, degrees), spokeEnd(5.6, degrees), 42));
  return [
    solid(pen.cylinder(0, -2.3, 1.6, 40, 2, 16), "mid"),
    line(spokes.join(""), "mid"),
    line(pen.ring(0, -2.3, 5.6, 42, 36), "mid"),
    line(pen.ring(0, -2.3, 6.4, 42, 36), "lo"),
    solid(pen.cylinder(6, -2.3, 0.9, 42, 2.6, 12), "hi"),
  ];
}

const press: Builder = (pen, look) => [
  haloUnder(pen, { x: -12, y: -11, w: 24, d: 22, r: 2 }),
  solid(pen.slab({ x: -12, y: -11, w: 24, d: 22, r: 1.6 }, 0, 4, 3, 0.6), "lo"),
  ...screwsAt(pen, [[10.4, 9.4, 4], [-10.4, 9.4, 4], [10.4, -9.4, 4]]),
  seamed(pen.slab({ x: -5, y: -10, w: 10, d: 6, r: 0.8 }, 4, 30, 2, 0.4), "mid", pen.sideSeam({ x: -5, y: -10, w: 10, d: 6, r: 0.8 }, 30, 2)),
  solid(pen.slab({ x: -7, y: -3, w: 14, d: 12, r: 0.8 }, 4, 2.4, 2, 0.3), "mid"),
  line([pen.lineOnTop([-7, 0.6], [7, 0.6], 6.4), pen.lineOnTop([-7, 5.4], [7, 5.4], 6.4)].join(""), "faint"),
  ...pressSheets(pen, look.count ?? 0),
  solid(pen.slab({ x: -4.4, y: -1.2, w: 8.8, d: 8.4, r: 0.6 }, 15, 4, 2, 0.4), "hi", "lo"),
  seamed(pen.cylinder(0, 3, 2.4, 19, 15, 20), "mid", pen.sideArc(0, 3, 2.4, 24)),
  solid(pen.slab({ x: -6, y: -10.6, w: 12, d: 16.6, r: 1 }, 34, 6, 3, 0.5), "mid"),
  ...screwsAt(pen, [[-4.4, 4.4, 40], [4.4, 4.4, 40]]),
  ...handwheel(pen),
];

// - Bin: a waste bin holding crumpled paper.

const PAPER_SPOTS: Plane[] = [[-3, -2.4], [3.2, -3], [0, 2.6], [-4.6, 2.6], [4.6, 1.8]];

function crumpled(pen: Pen, count: number): Piece[] {
  const radius = ballRadius(2.4, pen.projection);
  return PAPER_SPOTS.slice(0, count).map(([spotX, spotY]) => ball(pen.point([spotX, spotY, 22.2]), radius, "hi"));
}

const bin: Builder = (pen, look) => [
  haloUnder(pen, { x: -9.4, y: -9.4, w: 18.8, d: 18.8, r: 9.4 }),
  solid(pen.cylinder(0, 0, 9.4, 0, 1.4, 40), "lo"),
  seamed(pen.cylinder(0, 0, 9, 1.4, 18, 40), "mid", pen.sideArc(0, 0, 9, 4.2, 30)),
  line(pen.knurl(0, 0, 9, 4.2, 19.4, 26), "lo"),
  solid(pen.cylinder(0, 0, 9.8, 19.4, 1.8, 40), "mid", "lo"),
  patch(pen.circleOnTop(0, 0, 8.4, 21.2, 40), "cavity", "lo"),
  ...crumpled(pen, look.count ?? 0),
  patch(frontBand(pen, 0, 0, 9.8, 19.4, 21.2, 24), "side", "mid"),
  line(pen.sideArc(0, 0, 8.4, 21.2, 24), "lo"),
  solid(pen.slab({ x: -3, y: 9, w: 6, d: 3.2, r: 0.8 }, 0.4, 1.4, 2), "mid"),
];

// - Clock: an alarm clock whose hand sweeps once round.

function clockHands(pen: Pen, level: number): Piece[] {
  const face = 4.05;
  const toward = (angle: number, radius: number): Point3 => [Math.sin(angle) * radius, face, 14 + Math.cos(angle) * radius];
  const hourAngle = (-60 * Math.PI) / 180;
  return [
    heavyLine(pen.segment(toward(0, 0), toward(hourAngle, 4.6)), "hi"),
    heavyLine(pen.segment(toward(level * Math.PI * 2 + Math.PI, 1.6), toward(level * Math.PI * 2, 7)), "lit"),
    dots(pen.points([toward(0, 0)]), "hi", 0.9),
  ];
}

function clockFace(pen: Pen): Piece[] {
  const tick = (hour: number) => {
    const angle = (hour / 12) * Math.PI * 2;
    const inner = hour % 3 === 0 ? 6.2 : 7.2;
    return pen.segment([Math.sin(angle) * inner, 4.05, 14 + Math.cos(angle) * inner], [Math.sin(angle) * 8.2, 4.05, 14 + Math.cos(angle) * 8.2]);
  };
  const hours = Array.from({ length: 12 }, (_unused, hour) => hour);
  return [
    patch(faceCircle(pen, faceY(4.05), 0, 14, 9.6, 40), "dial", "lo"),
    line(faceCircle(pen, faceY(4.05), 0, 14, 8.6, 40), "faint"),
    line(hours.filter((hour) => hour % 3 !== 0).map(tick).join(""), "lo"),
    line(hours.filter((hour) => hour % 3 === 0).map(tick).join(""), "mid"),
  ];
}

function clockBells(pen: Pen): Piece[] {
  const radius = ballRadius(3.4, pen.projection);
  return [
    solid(pen.slab({ x: -0.6, y: -1.6, w: 1.2, d: 1.2, r: 0.4 }, 24.6, 3.4, 2), "mid"),
    ball(pen.point([0, -1, 28.4]), ballRadius(1, pen.projection), "mid"),
    ball(pen.point([-6.6, -1.6, 26]), radius, "mid"),
    ball(pen.point([6.6, -1.6, 26]), radius, "mid"),
  ];
}

const clock: Builder = (pen, look) => [
  haloUnder(pen, { x: -10, y: -5, w: 20, d: 10, r: 4 }),
  solid(pen.cylinder(-6.4, 0, 1.6, 0, 3.4, 16), "lo"),
  solid(pen.cylinder(6.4, 0, 1.6, 0, 3.4, 16), "lo"),
  solid(pen.along(circleProfile(3.4, 14, 1.2, 14), "y", -6.4, -4), "lo"),
  ...clockBells(pen),
  solid(pen.along(circleProfile(0, 14, 11, 44), "y", -4, 4), "mid"),
  ...clockFace(pen),
  ...clockHands(pen, look.level ?? 0),
];

const BUILDERS: Record<PartKind, Builder> = {
  cabinet, light, drawer, card, probe, gauge, lock, conveyor, lever, press, bin, clock,
};

/** The pieces of one part standing at a floor point, bottom to top. */
export function buildPart(kind: PartKind, at: Plane, look: Look, projection: Projection): Piece[] {
  return BUILDERS[kind](penAt(at, projection), look);
}
