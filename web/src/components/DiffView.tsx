import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type { DiffFile, DiffHunk, DiffLine } from "../api.ts";
import { linesInSpan, spanBetween, type LinePoint, type LineSpan } from "../../../server/anchors.ts";
import { useDiffLayout } from "./diffLayout.ts";
import { commentFlags } from "./commentLines.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";
import { toSplitRows, type SplitRow } from "./splitRows.ts";
import { wordAtClick, type ClickedWord } from "./wordAtPoint.ts";

export type LineRef = { line: number; side: "LEFT" | "RIGHT" };

type DiffViewProps = {
  file: DiffFile;
  // - Extra rows to show under a line, or null.
  annotationsFor: (lineRef: LineRef) => ReactNode;
  // - One line, or a range picked by dragging or Shift+click.
  onLineClick: (span: LineSpan) => void;
  onWordClick: (lineRef: LineRef, clicked: ClickedWord) => void;
  // - Lines to keep highlighted, such as the open question box's range.
  selected?: LineSpan;
};

type LinePicking = {
  startPick: (point: LinePoint, isExtending: boolean) => void;
  extendPick: (point: LinePoint) => void;
  pickedLines: Set<DiffLine>;
};

type LineHandlers = Pick<DiffViewProps, "onWordClick"> & {
  picking: LinePicking;
  language?: string;
  filePath: string;
  commentLines?: Set<DiffLine>;
};

const MARKER = { add: "+", del: "-", ctx: " " } as const;

/** Deleted lines use old numbers; everything else uses new ones. */
export function isPeekClick(event: React.MouseEvent): boolean {
  return event.ctrlKey || event.metaKey;
}

export function lineRefOf(diffLine: DiffLine): LineRef {
  return diffLine.kind === "del" ? { line: diffLine.oldLine!, side: "LEFT" } : { line: diffLine.newLine!, side: "RIGHT" };
}

type LineNumberProps = { number: number | null; diffLine: DiffLine; handlers: LineHandlers; className?: string };

function pickedClass(diffLine: DiffLine, handlers: LineHandlers): string {
  return handlers.picking.pickedLines.has(diffLine) ? " is-picked" : "";
}

function LineNumberCell({ number, diffLine, handlers, className = "line-number" }: LineNumberProps) {
  const startPick = (event: React.MouseEvent) => {
    event.preventDefault();
    handlers.picking.startPick(lineRefOf(diffLine), event.shiftKey);
  };
  return (
    <td className={className + pickedClass(diffLine, handlers)} onMouseDown={startPick} onMouseEnter={() => handlers.picking.extendPick(lineRefOf(diffLine))}
      title="Ask or comment on this line. Drag, or Shift+click, to pick several lines.">
      {number ?? ""}
    </td>
  );
}

function CodeCell({ diffLine, handlers, className = "code" }: { diffLine: DiffLine; handlers: LineHandlers; className?: string }) {
  const peekWord = (event: React.MouseEvent<HTMLElement>) => {
    if (!isPeekClick(event)) return;
    const clicked = wordAtClick(event, diffLine.text);
    if (clicked) handlers.onWordClick(lineRefOf(diffLine), clicked);
  };
  const lineRef = lineRefOf(diffLine);
  return (
    <td className={className + pickedClass(diffLine, handlers)} onClick={peekWord} data-file={handlers.filePath} data-line={lineRef.line} data-side={lineRef.side}
      dangerouslySetInnerHTML={{ __html: renderCodeLine(diffLine.text, handlers.language, handlers.commentLines?.has(diffLine) ?? false) || " " }} />
  );
}

function AnnotationRow({ columns, children }: { columns: number; children: ReactNode }) {
  return (
    <tr className="annotation">
      <td colSpan={columns}>{children}</td>
    </tr>
  );
}

function UnifiedRow({ diffLine, handlers }: { diffLine: DiffLine; handlers: LineHandlers }) {
  return (
    <tr className={diffLine.kind}>
      <LineNumberCell number={diffLine.oldLine} diffLine={diffLine} handlers={handlers} />
      <LineNumberCell number={diffLine.newLine} diffLine={diffLine} handlers={handlers} />
      <td className="marker">{MARKER[diffLine.kind]}</td>
      <CodeCell diffLine={diffLine} handlers={handlers} />
    </tr>
  );
}

function SplitSide({ diffLine, number, handlers }: { diffLine: DiffLine | undefined; number: number | null; handlers: LineHandlers }) {
  if (!diffLine) return <><td className="line-number empty-side" /><td className="code empty-side" /></>;
  return (
    <>
      <LineNumberCell number={number} diffLine={diffLine} handlers={handlers} className={`line-number side-${diffLine.kind}`} />
      <CodeCell diffLine={diffLine} handlers={handlers} className={`code side-${diffLine.kind}`} />
    </>
  );
}

function SplitRowView({ row, handlers }: { row: SplitRow; handlers: LineHandlers }) {
  return (
    <tr className="split-row">
      <SplitSide diffLine={row.left} number={row.left?.oldLine ?? null} handlers={handlers} />
      <SplitSide diffLine={row.right} number={row.right?.newLine ?? null} handlers={handlers} />
    </tr>
  );
}

