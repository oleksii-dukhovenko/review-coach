import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type { Frame, FrameLink, FramePart } from "./frame.ts";
import { labelLines } from "./layout.ts";
import type { BallPiece, Ink, Piece, SolidPiece } from "./pieces.ts";

const tenth = (value: number) => Math.round(value * 10) / 10;

const inkAttribute = (ink: Ink | undefined) => (ink && ink !== "plain" ? ink : undefined);

function SolidView({ piece }: { piece: SolidPiece }) {
  const { paths, tone, crease } = piece;
  const hasCrease = crease !== "none";
  return (
    <g className="iso-solid" data-lit={piece.lit ? "" : undefined} data-ink={inkAttribute(piece.ink)}>
      <path className="iso-fill" d={paths.fill} />
      {paths.shades.map((shadePath, shade) => (shadePath ? <path key={shade} className="iso-shade" data-shade={shade} d={shadePath} /> : null))}
      <path className="iso-top" d={paths.top} />
      {hasCrease && paths.crease ? <path className="iso-line iso-crease" data-tone={crease} d={paths.crease} /> : null}
      {hasCrease && paths.bevel ? <path className="iso-line iso-bevel" data-tone={crease} d={paths.bevel} /> : null}
      {piece.inner ? <path className="iso-line" data-tone="faint" d={piece.inner} /> : null}
      <path className="iso-line iso-edge" data-tone={tone} d={paths.outline} />
    </g>
  );
}

function BallView({ piece }: { piece: BallPiece }) {
  const [centreX, centreY] = piece.center;
  const radius = piece.radius;
  return (
    <g className="anatomy-ball" data-ink={inkAttribute(piece.ink)}>
      <circle className="anatomy-ball-body" cx={tenth(centreX)} cy={tenth(centreY)} r={tenth(radius)} />
      <circle className="anatomy-ball-shine" cx={tenth(centreX - radius * 0.3)} cy={tenth(centreY - radius * 0.32)} r={tenth(radius * 0.5)} />
      <circle className="iso-line iso-edge" data-tone={piece.tone} cx={tenth(centreX)} cy={tenth(centreY)} r={tenth(radius)} />
    </g>
  );
}

/** One piece of a part, drawn with the kit's classes. */
export function PieceView({ piece }: { piece: Piece }): ReactNode {
  switch (piece.kind) {
    case "solid": return <SolidView piece={piece} />;
    case "line": return <path className="iso-line" data-tone={piece.tone} data-free={piece.free ? "" : undefined} data-heavy={piece.heavy ? "" : undefined} d={piece.path} />;
    case "dots": return <g className="iso-dots" data-tone={piece.tone}>{piece.points.map(([dotX, dotY], index) => <circle key={index} cx={tenth(dotX)} cy={tenth(dotY)} r={piece.size} />)}</g>;
    case "patch": return <path className="anatomy-patch" data-fill={piece.fill} data-tone={piece.tone} data-ink={inkAttribute(piece.ink)} d={piece.path} />;
    case "ball": return <BallView piece={piece} />;
    case "glow": return <circle className="anatomy-glow" data-ink={piece.ink} cx={tenth(piece.center[0])} cy={tenth(piece.center[1])} r={tenth(piece.radius)} />;
    case "halo": return <path className="iso-halo" d={piece.path} />;
  }
}

function Pieces({ pieces }: { pieces: Piece[] }) {
  return <>{pieces.map((piece, index) => <PieceView key={index} piece={piece} />)}</>;
}

function LinkView({ link }: { link: FrameLink }) {
  return (
    <g className="anatomy-link" data-ink={inkAttribute(link.ink)} data-hidden={link.isHidden ? "" : undefined}>
      <Pieces pieces={link.pieces} />
    </g>
  );
}

