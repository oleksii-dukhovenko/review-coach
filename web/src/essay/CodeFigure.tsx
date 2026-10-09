import { useEffect, useState } from "react";

import type { DiffFile, DiffLine } from "../api.ts";
import { linesInSpan, spanBetween, type LinePoint, type LineSpan } from "../../../server/anchors.ts";
import { commentFlags } from "../components/commentLines.ts";
import { isPeekClick, lineRefOf } from "../components/lineClicks.ts";
import { languageForFile, renderCodeLine } from "../components/highlight.ts";
import { Icon } from "../components/Icon.tsx";
import { OpenInNeovim } from "../components/OpenInNeovim.tsx";
import { PeekReferences } from "../components/PeekReferences.tsx";
import { wordAtClick } from "../components/wordAtPoint.ts";
import type { PlacedComment } from "../placeComments.ts";
import { Composer } from "./Composer.tsx";
import {
  anchorLine, firstShownLine, foldRows, isLineAt, isLineInRange, rangeOf, type Figure, type Footnote, type QuestionData, type ShownRow,
} from "./model.ts";
import { QuestionBlock } from "./QuestionBlock.tsx";
import type { ReviewSession } from "./session.ts";
import { splitShownRows, type SplitRow } from "./splitRows.ts";

// - Notes in the margin, and the one under the mouse.
export type FigureNotes = { footnotes: Footnote[]; hovered: number | null; onHover: (number: number | null) => void };

type FigureProps = {
  figure: Figure;
  diff: DiffFile;
  session: ReviewSession;
  notes?: FigureNotes;
  // - Questions open under the lines they ask about.
  showsQuestions?: boolean;
};

function footnoteCovering(line: DiffLine, props: FigureProps): number | undefined {
  return props.notes?.footnotes.find((footnote) => isLineInRange(line, rangeOf(footnote.note)))?.number;
}

function footnoteStartingAt(line: DiffLine, props: FigureProps): number | undefined {
  return props.notes?.footnotes.find((footnote) => firstShownLine(props.figure.lines, rangeOf(footnote.note)) === line)?.number;
}

function isAskedAbout(line: DiffLine, props: FigureProps): boolean {
  return props.showsQuestions === true && props.figure.questionsAfter.some((question) => isLineInRange(line, rangeOf(question)));
}

function questionsBelow(line: DiffLine, props: FigureProps): QuestionData[] {
  return props.showsQuestions ? props.figure.questionsAfter.filter((question) => isLineAt(line, anchorLine(question))) : [];
}

function lineKey(point: LinePoint): string {
  return `${point.side}:${point.line}`;
}

function draftsByLine(comments: PlacedComment[], file: string): Map<string, PlacedComment> {
  const forFile = comments.filter((comment) => comment.file === file && !comment.isOutdated);
  return new Map(forFile.map((comment) => [lineKey(comment), comment]));
}

/** Drag down the gutter, or click then Shift+click, to pick several lines. */
function useLinePicking(diff: DiffFile, onPicked: (span: LineSpan) => void) {
  const [dragging, setDragging] = useState<{ from: LinePoint; to: LinePoint } | null>(null);
  const [lastPick, setLastPick] = useState<LinePoint | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const finish = () => {
      setDragging(null);
      onPicked(spanBetween(diff, dragging.from, dragging.to));
    };
    window.addEventListener("mouseup", finish);
    return () => window.removeEventListener("mouseup", finish);
  }, [dragging]);
  const start = (point: LinePoint, isExtending: boolean) => {
    if (isExtending && lastPick) return onPicked(spanBetween(diff, lastPick, point));
    setLastPick(point);
    setDragging({ from: point, to: point });
  };
  const extend = (point: LinePoint) => setDragging((current) => (current ? { ...current, to: point } : null));
  return { start, extend, dragSpan: dragging ? spanBetween(diff, dragging.from, dragging.to) : null };
}

function hasSelectedText(): boolean {
  return (window.getSelection()?.toString() ?? "") !== "";
}

type LineMarks = {
  props: FigureProps;
  drafts: Map<string, PlacedComment>;
  pickedLines: Set<DiffLine>;
  commentOf: Map<DiffLine, boolean>;
  picking: ReturnType<typeof useLinePicking>;
};

type HalfSide = "left" | "right";