/** A context line is one line shown on both sides. */
function linesInRow(row: SplitRow): DiffLine[] {
  const sides = [row.left, row.right].filter((diffLine): diffLine is DiffLine => diffLine !== undefined);
  return [...new Set(sides)];
}

function annotationsForLines(lines: DiffLine[], annotationsFor: DiffViewProps["annotationsFor"]): ReactNode[] {
  const annotations = lines.map((diffLine) => annotationsFor(lineRefOf(diffLine)));
  return annotations.filter(Boolean).map((annotation, annotationIndex) => <Fragment key={annotationIndex}>{annotation}</Fragment>);
}

/** Old and new sides are separate runs of code for comment tracking. */
function commentLinesIn(hunk: DiffHunk, filePath: string): Set<DiffLine> {
  const flagged = new Set<DiffLine>();
  const flagRun = (run: DiffLine[]) =>
    commentFlags(run.map((line) => line.text), filePath).forEach((isComment, lineIndex) => {
      if (isComment) flagged.add(run[lineIndex]);
    });
  flagRun(hunk.lines.filter((line) => line.kind !== "add"));
  flagRun(hunk.lines.filter((line) => line.kind !== "del"));
  return flagged;
}

function UnifiedHunk({ hunk, props, handlers }: { hunk: DiffHunk; props: DiffViewProps; handlers: LineHandlers }) {
  return (
    <>
      {hunk.lines.map((diffLine, lineIndex) => {
        const annotations = props.annotationsFor(lineRefOf(diffLine));
        return (
          <Fragment key={lineIndex}>
            <UnifiedRow diffLine={diffLine} handlers={handlers} />
            {annotations ? <AnnotationRow columns={4}>{annotations}</AnnotationRow> : null}
          </Fragment>
        );
      })}
    </>
  );
}

function SplitHunk({ hunk, props, handlers }: { hunk: DiffHunk; props: DiffViewProps; handlers: LineHandlers }) {
  return (
    <>
      {toSplitRows(hunk.lines).map((row, rowIndex) => {
        const annotations = annotationsForLines(linesInRow(row), props.annotationsFor);
        return (
          <Fragment key={rowIndex}>
            <SplitRowView row={row} handlers={handlers} />
            {annotations.length > 0 ? <AnnotationRow columns={4}>{annotations}</AnnotationRow> : null}
          </Fragment>
        );
      })}
    </>
  );
}

function ColumnWidths({ isSplit }: { isSplit: boolean }) {
  if (isSplit) return <colgroup><col style={{ width: 46 }} /><col /><col style={{ width: 46 }} /><col /></colgroup>;
  return <colgroup><col style={{ width: 52 }} /><col style={{ width: 52 }} /><col style={{ width: 16 }} /><col /></colgroup>;
}

/** Picks lines by dragging over line numbers, or by Shift+click from the last pick. */
function useLinePicking(file: DiffFile, onPicked: (span: LineSpan) => void, selected: LineSpan | undefined): LinePicking {
  const [dragging, setDragging] = useState<{ from: LinePoint; to: LinePoint } | null>(null);
  const lastPick = useRef<LinePoint | null>(null);
  useEffect(() => {
    if (!dragging) return;
    const finishDrag = () => {
      setDragging(null);
      onPicked(spanBetween(file, dragging.from, dragging.to));
    };
    window.addEventListener("mouseup", finishDrag);
    return () => window.removeEventListener("mouseup", finishDrag);
  }, [dragging]);
  const startPick = (point: LinePoint, isExtending: boolean) => {
    if (isExtending && lastPick.current) return onPicked(spanBetween(file, lastPick.current, point));
    lastPick.current = point;
    setDragging({ from: point, to: point });
  };
  const extendPick = (point: LinePoint) => setDragging((current) => (current ? { ...current, to: point } : null));
  const shownSpan = dragging ? spanBetween(file, dragging.from, dragging.to) : selected;
  return { startPick, extendPick, pickedLines: new Set(shownSpan ? linesInSpan(file, shownSpan) : []) };
}

export function DiffView(props: DiffViewProps) {
  const layout = useDiffLayout();
  const picking = useLinePicking(props.file, props.onLineClick, props.selected);
  const handlers: LineHandlers = {
    picking, onWordClick: props.onWordClick, language: languageForFile(props.file.path), filePath: props.file.path,
  };
  if (props.file.isBinary) return <div className="card muted">Binary file, not shown.</div>;
  const isSplit = layout === "split";
  const Hunk = isSplit ? SplitHunk : UnifiedHunk;
  return (
    <table className={`diff ${isSplit ? "split" : "unified"}`}>
      <ColumnWidths isSplit={isSplit} />
      <tbody>
        {props.file.hunks.map((hunk, hunkIndex) => (
          <Fragment key={hunkIndex}>
            <tr className="hunk"><td colSpan={4}>{hunk.header}</td></tr>
            <Hunk hunk={hunk} props={props} handlers={{ ...handlers, commentLines: commentLinesIn(hunk, props.file.path) }} />
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** True when the line shows up somewhere in the file's diff. */
export function isInDiff(file: DiffFile, lineRef: LineRef): boolean {
  return file.hunks.some((hunk) =>
    hunk.lines.some((diffLine) => {
      const ref = lineRefOf(diffLine);
      return ref.line === lineRef.line && ref.side === lineRef.side;
    }),
  );
}
