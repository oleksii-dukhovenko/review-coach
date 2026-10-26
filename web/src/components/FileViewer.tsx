import { Fragment, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { api, type FileView, type PrRoute, type Reference, type ReferenceQuery } from "../api.ts";
import { focusedLineCell, moveLineFocus, type LineMove } from "../essay/lineCursor.ts";
import { focusQuietly, isFocusLost, useKeys, useLayer } from "../keys.ts";
import { commentFlags } from "./commentLines.ts";
import { isPeekClick } from "./lineClicks.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";
import { Icon } from "./Icon.tsx";
import { PeekReferences } from "./PeekReferences.tsx";
import { addHistoryStep } from "../scrollHistory.ts";
import { identifiersOn, wordAtClick, type ClickedWord } from "./wordAtPoint.ts";
import { WordPicker } from "./WordPicker.tsx";

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

type CodeLinesProps = {
  route: PrRoute;
  view: FileView;
  targetLine: number;
  onOpen: (target: FileTarget) => void;
};

type LineWords = { line: number; words: ClickedWord[] };

function lineNumberOf(row: HTMLElement | null): number | undefined {
  const lineNumber = Number(row?.dataset.line);
  return lineNumber > 0 ? lineNumber : undefined;
}

// - Undefined when focus is in a peek or picker row.
function focusedLineNumber(): number | undefined {
  return lineNumberOf(focusedLineCell());
}

function rowOfLine(table: HTMLTableElement | null, lineNumber: number): HTMLElement | null {
  return table?.querySelector<HTMLElement>(`:scope > tbody > tr[data-line="${lineNumber}"]`) ?? null;
}

function targetRowIn(panel: HTMLElement | null): HTMLElement | null {
  return panel?.querySelector<HTMLElement>("tr.viewer-target") ?? null;
}

function isLineRow(element: EventTarget): element is HTMLTableRowElement {
  return element instanceof HTMLTableRowElement && element.dataset.line !== undefined;
}

/** The focused line becomes the table's one Tab stop. */
function moveTabStop(table: HTMLTableElement, focused: EventTarget): void {
  if (isLineRow(focused)) {
    table.querySelectorAll(':scope > tbody > tr[tabindex="0"]').forEach((row) => row.setAttribute("tabindex", "-1"));
    focused.tabIndex = 0;
  }
}

function moveFromFocusedLine(move: LineMove): void {
  const row = focusedLineCell();
  if (row) moveLineFocus(row, move);
}

/** j, k and r on a focused line of the whole file. */
function useDrawerLineKeys(table: RefObject<HTMLTableElement | null>, onUses: (lineNumber: number) => void) {
  const isOnLine = () => focusedLineNumber() !== undefined;
  const showUsesOnFocusedLine = () => {
    const lineNumber = focusedLineNumber();
    if (lineNumber) onUses(lineNumber);
  };
  useKeys("drawerLine", {
    down: { run: () => moveFromFocusedLine("down"), when: isOnLine },
    up: { run: () => moveFromFocusedLine("up"), when: isOnLine },
    uses: { run: showUsesOnFocusedLine, when: isOnLine },
  }, { within: table });
}

/** The peek and the name list under a line; closing either focuses the line again. */
function useLineHelpers(table: RefObject<HTMLTableElement | null>, view: FileView) {
  const [peek, setPeek] = useState<ReferenceQuery | null>(null);
  const [picker, setPicker] = useState<LineWords | null>(null);
  const openPeek = (word: ClickedWord, lineNumber: number) => {
    setPicker(null);
    setPeek({ ...word, file: view.file, line: lineNumber, side: "RIGHT" });
  };
  const openPicker = (words: ClickedWord[], lineNumber: number) => {
    setPeek(null);
    setPicker({ line: lineNumber, words });
  };
  const showUses = (lineNumber: number) => {
    const words = identifiersOn(view.lines[lineNumber - 1] ?? "");
    if (words.length === 1) openPeek(words[0], lineNumber);
    if (words.length > 1) openPicker(words, lineNumber);
  };
  const focusLineOf = (helper: { line: number } | null) => {
    if (helper) focusQuietly(rowOfLine(table.current, helper.line));
  };
  const closePeek = () => {
    focusLineOf(peek);
    setPeek(null);
  };
  const closePicker = () => {
    focusLineOf(picker);
    setPicker(null);
  };
  return { peek, picker, openPeek, showUses, closePeek, closePicker };
}

// - Following a name or going Back swaps the panel.
// - Focus waits on the panel until the file loads.
function useFocusKeptInPanel(panel: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (isFocusLost()) focusQuietly(panel.current);
  }, []);
}

