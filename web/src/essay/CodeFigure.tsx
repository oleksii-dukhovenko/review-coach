import { useEffect, useRef, useState, type RefObject } from "react";

import type { DiffFile, DiffLine } from "../api.ts";
import { linesInSpan, spanBetween, type LinePoint, type LineSpan } from "../../../server/anchors.ts";
import { commentFlags } from "../components/commentLines.ts";
import { isPeekClick, lineRefOf } from "../components/lineClicks.ts";
import { languageForFile, renderCodeLine } from "../components/highlight.ts";
import { Icon } from "../components/Icon.tsx";
import { OpenInNeovim } from "../components/OpenInNeovim.tsx";
import { PeekReferences } from "../components/PeekReferences.tsx";
import { identifiersOn, wordAtClick, type ClickedWord } from "../components/wordAtPoint.ts";
import { WordPicker } from "../components/WordPicker.tsx";
import { focusQuietly, useKeys, type KeyHandler } from "../keys.ts";
import type { PlacedComment } from "../placeComments.ts";
import { Composer } from "./Composer.tsx";
import { focusedLineCell, focusLine, hasLineOnSide, lineCells, linePointOf, moveLineFocus, type CellSide, type LineMove } from "./lineCursor.ts";
import {
  anchorLine, firstShownLine, foldRows, isLineAt, isLineInRange, rangeOf,
  type Figure, type FoldedRun, type Footnote, type QuestionData, type ShownRow,
} from "./model.ts";
import { QuestionBlock } from "./QuestionBlock.tsx";
import { afterRender, type ReviewSession } from "./session.ts";
import { splitShownRows, type SplitItem, type SplitRow } from "./splitRows.ts";

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

type KeyRange = { from: LinePoint; to: LinePoint };

/** Lines picked with J and K, and the line whose names are listed after r. */
function useKeyPicks() {
  const [keyRange, setKeyRange] = useState<KeyRange | null>(null);
  const [wordsAt, setWordsAt] = useState<DiffLine | null>(null);
  return { keyRange, setKeyRange, wordsAt, setWordsAt };
}

type KeyPicks = ReturnType<typeof useKeyPicks>;

function hasSelectedText(): boolean {
  return (window.getSelection()?.toString() ?? "") !== "";
}

type HalfSide = "left" | "right";

type HalfRef = { line: DiffLine; side: HalfSide };

type LineMarks = {
  props: FigureProps;
  drafts: Map<string, PlacedComment>;
  pickedLines: Set<DiffLine>;
  commentOf: Map<DiffLine, boolean>;
  picking: ReturnType<typeof useLinePicking>;
  keyPicks: KeyPicks;
  // - Opens the comment box; drops the lines picked with keys.
  openComposer: (span: LineSpan) => void;
  // - The one half that Tab reaches.
  tabStop?: HalfRef;
};

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

