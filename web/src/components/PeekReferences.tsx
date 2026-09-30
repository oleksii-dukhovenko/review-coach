import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { api, type PrRoute, type ReferenceSearch, type Snippet, type SymbolUse } from "../api.ts";
import { commentFlags } from "./commentLines.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";

type PeekProps = {
  route: PrRoute;
  word: string;
  fromFile: string;
  fromLine: number;
  onClose: () => void;
  onJump: (reference: SymbolUse) => void;
};

type FileGroup = { file: string; references: SymbolUse[] };

function groupByFile(references: SymbolUse[], fromFile: string): FileGroup[] {
  const groups = new Map<string, SymbolUse[]>();
  for (const reference of references) groups.set(reference.file, [...(groups.get(reference.file) ?? []), reference]);
  const ordered = [...groups.entries()].map(([file, fileReferences]) => ({ file, references: fileReferences }));
  return ordered.sort((left, right) => Number(right.file === fromFile) - Number(left.file === fromFile));
}

function startingIndex(references: SymbolUse[], fromFile: string, fromLine: number): number {
  const clickedLine = references.findIndex((reference) => reference.file === fromFile && reference.line === fromLine);
  return Math.max(clickedLine, 0);
}

function splitPath(file: string): { name: string; folder: string } {
  const slash = file.lastIndexOf("/");
  return { name: file.slice(slash + 1), folder: slash === -1 ? "" : file.slice(0, slash) };
}

const LEAD_CHARS = 24;

/** Starts long lines near the word so the match stays visible. */
function textNearWord(text: string, word: string): string {
  const trimmed = text.trim();
  const wordIndex = trimmed.indexOf(word);
  if (wordIndex <= LEAD_CHARS) return trimmed;
  return `…${trimmed.slice(wordIndex - LEAD_CHARS)}`;
}

/** Wraps each whole-word match in <mark>. */
function MarkedText({ text, word }: { text: string; word: string }) {
  const parts = textNearWord(text, word).split(new RegExp(`(?<![\\w$])(${word.replace(/\$/g, "\\$")})(?![\\w$])`));
  return <>{parts.map((part, partIndex) => (part === word ? <mark key={partIndex}>{part}</mark> : part))}</>;
}

/** Scrolls a pane to an element without moving the page. */
function centerWithin(pane: HTMLElement | null, element: HTMLElement | null) {
  if (!pane || !element) return;
  const elementTop = element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  pane.scrollTop = elementTop - pane.clientHeight / 2 + element.clientHeight / 2;
}

function useSnippet(route: PrRoute, reference: SymbolUse | undefined): Snippet | undefined {
  const cache = useRef(new Map<string, Snippet>());
  const [snippet, setSnippet] = useState<Snippet>();
  useEffect(() => {
    if (!reference) return;
    const cacheKey = `${reference.file}:${reference.line}`;
    const cached = cache.current.get(cacheKey);
    if (cached) {
      setSnippet(cached);
      return;
    }
    void api.snippet(route, reference.file, reference.line).then((loaded) => {
      cache.current.set(cacheKey, loaded);
      setSnippet(loaded);
    });
  }, [reference?.file, reference?.line]);
  return snippet;
}

