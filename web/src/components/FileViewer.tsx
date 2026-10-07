import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { api, type FileView, type PrRoute, type Reference, type ReferenceQuery } from "../api.ts";
import { commentFlags } from "./commentLines.ts";
import { isPeekClick } from "./lineClicks.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";
import { Icon } from "./Icon.tsx";
import { PeekReferences } from "./PeekReferences.tsx";
import { addHistoryStep } from "../scrollHistory.ts";
import { wordAtClick } from "./wordAtPoint.ts";

export type FileTarget = { file: string; line: number };

function openFilesIn(state: unknown): FileTarget[] {
  return (state as { openFiles?: FileTarget[] } | null)?.openFiles ?? [];
}

/** Files opened from Ctrl+click, kept in browser history so Back works. */
export function useFileViewer() {
  const [openFiles, setOpenFiles] = useState<FileTarget[]>(() => openFilesIn(history.state));
  useEffect(() => {
    const followHistory = (event: PopStateEvent) => setOpenFiles(openFilesIn(event.state));
    window.addEventListener("popstate", followHistory);
    return () => window.removeEventListener("popstate", followHistory);
  }, []);
  const open = (target: FileTarget) => {
    const next = [...openFilesIn(history.state), target];
    addHistoryStep({ openFiles: next });
    setOpenFiles(next);
  };
  return {
    current: openFiles.at(-1),
    canGoBack: openFiles.length > 1,
    open,
    back: () => history.back(),
    // - history.go(0) would reload the page.
    close: () => openFiles.length > 0 && history.go(-openFiles.length),
  };
}

export type FileViewerControls = ReturnType<typeof useFileViewer>;

function useFileView(route: PrRoute, file: string): { view?: FileView; error?: string } {
  const [state, setState] = useState<{ view?: FileView; error?: string }>({});
  useEffect(() => {
    setState({});
    api.file(route, file).then((view) => setState({ view }), (loadError: Error) => setState({ error: loadError.message }));
  }, [file]);
  return state;
}

function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
}

type CodeLinesProps = {
  route: PrRoute;
  view: FileView;
  targetLine: number;
  onOpen: (target: FileTarget) => void;
};

function CodeLines({ route, view, targetLine, onOpen }: CodeLinesProps) {
  const [peek, setPeek] = useState<ReferenceQuery | null>(null);
  const targetRow = useRef<HTMLTableRowElement>(null);
  const language = languageForFile(view.file);
  const isCommentLine = useMemo(() => commentFlags(view.lines, view.file), [view]);
  const changedLines = useMemo(() => new Set(view.changedLines), [view]);
  useEffect(() => {
    void targetRow.current?.scrollIntoView({ block: "center" });
  }, [view, targetLine]);

  const peekAt = (event: React.MouseEvent<HTMLElement>, lineText: string, lineNumber: number) => {
    if (!isPeekClick(event)) return;
    const clicked = wordAtClick(event, lineText);
    if (clicked) setPeek({ ...clicked, file: view.file, line: lineNumber, side: "RIGHT" });
  };
  const jump = (reference: Reference) => {
    setPeek(null);
    onOpen({ file: reference.file, line: reference.line });
  };

  const rowClassOf = (lineNumber: number) =>
    [lineNumber === targetLine ? "viewer-target" : "", changedLines.has(lineNumber) ? "viewer-changed" : ""].join(" ");
  return (
    <table className="viewer-code">
      <tbody>
        {view.lines.map((lineText, lineIndex) => {
          const lineNumber = lineIndex + 1;
          return (
            <Fragment key={lineNumber}>
              <tr ref={lineNumber === targetLine ? targetRow : undefined} className={rowClassOf(lineNumber)}>
                <td className="viewer-line-number">{lineNumber}</td>
                <td className="viewer-line" onClick={(event) => peekAt(event, lineText, lineNumber)}
                  dangerouslySetInnerHTML={{ __html: renderCodeLine(lineText, language, isCommentLine[lineIndex]) || " " }} />
              </tr>
              {peek?.line === lineNumber ? <PeekRow route={route} query={peek} onClose={() => setPeek(null)} onJump={jump} /> : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PeekRow({ route, query, onClose, onJump }: { route: PrRoute; query: ReferenceQuery; onClose: () => void; onJump: (reference: Reference) => void }) {
  return (
    <tr className="viewer-peek">
      <td colSpan={2}><PeekReferences route={route} query={query} onClose={onClose} onJump={onJump} goLabel="Go there" /></td>
    </tr>
  );
}

/** The whole file at the PR head, opened beside the page. */
export function FileViewer({ route, viewer }: { route: PrRoute; viewer: FileViewerControls }) {
  const target = viewer.current;
  useEscapeToClose(viewer.close);
  if (!target) return null;
  return <FileViewerPanel key={`${target.file}:${target.line}`} route={route} target={target} viewer={viewer} />;
}

function FileViewerPanel({ route, target, viewer }: { route: PrRoute; target: FileTarget; viewer: FileViewerControls }) {
  const { view, error } = useFileView(route, target.file);
  const changedCount = view?.changedLines.length ?? 0;
  return (
    <>
      <div className="viewer-backdrop" onClick={viewer.close} />
      <aside className="viewer" aria-label={`File ${target.file}`}>
        <header className="viewer-header">
          <button disabled={!viewer.canGoBack} onClick={viewer.back} title="Back"><Icon name="arrowLeft" /></button>
          <div className="viewer-title">
            <div className="mono">{target.file}<span className="muted">:{target.line}</span></div>
            <div className="small muted">
              {changedCount > 0 ? <><span className="legend-swatch changed" /> {changedCount} lines changed by this PR · </> : "This PR does not change this file · "}
              Ctrl+click a name to follow it
            </div>
          </div>
          <button onClick={viewer.close} title="Close (Esc)"><Icon name="x" /></button>
        </header>
        <div className="viewer-body">
          {error ? <div className="banner error" style={{ margin: 12 }}>{error}</div> : null}
          {!view && !error ? <div className="muted small" style={{ padding: 16 }}>Opening...</div> : null}
          {view ? <CodeLines route={route} view={view} targetLine={target.line} onOpen={viewer.open} /> : null}
          {view?.isTruncated ? <div className="muted small" style={{ padding: 12 }}>File cut off after 20,000 lines.</div> : null}
        </div>
      </aside>
    </>
  );
}