function useTargetLineInView(targetRow: RefObject<HTMLTableRowElement | null>, view: FileView, targetLine: number) {
  useEffect(() => {
    void targetRow.current?.scrollIntoView({ block: "center" });
    focusQuietly(targetRow.current);
  }, [view, targetLine]);
}

function CodeLines({ route, view, targetLine, onOpen }: CodeLinesProps) {
  const table = useRef<HTMLTableElement>(null);
  const targetRow = useRef<HTMLTableRowElement>(null);
  const helpers = useLineHelpers(table, view);
  const language = languageForFile(view.file);
  const isCommentLine = useMemo(() => commentFlags(view.lines, view.file), [view]);
  const changedLines = useMemo(() => new Set(view.changedLines), [view]);
  useTargetLineInView(targetRow, view, targetLine);
  useDrawerLineKeys(table, helpers.showUses);

  const peekAt = (event: React.MouseEvent<HTMLElement>, lineText: string, lineNumber: number) => {
    if (!isPeekClick(event)) return;
    const clicked = wordAtClick(event, lineText);
    if (clicked) helpers.openPeek(clicked, lineNumber);
  };
  const jump = (reference: Reference) => {
    helpers.closePeek();
    onOpen({ file: reference.file, line: reference.line });
  };

  const rowClassOf = (lineNumber: number) =>
    [lineNumber === targetLine ? "viewer-target" : "", changedLines.has(lineNumber) ? "viewer-changed" : ""].join(" ");
  return (
    <table className="viewer-code" ref={table} onFocus={(event) => moveTabStop(event.currentTarget, event.target)}>
      <tbody>
        {view.lines.map((lineText, lineIndex) => {
          const lineNumber = lineIndex + 1;
          const isTarget = lineNumber === targetLine;
          return (
            <Fragment key={lineNumber}>
              <tr ref={isTarget ? targetRow : undefined} className={rowClassOf(lineNumber)} data-line={lineNumber} tabIndex={isTarget ? 0 : -1}>
                <td className="viewer-line-number">{lineNumber}</td>
                <td className="viewer-line" onClick={(event) => peekAt(event, lineText, lineNumber)}
                  dangerouslySetInnerHTML={{ __html: renderCodeLine(lineText, language, isCommentLine[lineIndex]) || " " }} />
              </tr>
              {helpers.picker?.line === lineNumber ? (
                <PickerRow words={helpers.picker.words} onPick={(word) => helpers.openPeek(word, lineNumber)} onClose={helpers.closePicker} />
              ) : null}
              {helpers.peek?.line === lineNumber ? <PeekRow route={route} query={helpers.peek} onClose={helpers.closePeek} onJump={jump} /> : null}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function PickerRow({ words, onPick, onClose }: { words: ClickedWord[]; onPick: (word: ClickedWord) => void; onClose: () => void }) {
  return (
    <tr className="viewer-peek">
      <td colSpan={2}><WordPicker words={words} onPick={onPick} onClose={onClose} /></td>
    </tr>
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
  const panel = useRef<HTMLElement>(null);
  useLayer(panel, { isOpen: target !== undefined, onClose: viewer.close, initialFocus: () => targetRowIn(panel.current), scope: "drawer" });
  if (!target) return null;
  return <FileViewerPanel key={`${target.file}:${target.line}`} route={route} target={target} viewer={viewer} panel={panel} />;
}

type FileViewerPanelProps = { route: PrRoute; target: FileTarget; viewer: FileViewerControls; panel: RefObject<HTMLElement | null> };

function FileViewerPanel({ route, target, viewer, panel }: FileViewerPanelProps) {
  const { view, error } = useFileView(route, target.file);
  const changedCount = view?.changedLines.length ?? 0;
  useFocusKeptInPanel(panel);
  return (
    <>
      <div className="viewer-backdrop" onClick={viewer.close} />
      <aside className="viewer" ref={panel} role="dialog" aria-modal="true" aria-label={`File ${target.file}`}>
        <header className="viewer-header">
          <button disabled={!viewer.canGoBack} onClick={viewer.back} title="Back"><Icon name="arrowLeft" /></button>
          <div className="viewer-title">
            <div className="mono">{target.file}<span className="muted">:{target.line}</span></div>
            <div className="small muted">
              {changedCount > 0 ? <><span className="legend-swatch changed" /> {changedCount} lines changed by this PR · </> : "This PR does not change this file · "}
              Ctrl+click a name, or press r on a line, to follow it
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