/** What a part does when it is pointed at, clicked or focused. */
export type PartHandlers = {
  isClickable: (part: FramePart) => boolean;
  describe: (part: FramePart) => string;
  onPick?: (part: FramePart, element: Element) => void;
  // - Pointer or keyboard focus; null when it leaves.
  onPoint?: (part: FramePart | null) => void;
  // - Keyboard focus only.
  onFocus?: (part: FramePart) => void;
};

function isPickKey(event: KeyboardEvent<SVGGElement>): boolean {
  const isEnterOrSpace = event.key === "Enter" || event.key === " ";
  const hasCommandKey = event.ctrlKey || event.metaKey || event.altKey;
  return isEnterOrSpace && !hasCommandKey;
}

function pickOnKey(event: KeyboardEvent<SVGGElement>, pick: () => void) {
  if (isPickKey(event)) {
    event.preventDefault();
    pick();
  }
}

function isClickablePart(part: FramePart, handlers?: PartHandlers): boolean {
  const canClick = Boolean(handlers?.isClickable(part));
  return canClick && !part.isHidden;
}

/** Button props for a part that opens something; none otherwise. */
function clickProps(part: FramePart, handlers?: PartHandlers) {
  if (!isClickablePart(part, handlers)) return {};
  const pick = (element: Element) => handlers?.onPick?.(part, element);
  return {
    "data-clickable": "", tabIndex: 0, role: "button", "aria-label": handlers?.describe(part),
    onClick: (event: MouseEvent<SVGGElement>) => pick(event.currentTarget),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => pickOnKey(event, () => pick(event.currentTarget)),
  };
}

/** Tells the handlers when a part is pointed at or focused. */
function pointProps(part: FramePart, handlers?: PartHandlers) {
  const point = (pointed: FramePart | null) => handlers?.onPoint?.(pointed);
  const focus = () => {
    point(part);
    handlers?.onFocus?.(part);
  };
  return { onPointerEnter: () => point(part), onPointerLeave: () => point(null), onFocus: focus, onBlur: () => point(null) };
}

function PartView({ part, handlers }: { part: FramePart; handlers?: PartHandlers }) {
  return (
    <g
      className="anatomy-part" data-part={part.id} data-kind={part.kind} data-ink={inkAttribute(part.ink)}
      data-hidden={part.isHidden ? "" : undefined} {...clickProps(part, handlers)} {...pointProps(part, handlers)}
    >
      <Pieces pieces={part.pieces} />
    </g>
  );
}

function PartLabel({ part, size }: { part: FramePart; size: number }) {
  const [labelX, labelY] = part.labelAt;
  return (
    <text className="anatomy-label" data-part={part.id} data-hidden={part.isHidden ? "" : undefined} data-ink={inkAttribute(part.ink)} x={tenth(labelX)} y={tenth(labelY + size * 1.05)} fontSize={tenth(size)} textAnchor="middle">
      {labelLines(part.label).map((text, index) => <tspan key={index} x={tenth(labelX)} dy={index === 0 ? 0 : tenth(size * 1.15)}>{text}</tspan>)}
    </text>
  );
}

type DrawingProps = { frame: Frame; label: string; handlers?: PartHandlers; className?: string };

/**
 * One frame of an anatomy drawing.
 * - Base, floor links, then parts far to near.
 * - Floor labels last, over everything.
 */
export function Drawing({ frame, label, handlers, className }: DrawingProps) {
  return (
    <svg className={`iso-svg anatomy-svg ${className ?? ""}`} viewBox={frame.viewBox} role={handlers ? "group" : "img"} aria-label={label}>
      <g className="anatomy-base"><Pieces pieces={frame.base} /></g>
      {frame.links.map((link) => <LinkView key={link.id} link={link} />)}
      {frame.parts.map((part) => <PartView key={part.id} part={part} handlers={handlers} />)}
      <g className="anatomy-labels" aria-hidden="true">{frame.parts.map((part) => <PartLabel key={part.id} part={part} size={frame.labelSize} />)}</g>
    </svg>
  );
}