function halfClassOf(line: DiffLine, marks: LineMarks): string {
  const footnote = footnoteCovering(line, marks.props);
  const classes = ["fig-half", `is-${line.kind}`];
  if (footnote !== undefined) classes.push("is-key");
  if (footnote !== undefined && footnote === marks.props.notes?.hovered) classes.push("is-hovered");
  if (isAskedAbout(line, marks.props)) classes.push("is-asked");
  if (marks.drafts.has(lineKey(lineRefOf(line)))) classes.push("has-draft");
  if (marks.pickedLines.has(line)) classes.push("is-picked");
  return classes.join(" ");
}

function numberOn(line: DiffLine, side: HalfSide): number | null {
  return side === "left" ? line.oldLine : line.newLine;
}

/** One side of a row: gutter, line number, code. */
function HalfLine({ line, side, marks }: { line: DiffLine | undefined; side: HalfSide; marks: LineMarks }) {
  if (!line) return <div className="fig-half is-empty" />;
  const { props, picking } = marks;
  const point = lineRefOf(line);
  const clickCode = (event: React.MouseEvent<HTMLElement>) => {
    if (isPeekClick(event)) {
      const clicked = wordAtClick(event, line.text);
      if (clicked) props.session.setPeek({ file: props.figure.file, ...clicked, ...point });
      return;
    }
    if (!hasSelectedText()) props.session.setComposer({ file: props.figure.file, ...point });
  };
  const startPick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    picking.start(point, event.shiftKey);
  };
  return (
    <div className={halfClassOf(line, marks)} onMouseEnter={() => picking.extend(point)}>
      <span className="fig-gutter" onMouseDown={startPick} title="Click to comment. Drag, or Shift+click, for several lines.">
        {marks.drafts.has(lineKey(point)) ? <Icon name="message" size={15} /> : null}
      </span>
      <span className="fig-number" onMouseDown={startPick}>{numberOn(line, side)}</span>
      <span className="code" onClick={clickCode} data-file={props.figure.file} data-line={point.line} data-side={point.side}
        dangerouslySetInnerHTML={{ __html: renderCodeLine(line.text, languageForFile(props.figure.file), marks.commentOf.get(line) ?? false) || " " }} />
    </div>
  );
}

function linesOf(row: SplitRow): DiffLine[] {
  return [row.left, row.right].filter((line, lineIndex, lines): line is DiffLine => line !== undefined && lines.indexOf(line) === lineIndex);
}

function firstFound(row: SplitRow, find: (line: DiffLine) => number | undefined): number | undefined {
  return linesOf(row).map(find).find((footnote) => footnote !== undefined);
}

/** Old code on the left, new code on the right. */
function SplitRowView({ row, marks }: { row: SplitRow; marks: LineMarks }) {
  const { props } = marks;
  const footnote = firstFound(row, (line) => footnoteCovering(line, props));
  const startingNote = firstFound(row, (line) => footnoteStartingAt(line, props));
  const hoverNote = (number: number | null) => footnote !== undefined && props.notes?.onHover(number);
  return (
    <>
      <div className="fig-row" id={startingNote !== undefined ? noteRowId(stepIndexOf(props.figure), startingNote) : undefined}
        onMouseOver={() => hoverNote(footnote!)} onMouseOut={() => hoverNote(null)}>
        <HalfLine line={row.left} side="left" marks={marks} />
        <HalfLine line={row.right} side="right" marks={marks} />
      </div>
      {linesOf(row).map((line) => (
        <BelowRow key={lineKey(lineRefOf(line))} line={line} props={props} draft={marks.drafts.get(lineKey(lineRefOf(line)))} />
      ))}
    </>
  );
}

const FOLD_WORD = { comment: "comment ", unchanged: "unchanged ", far: "more " } as const;

function FoldRow({ count, reason, onOpen }: { count: number; reason: keyof typeof FOLD_WORD; onOpen: () => void }) {
  return (
    <button className="fig-fold" onClick={onOpen}>
      <span className="fig-number">⋯</span>
      <span>{count} {FOLD_WORD[reason]}line{count === 1 ? "" : "s"} folded — show</span>
    </button>
  );
}

/** The row a sidenote lines up with. */
export function noteRowId(stepIndex: number, footnote: number): string {
  return `fnrow-${stepIndex}-${footnote}`;
}

