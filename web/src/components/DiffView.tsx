import { Fragment, type ReactNode } from "react";

import type { DiffFile, DiffLine } from "../api.ts";
import { highlightLine, languageForFile } from "./highlight.ts";

export type LineRef = { line: number; side: "LEFT" | "RIGHT" };

type DiffViewProps = {
  file: DiffFile;
  // - Extra rows to show under a line, or null.
  annotationsFor: (lineRef: LineRef) => ReactNode;
  onLineClick: (lineRef: LineRef) => void;
};

const MARKER = { add: "+", del: "-", ctx: " " } as const;

/** Deleted lines use old numbers; everything else uses new ones. */
export function lineRefOf(diffLine: DiffLine): LineRef {
  return diffLine.kind === "del" ? { line: diffLine.oldLine!, side: "LEFT" } : { line: diffLine.newLine!, side: "RIGHT" };
}

function DiffRow({ diffLine, language, onLineClick }: { diffLine: DiffLine; language?: string; onLineClick: DiffViewProps["onLineClick"] }) {
  const askHere = () => onLineClick(lineRefOf(diffLine));
  return (
    <tr className={diffLine.kind}>
      <td className="line-number" onClick={askHere} title="Ask about this line">{diffLine.oldLine ?? ""}</td>
      <td className="line-number" onClick={askHere} title="Ask about this line">{diffLine.newLine ?? ""}</td>
      <td className="marker">{MARKER[diffLine.kind]}</td>
      <td className="code" dangerouslySetInnerHTML={{ __html: highlightLine(diffLine.text, language) || " " }} />
    </tr>
  );
}

function AnnotationRow({ children }: { children: ReactNode }) {
  return (
    <tr className="annotation">
      <td colSpan={4}>{children}</td>
    </tr>
  );
}

export function DiffView({ file, annotationsFor, onLineClick }: DiffViewProps) {
  const language = languageForFile(file.path);
  if (file.isBinary) return <div className="card muted">Binary file, not shown.</div>;
  return (
    <table className="diff">
      <colgroup>
        <col style={{ width: 52 }} /><col style={{ width: 52 }} /><col style={{ width: 16 }} /><col />
      </colgroup>
      <tbody>
        {file.hunks.map((hunk, hunkIndex) => (
          <Fragment key={hunkIndex}>
            <tr className="hunk"><td colSpan={4}>{hunk.header}</td></tr>
            {hunk.lines.map((diffLine, lineIndex) => {
              const annotations = annotationsFor(lineRefOf(diffLine));
              return (
                <Fragment key={lineIndex}>
                  <DiffRow diffLine={diffLine} language={language} onLineClick={onLineClick} />
                  {annotations ? <AnnotationRow>{annotations}</AnnotationRow> : null}
                </Fragment>
              );
            })}
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
