import { Fragment, useEffect, useState } from "react";

import type { DiffFile, DiffLine } from "../api.ts";
import { linesInSpan, spanBetween, type LinePoint, type LineSpan } from "../../../server/anchors.ts";
import { commentFlags } from "../components/commentLines.ts";
import { isPeekClick, lineRefOf } from "../components/lineClicks.ts";
import { languageForFile, renderCodeLine } from "../components/highlight.ts";
import { Icon } from "../components/Icon.tsx";
import { PeekReferences } from "../components/PeekReferences.tsx";
import { wordAtClick } from "../components/wordAtPoint.ts";
import type { PlacedComment } from "../placeComments.ts";
import { Composer } from "./Composer.tsx";
import { anchorLine, foldRows, isLineAt, type Figure, type ShownRow } from "./model.ts";
import type { ReviewSession } from "./session.ts";

type FigureProps = {
  figure: Figure;
  diff: DiffFile;
  session: ReviewSession;
  // - Rows a sidenote points at, with the footnote number.
  footnoteAt: (line: DiffLine) => number | undefined;
  hoveredNote: number | null;
  onHoverNote: (number: number | null) => void;
};

const SIGN = { add: "+", del: "−", ctx: "" } as const;

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

type RowProps = {
  line: DiffLine;
  props: FigureProps;
  draft: PlacedComment | undefined;
  isPicked: boolean;
  isComment: boolean;
  picking: ReturnType<typeof useLinePicking>;
};

function rowClassOf({ line, props, draft, isPicked }: RowProps): string {
  const footnote = props.footnoteAt(line);
  const classes = ["fig-row", `is-${line.kind}`];
  if (footnote !== undefined) classes.push("is-key");
  if (footnote !== undefined && footnote === props.hoveredNote) classes.push("is-hovered");
  if (draft) classes.push("has-draft");
  if (isPicked) classes.push("is-picked");
  return classes.join(" ");
}

function CodeRow(rowProps: RowProps) {
  const { line, props, draft, picking } = rowProps;
  const point = lineRefOf(line);
  const footnote = props.footnoteAt(line);
  const openComposer = () => props.session.setComposer({ file: props.figure.file, ...point });
  const clickRow = (event: React.MouseEvent<HTMLElement>) => {
    if (isPeekClick(event)) {
      const clicked = wordAtClick(event, line.text);
      if (clicked) props.session.setPeek({ file: props.figure.file, ...clicked, ...point });
      return;
    }
    if (!hasSelectedText()) openComposer();
  };
  const startPick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    picking.start(point, event.shiftKey);
  };
  return (
    <div className={rowClassOf(rowProps)} onMouseEnter={() => picking.extend(point)}
      id={footnote !== undefined ? noteRowId(stepIndexOf(props.figure), footnote) : undefined}
      onMouseOver={() => footnote !== undefined && props.onHoverNote(footnote)} onMouseOut={() => footnote !== undefined && props.onHoverNote(null)}>
      <span className="fig-gutter" onMouseDown={startPick} title="Click to comment. Drag, or Shift+click, for several lines.">
        {draft ? <Icon name="message" size={15} /> : null}
      </span>
      <span className="fig-number" onMouseDown={startPick}>{line.kind === "del" ? line.oldLine : line.newLine}</span>
      <span className="fig-sign">{SIGN[line.kind]}</span>
      <span className="code" onClick={clickRow} data-file={props.figure.file} data-line={point.line} data-side={point.side}
        dangerouslySetInnerHTML={{ __html: renderCodeLine(line.text, languageForFile(props.figure.file), rowProps.isComment) || " " }} />
    </div>
  );
}

const FOLD_WORD = { comment: "comment ", unchanged: "unchanged ", far: "more " } as const;

function FoldRow({ count, reason, onOpen }: { count: number; reason: keyof typeof FOLD_WORD; onOpen: () => void }) {
  return (
    <button className="fig-fold" onClick={onOpen}>
      <span /><span className="fig-number">⋯</span><span />
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
    </>
  );
}

function isPinnedBy(props: FigureProps, drafts: Map<string, PlacedComment>) {
  return (line: DiffLine) => {
    const point = lineRefOf(line);
    const isOpenHere = props.session.composer?.file === props.figure.file && isLineAt(line, props.session.composer);
    const isAskedAbout = props.figure.questionsAfter.some((question) => isLineAt(line, anchorLine(question)));
    return props.footnoteAt(line) !== undefined || drafts.has(lineKey(point)) || isOpenHere || isAskedAbout;
  };
}

function captionRange(figure: Figure): string {
  return figure.firstLine === figure.lastLine ? `line ${figure.firstLine}` : `lines ${figure.firstLine}–${figure.lastLine}`;
}

/** A slice of the diff as a numbered figure: click a line to comment, Ctrl+click a name to see its uses. */
export function CodeFigure(props: FigureProps) {
  const { figure, session } = props;
  const [openFolds, setOpenFolds] = useState<Set<string>>(new Set());
  const [isFull, setIsFull] = useState(false);
  const drafts = draftsByLine(session.lineComments, figure.file);
  const picking = useLinePicking(props.diff, (span) => session.setComposer({ file: figure.file, ...span }));
  const pickedLines = new Set(picking.dragSpan ? linesInSpan(props.diff, picking.dragSpan) : []);
  const isComment = commentFlags(figure.lines.map((line) => line.text), figure.file);
  const commentOf = new Map(figure.lines.map((line, lineIndex) => [line, isComment[lineIndex]]));
  const rows: ShownRow[] = isFull ? figure.lines.map((line) => ({ kind: "line", line })) : foldRows(figure, isPinnedBy(props, drafts));
  const openFold = (id: string) => setOpenFolds((current) => new Set(current).add(id));
  const hasFolds = rows.some((row) => row.kind === "fold");
  const renderLine = (line: DiffLine) => {
    const draft = drafts.get(lineKey(lineRefOf(line)));
    return (
      <Fragment key={`${line.oldLine}:${line.newLine}:${line.kind}`}>
        <CodeRow line={line} props={props} draft={draft} isPicked={pickedLines.has(line)} isComment={commentOf.get(line) ?? false} picking={picking} />
        <BelowRow line={line} props={props} draft={draft} />
      </Fragment>
    );
  };
  return (
    <figure className="code-figure" id={figure.id}>
      <div className="fig-body">
        {rows.map((row) => (row.kind === "line" ? renderLine(row.line)
          : openFolds.has(row.id) ? row.lines.map(renderLine)
            : <FoldRow key={row.id} count={row.lines.length} reason={row.reason} onOpen={() => openFold(row.id)} />))}
      </div>
      <figcaption>
        <span>Fig. {figure.number} — {figure.file.split("/").at(-1)}, {captionRange(figure)}{hasFolds ? " (some lines folded)" : ""} · hover a line for <span className="accent-text">+</span>, click to comment</span>
        <button className="text-link" onClick={() => setIsFull(!isFull)}>{isFull ? "Fold again" : "Open full diff"}</button>
      </figcaption>
    </figure>
  );
}