function stepIndexOf(figure: Figure): number {
  return Number(figure.number.split(".")[0]) - 1;
}

function BelowRow({ line, props, draft }: { line: DiffLine; props: FigureProps; draft: PlacedComment | undefined }) {
  const { session, figure } = props;
  const point = lineRefOf(line);
  const isComposerHere = session.composer?.file === figure.file && isLineAt(line, session.composer);
  const isPeekHere = session.peek?.file === figure.file && isLineAt(line, session.peek);
  return (
    <>
      {isPeekHere ? (
        <div className="fig-below"><PeekReferences key={`${session.peek!.word}:${session.peek!.column}`} route={session.route} query={session.peek!}
          onClose={() => session.setPeek(null)} onJump={session.jumpToReference} /></div>
      ) : null}
      {isComposerHere ? (
        <Composer key={lineKey(point)} session={session} target={session.composer!} draftId={draft?.id} initialText={draft?.body ?? ""} />
      ) : null}
      {questionsBelow(line, props).map((question) => (
        <div key={question.id} className="fig-question"><QuestionBlock session={session} file={figure.file} question={question} /></div>
      ))}
    </>
  );
}

function isPinnedBy(props: FigureProps, drafts: Map<string, PlacedComment>) {
  return (line: DiffLine) => {
    const point = lineRefOf(line);
    const isOpenHere = props.session.composer?.file === props.figure.file && isLineAt(line, props.session.composer);
    const isAsked = props.figure.questionsAfter.some((question) => isLineInRange(line, rangeOf(question)));
    return footnoteCovering(line, props) !== undefined || drafts.has(lineKey(point)) || isOpenHere || isAsked;
  };
}

function captionRange(figure: Figure): string {
  return figure.firstLine === figure.lastLine ? `line ${figure.firstLine}` : `lines ${figure.firstLine}–${figure.lastLine}`;
}

function rowKey(row: SplitRow): string {
  return linesOf(row).map((line) => `${line.kind}:${line.oldLine}:${line.newLine}`).join("|");
}

function useFigureMarks(props: FigureProps): LineMarks {
  const { figure, session } = props;
  const drafts = draftsByLine(session.lineComments, figure.file);
  const picking = useLinePicking(props.diff, (span) => session.setComposer({ file: figure.file, ...span }));
  const pickedLines = new Set(picking.dragSpan ? linesInSpan(props.diff, picking.dragSpan) : []);
  const isComment = commentFlags(figure.lines.map((line) => line.text), figure.file);
  const commentOf = new Map(figure.lines.map((line, lineIndex) => [line, isComment[lineIndex]]));
  return { props, drafts, pickedLines, commentOf, picking };
}

/** A slice of the diff as a numbered figure: click a line to comment, Ctrl+click a name to see its uses. */
export function CodeFigure(props: FigureProps) {
  const { figure } = props;
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const [isFull, setIsFull] = useState(false);
  const marks = useFigureMarks(props);
  const rows: ShownRow[] = isFull ? figure.lines.map((line) => ({ kind: "line", line })) : foldRows(figure, isPinnedBy(props, marks.drafts));
  const items = splitShownRows(rows, openFolds);
  const openFold = (id: string) => setOpenFolds((current) => new Set(current).add(id));
  const hasFolds = items.some((item) => item.kind === "fold");
  return (
    <figure className="code-figure" id={figure.id}>
      <div className="fig-body">
        {items.map((item) => (item.kind === "pair"
          ? <SplitRowView key={rowKey(item.row)} row={item.row} marks={marks} />
          : <FoldRow key={item.id} count={item.lines.length} reason={item.reason} onOpen={() => openFold(item.id)} />))}
      </div>
      <figcaption>
        <span>{figure.number ? `Fig. ${figure.number} — ` : ""}{figure.file.split("/").at(-1)}, {captionRange(figure)}{hasFolds ? " (some lines folded)" : ""} · old on the left, new on the right · click a line to comment or ask</span>
        <span className="fig-links">
          <OpenInNeovim route={props.session.route} file={figure.file} className="text-link" label="Neovim" />
          <button className="text-link" onClick={() => setIsFull(!isFull)}>{isFull ? "Fold again" : "Open full diff"}</button>
        </span>
      </figcaption>
    </figure>
  );
}