function isTabStop(line: DiffLine, side: HalfSide, marks: LineMarks): boolean {
  return marks.tabStop?.line === line && marks.tabStop.side === side;
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
    if (!hasSelectedText()) marks.openComposer(point);
  };
  const startPick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    picking.start(point, event.shiftKey);
  };
  return (
    <div className={halfClassOf(line, marks)} tabIndex={isTabStop(line, side, marks) ? 0 : -1} onMouseEnter={() => picking.extend(point)}>
      <span className="fig-gutter" onMouseDown={startPick} title="Click, or press Enter on the line, to comment. Drag, Shift+click, or J and K for several lines.">
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
      {linesOf(row).map((line) => <BelowRow key={lineKey(lineRefOf(line))} line={line} marks={marks} />)}
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

/** Closing the name list or the uses panel puts focus back on the line. */
function belowRowActions(line: DiffLine, marks: LineMarks) {
  const { session, figure } = marks.props;
  const point = lineRefOf(line);
  const focusThisLine = () => afterRender(() => focusLine(figure.file, point.line, point.side));
  return {
    closePeek: () => {
      session.setPeek(null);
      focusThisLine();
    },
    closeWords: () => {
      marks.keyPicks.setWordsAt(null);
      focusThisLine();
    },
    pickWord: (word: ClickedWord) => {
      marks.keyPicks.setWordsAt(null);
      session.setPeek({ file: figure.file, ...word, ...point });
    },
  };
}

function BelowRow({ line, marks }: { line: DiffLine; marks: LineMarks }) {
  const { session, figure } = marks.props;
  const point = lineRefOf(line);
  const draft = marks.drafts.get(lineKey(point));
  const actions = belowRowActions(line, marks);
  const isComposerHere = session.composer?.file === figure.file && isLineAt(line, session.composer);
  const isPeekHere = session.peek?.file === figure.file && isLineAt(line, session.peek);
  const isWordListHere = marks.keyPicks.wordsAt === line;
  return (
    <>
      {isWordListHere ? (
        <div className="fig-below"><WordPicker words={identifiersOn(line.text)} onPick={actions.pickWord} onClose={actions.closeWords} /></div>
      ) : null}
      {isPeekHere ? (
        <div className="fig-below"><PeekReferences key={`${session.peek!.word}:${session.peek!.column}`} route={session.route} query={session.peek!}
          onClose={actions.closePeek} onJump={session.jumpToReference} /></div>
      ) : null}
      {isComposerHere ? (
        <Composer key={lineKey(point)} session={session} target={session.composer!} draftId={draft?.id} initialText={draft?.body ?? ""} />
      ) : null}
      {questionsBelow(line, marks.props).map((question) => (
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

function pickedSpan(diff: DiffFile, dragSpan: LineSpan | null, keyRange: KeyRange | null): LineSpan | null {
  if (dragSpan) return dragSpan;
  return keyRange ? spanBetween(diff, keyRange.from, keyRange.to) : null;
}

function useFigureMarks(props: FigureProps, keyPicks: KeyPicks): LineMarks {
  const { figure, session } = props;
  const drafts = draftsByLine(session.lineComments, figure.file);
  const openComposer = (span: LineSpan) => {
    keyPicks.setKeyRange(null);
    session.setComposer({ file: figure.file, ...span });
  };
  const picking = useLinePicking(props.diff, openComposer);
  const span = pickedSpan(props.diff, picking.dragSpan, keyPicks.keyRange);
  const pickedLines = new Set(span ? linesInSpan(props.diff, span) : []);
  const isComment = commentFlags(figure.lines.map((line) => line.text), figure.file);
  const commentOf = new Map(figure.lines.map((line, lineIndex) => [line, isComment[lineIndex]]));
  return { props, drafts, pickedLines, commentOf, picking, keyPicks, openComposer };
}

function isPair(item: SplitItem): item is { kind: "pair"; row: SplitRow } {
  return item.kind === "pair";
}

/** The first line half in the figure: its one Tab stop. */
function firstHalfOf(items: SplitItem[]): HalfRef | undefined {
  const firstRow = items.find(isPair)?.row;
  if (firstRow?.left) return { line: firstRow.left, side: "left" };
  return firstRow?.right ? { line: firstRow.right, side: "right" } : undefined;
}

function focusFirstLineOf(file: string, lines: DiffLine[]): void {
  const firstLine = lines.at(0);
  if (!firstLine) return;
  const point = lineRefOf(firstLine);
  focusLine(file, point.line, point.side);
}

/** Folded runs the reader opened; opening one focuses its first line. */
function useOpenFolds(file: string) {
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const openFold = (fold: FoldedRun) => {
    setOpenFolds((current) => new Set(current).add(fold.id));
    afterRender(() => focusFirstLineOf(file, fold.lines));
  };
  return { openFolds, openFold };
}

// - Keys on a focused code line.

type FocusedLine = { cell: HTMLElement; line: DiffLine; point: LinePoint };

function isSamePoint(first: LinePoint, second: LinePoint): boolean {
  return first.line === second.line && first.side === second.side;
}

function diffLineAt(figure: Figure, point: LinePoint | undefined): DiffLine | undefined {
  if (!point) return undefined;
  return figure.lines.find((line) => isSamePoint(lineRefOf(line), point));
}

/** The focused line half, when it belongs to this figure. */
function focusedLineIn(figure: Figure): FocusedLine | undefined {
  const cell = focusedLineCell();
  const line = diffLineAt(figure, linePointOf(cell));
  return cell && line ? { cell, line, point: lineRefOf(line) } : undefined;
}

/** A key that answers only on a focused line, and when isReady agrees. */
function onFocusedLine(figure: Figure, run: (focused: FocusedLine) => void, isReady = (_focused: FocusedLine) => true): KeyHandler {
  return {
    run: () => {
      const focused = focusedLineIn(figure);
      if (focused) run(focused);
    },
    when: () => {
      const focused = focusedLineIn(figure);
      return focused !== undefined && isReady(focused);
    },
  };
}

function isNewSide(focused: FocusedLine): boolean {
  return focused.point.side === "RIGHT";
}

/** Focuses the same line again, or the figure's first line when it is folded away. */
function refocusLine(body: RefObject<HTMLDivElement | null>, file: string, point: LinePoint): void {
  if (focusLine(file, point.line, point.side)) return;
  focusQuietly(body.current ? lineCells(body.current).at(0) : undefined);
}

/** Focuses the open comment box, also when it was already open. */
function focusComposerIn(body: RefObject<HTMLDivElement | null>): void {
  focusQuietly(body.current?.querySelector(".composer textarea"));
}

type FigureKeyParts = { body: RefObject<HTMLDivElement | null>; keyPicks: KeyPicks; toggleFull: () => void };

function figureKeyActions(props: FigureProps, parts: FigureKeyParts) {
  const { figure, diff, session } = props;
  const { keyRange, setKeyRange, setWordsAt } = parts.keyPicks;
  return {
    move: (focused: FocusedLine, move: LineMove) => {
      setKeyRange(null);
      moveLineFocus(focused.cell, move);
    },
    grow: (focused: FocusedLine, move: LineMove) => {
      moveLineFocus(focused.cell, move, true);
      const reached = focusedLineIn(figure)?.point ?? focused.point;
      setKeyRange((current) => ({ from: current?.from ?? focused.point, to: reached }));
    },
    comment: (focused: FocusedLine) => {
      const span = keyRange ? spanBetween(diff, keyRange.from, keyRange.to) : focused.point;
      setKeyRange(null);
      session.setComposer({ file: figure.file, ...span });
      afterRender(() => focusComposerIn(parts.body));
    },
    showUses: (focused: FocusedLine) => {
      const names = identifiersOn(focused.line.text);
      const hasOneName = names.length === 1;
      const hasSeveralNames = names.length > 1;
      if (hasOneName) session.setPeek({ file: figure.file, ...names[0], ...focused.point });
      if (hasSeveralNames) setWordsAt(focused.line);
    },
    openFile: (focused: FocusedLine) => session.viewer.open({ file: figure.file, line: focused.point.line }),
    toggleFull: (focused: FocusedLine) => {
      parts.toggleFull();
      afterRender(() => refocusLine(parts.body, figure.file, focused.point));
    },
  };
}

/** The code line keys, answered while focus is inside this figure. */
function useFigureKeys(props: FigureProps, parts: FigureKeyParts): void {
  const { figure } = props;
  const actions = figureKeyActions(props, parts);
  const moveTo = (move: LineMove) => onFocusedLine(figure, (focused) => actions.move(focused, move));
  // - No line on that side: arrows scroll the code.
  const switchTo = (side: CellSide) => onFocusedLine(figure, (focused) => actions.move(focused, side), (focused) => hasLineOnSide(focused.cell, side));
  const growTo = (move: LineMove) => onFocusedLine(figure, (focused) => actions.grow(focused, move));
  const hasKeyRange = parts.keyPicks.keyRange !== null;
  useKeys("codeLine", {
    down: moveTo("down"),
    up: moveTo("up"),
    oldSide: switchTo("left"),
    newSide: switchTo("right"),
    growDown: growTo("down"),
    growUp: growTo("up"),
    comment: onFocusedLine(figure, actions.comment),
    uses: onFocusedLine(figure, actions.showUses),
    openFile: onFocusedLine(figure, actions.openFile, isNewSide),
    fullDiff: onFocusedLine(figure, actions.toggleFull),
    clearRange: { run: () => parts.keyPicks.setKeyRange(null), when: () => hasKeyRange },
  }, { within: parts.body });
}

function shownItems(props: FigureProps, marks: LineMarks, isFull: boolean, openFolds: Set<string>): SplitItem[] {
  const { figure } = props;
  const rows: ShownRow[] = isFull ? figure.lines.map((line) => ({ kind: "line", line })) : foldRows(figure, isPinnedBy(props, marks.drafts));
  return splitShownRows(rows, openFolds);
}

/** True when focus moves to an element outside this one. */
function isFocusMovingOut(event: React.FocusEvent<HTMLElement>): boolean {
  const nextFocus = event.relatedTarget;
  return nextFocus instanceof Node && !event.currentTarget.contains(nextFocus);
}

/** A slice of the diff as a numbered figure: click a line to comment, Ctrl+click a name to see its uses. */
export function CodeFigure(props: FigureProps) {
  const { figure } = props;
  const body = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  const toggleFull = () => setIsFull((current) => !current);
  const keyPicks = useKeyPicks();
  const folds = useOpenFolds(figure.file);
  const figureMarks = useFigureMarks(props, keyPicks);
  const items = shownItems(props, figureMarks, isFull, folds.openFolds);
  const marks: LineMarks = { ...figureMarks, tabStop: firstHalfOf(items) };
  const hasFolds = items.some((item) => item.kind === "fold");
  useFigureKeys(props, { body, keyPicks, toggleFull });
  // - J/K picks drop when focus leaves the figure.
  const dropPicksOnLeave = (event: React.FocusEvent<HTMLDivElement>) => {
    if (isFocusMovingOut(event)) keyPicks.setKeyRange(null);
  };
  return (
    <figure className="code-figure" id={figure.id}>
      <div className="fig-body" ref={body} onBlur={dropPicksOnLeave}>
        {items.map((item) => (isPair(item)
          ? <SplitRowView key={rowKey(item.row)} row={item.row} marks={marks} />
          : <FoldRow key={item.id} count={item.lines.length} reason={item.reason} onOpen={() => folds.openFold(item)} />))}
      </div>
      <figcaption>
        <span>{figure.number ? `Fig. ${figure.number} — ` : ""}{figure.file.split("/").at(-1)}, {captionRange(figure)}{hasFolds ? " (some lines folded)" : ""} · old on the left, new on the right · click a line or press Enter on it to comment; r shows where a name is used</span>
        <span className="fig-links">
          <OpenInNeovim route={props.session.route} file={figure.file} className="text-link" label="Neovim" />
          <button className="text-link" onClick={toggleFull}>{isFull ? "Fold again" : "Open full diff"}</button>
        </span>
      </figcaption>
    </figure>
  );
}