function Preview({ snippet, targetLine }: { snippet: Snippet | undefined; targetLine: number }) {
  const pane = useRef<HTMLDivElement>(null);
  const targetRow = useRef<HTMLTableRowElement>(null);
  useEffect(() => centerWithin(pane.current, targetRow.current), [snippet, targetLine]);
  if (!snippet) return <div className="peek-preview muted small" style={{ padding: 10 }}>Loading...</div>;
  const language = languageForFile(snippet.file);
  const isCommentLine = commentFlags(snippet.lines, snippet.file);
  return (
    <div className="peek-preview" ref={pane}>
      <table>
        <tbody>
          {snippet.lines.map((lineText, lineIndex) => {
            const lineNumber = snippet.startLine + lineIndex;
            return (
              <tr key={lineNumber} ref={lineNumber === targetLine ? targetRow : undefined} className={lineNumber === targetLine ? "peek-target" : ""}>
                <td className="peek-line-number">{lineNumber}</td>
                <td className="peek-code" dangerouslySetInnerHTML={{ __html: renderCodeLine(lineText, language, isCommentLine[lineIndex]) || " " }} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReferenceList({ groups, word, selected, onSelect, onJump }: {
  groups: FileGroup[]; word: string; selected: SymbolUse | undefined; onSelect: (reference: SymbolUse) => void; onJump: (reference: SymbolUse) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => centerWithin(pane.current, selectedRow.current), [selected]);
  return (
    <div className="peek-list" ref={pane}>
      {groups.map((group) => {
        const { name, folder } = splitPath(group.file);
        return (
          <div key={group.file}>
            <div className="peek-file" title={group.file}>
              <span>{name}</span>
              <span className="peek-folder">{folder}</span>
              <span className="peek-count">{group.references.length}</span>
            </div>
            {group.references.map((reference) => {
              const isSelected = reference === selected;
              return (
                <div key={reference.line} ref={isSelected ? selectedRow : undefined} title="Click again to jump there"
                  className={`peek-item ${isSelected ? "selected" : ""}`}
                  onClick={() => (isSelected ? onJump(reference) : onSelect(reference))} onDoubleClick={() => onJump(reference)}>
                  <span className="peek-item-line">{reference.line}</span>
                  <span className="peek-item-text"><MarkedText text={reference.text} word={word} /></span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function headerText(search: ReferenceSearch): string {
  const count = `${search.total} reference${search.total === 1 ? "" : "s"}`;
  const shown = search.references.length < search.total ? `, first ${search.references.length} shown` : "";
  return `${count}${shown}`;
}

/** VS Code-style peek: preview on the left, matches on the right. */
export function PeekReferences({ route, word, fromFile, fromLine, onClose, onJump }: PeekProps) {
  const [search, setSearch] = useState<ReferenceSearch>();
  const [error, setError] = useState<string>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus();
    api.references(route, word, fromFile).then(
      (found) => {
        setSearch(found);
        setSelectedIndex(startingIndex(found.references, fromFile, fromLine));
      },
      (searchError: Error) => setError(searchError.message),
    );
  }, [word, fromFile, fromLine]);

  const groups = search ? groupByFile(search.references, fromFile) : [];
  const orderedReferences = groups.flatMap((group) => group.references);
  const selected = orderedReferences[selectedIndex];
  const snippet = useSnippet(route, selected);

  const moveSelection = (step: number) =>
    setSelectedIndex((current) => Math.min(Math.max(current + step, 0), orderedReferences.length - 1));

  const handleKey = (event: KeyboardEvent) => {
    const jumpToSelected = () => selected && onJump(selected);
    const actions: Record<string, () => void> = {
      ArrowDown: () => moveSelection(1), ArrowUp: () => moveSelection(-1), Enter: jumpToSelected, Escape: onClose,
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  return (
    <div className="peek" ref={panel} tabIndex={0} onKeyDown={handleKey}>
      <div className="peek-header">
        <span>
          <strong className="mono">{word}</strong>
          <span className="muted"> {search ? headerText(search) : "searching..."}</span>
          {search?.onlySameFolder ? <span className="muted"> (this folder only: private Go name)</span> : null}
        </span>
        <span className="muted small">↑↓ to move, Enter or click again to jump, Esc to close <button className="peek-close" onClick={onClose} aria-label="Close">×</button></span>
      </div>
      {error ? <div className="banner error" style={{ margin: 8 }}>{error}</div> : null}
      {search && search.total === 0 ? <div className="muted small" style={{ padding: 10 }}>No matches in this PR's code.</div> : null}
      {search && search.total > 0 ? (
        <div className="peek-body">
          <Preview snippet={snippet} targetLine={selected?.line ?? 0} />
          <ReferenceList groups={groups} word={word} selected={selected}
            onSelect={(reference) => setSelectedIndex(orderedReferences.indexOf(reference))} onJump={onJump} />
        </div>
      ) : null}
    </div>
  );
}
