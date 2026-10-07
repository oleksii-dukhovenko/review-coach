import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { api, type PrRoute, type Reference, type ReferenceQuery, type ReferenceSearch, type Snippet } from "../api.ts";
import { commentFlags } from "./commentLines.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";
import { Icon } from "./Icon.tsx";

type PeekProps = {
  route: PrRoute;
  query: ReferenceQuery;
  onClose: () => void;
  onJump: (reference: Reference) => void;
  // - Button text; by default it says where the jump lands.
  goLabel?: string;
};

type FileGroup = { file: string; references: Reference[] };

type Section = { title: string; hint: string; groups: FileGroup[] };

function groupByFile(references: Reference[], fromFile: string): FileGroup[] {
  const groups = new Map<string, Reference[]>();
  for (const reference of references) groups.set(reference.file, [...(groups.get(reference.file) ?? []), reference]);
  const ordered = [...groups.entries()].map(([file, fileReferences]) => ({ file, references: fileReferences }));
  return ordered.sort((left, right) => Number(right.file === fromFile) - Number(left.file === fromFile));
}

function isDefinition(reference: Reference): boolean {
  return reference.isDefinition;
}

function isUseThisPrChanged(reference: Reference): boolean {
  return !reference.isDefinition && reference.isChangedInPr;
}

function isOtherUse(reference: Reference): boolean {
  return !reference.isDefinition && !reference.isChangedInPr;
}

/** Where it is defined, where this PR touches it, then everywhere else. */
function sectionsOf(references: Reference[], fromFile: string): Section[] {
  const sections = [
    { title: "Defined at", hint: "Where this name is created", references: references.filter(isDefinition) },
    { title: "Used in this PR's changes", hint: "Lines this PR adds or changes", references: references.filter(isUseThisPrChanged) },
    { title: "Other uses", hint: "Code this PR did not change", references: references.filter(isOtherUse) },
  ];
  return sections.filter((section) => section.references.length > 0).map((section) => ({ ...section, groups: groupByFile(section.references, fromFile) }));
}

function inDisplayOrder(sections: Section[]): Reference[] {
  return sections.flatMap((section) => section.groups.flatMap((group) => group.references));
}

function startingIndex(references: Reference[], query: ReferenceQuery): number {
  const clickedLine = references.findIndex((reference) => reference.file === query.file && reference.line === query.line);
  return Math.max(clickedLine, 0);
}

function splitPath(file: string): { name: string; folder: string } {
  const slash = file.lastIndexOf("/");
  return { name: file.slice(slash + 1), folder: slash === -1 ? "" : file.slice(0, slash) };
}

const LEAD_CHARS = 24;

/** The first word start at or after index, but never past the match. */
function wordStartAfter(text: string, index: number, matchIndex: number): number {
  const nextSpace = text.indexOf(" ", index);
  const isUsable = nextSpace !== -1 && nextSpace < matchIndex;
  return isUsable ? nextSpace + 1 : index;
}

/** Starts long lines near the word so the match stays visible. */
function startNear(text: string, wordIndex: number): { shown: string; offset: number } {
  const indent = text.length - text.trimStart().length;
  const start = wordIndex - indent <= LEAD_CHARS ? indent : wordStartAfter(text, wordIndex - LEAD_CHARS, wordIndex);
  return { shown: `${start > indent ? "…" : ""}${text.slice(start).trimEnd()}`, offset: start - (start > indent ? 1 : 0) };
}

function firstWholeWord(text: string, word: string): number {
  return text.search(new RegExp(`(?<![\\w$])${word.replace(/\$/g, "\\$")}(?![\\w$])`));
}

/** Marks the exact use when known, else the first whole-word match. */
function MarkedText({ reference, word }: { reference: Reference; word: string }) {
  const wordIndex = reference.column ?? firstWholeWord(reference.text, word);
  if (wordIndex < 0) return <>{reference.text.trim()}</>;
  const { shown, offset } = startNear(reference.text, wordIndex);
  const markAt = wordIndex - offset;
  return <>{shown.slice(0, markAt)}<mark>{shown.slice(markAt, markAt + word.length)}</mark>{shown.slice(markAt + word.length)}</>;
}

/** Scrolls a pane to an element without moving the page. */
function centerWithin(pane: HTMLElement | null, element: HTMLElement | null) {
  if (!pane || !element) return;
  const elementTop = element.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  pane.scrollTop = elementTop - pane.clientHeight / 2 + element.clientHeight / 2;
}

function useSnippet(route: PrRoute, reference: Reference | undefined): Snippet | undefined {
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

function goLabelFor(reference: Reference): string {
  return reference.isInPage ? "Go to it in the diff" : "Open the file";
}

function Preview({ snippet, selected, goLabel, onJump }: {
  snippet: Snippet | undefined; selected: Reference | undefined; goLabel: string | undefined; onJump: (reference: Reference) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const targetRow = useRef<HTMLTableRowElement>(null);
  const targetLine = selected?.line ?? 0;
  useEffect(() => {
    centerWithin(pane.current, targetRow.current);
  }, [snippet, targetLine]);
  if (!snippet || !selected) return <div className="peek-preview muted small" style={{ padding: 10 }}>Loading...</div>;
  const language = languageForFile(snippet.file);
  const isCommentLine = commentFlags(snippet.lines, snippet.file);
  return (
    <div className="peek-preview-wrap">
      <div className="peek-preview-bar">
        <span className="mono small peek-preview-path" title={snippet.file}>{snippet.file.split("/").at(-1)}:{targetLine}</span>
        <button className="primary small-button" onClick={() => onJump(selected)}>
          {goLabel ?? goLabelFor(selected)} <Icon name="arrowRight" size={14} />
        </button>
      </div>
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
    </div>
  );
}

function ReferenceRow({ reference, word, isSelected, rowRef, onSelect, onJump }: {
  reference: Reference; word: string; isSelected: boolean; rowRef: React.Ref<HTMLDivElement> | undefined;
  onSelect: (reference: Reference) => void; onJump: (reference: Reference) => void;
}) {
  return (
    <div ref={rowRef} title="Click again to go there" className={`peek-item ${isSelected ? "selected" : ""}`}
      onClick={() => (isSelected ? onJump(reference) : onSelect(reference))} onDoubleClick={() => onJump(reference)}>
      <span className="peek-item-line">{reference.line}</span>
      <span className="peek-item-text"><MarkedText reference={reference} word={word} /></span>
    </div>
  );
}

function ReferenceList({ sections, word, selected, onSelect, onJump }: {
  sections: Section[]; word: string; selected: Reference | undefined; onSelect: (reference: Reference) => void; onJump: (reference: Reference) => void;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const selectedRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    centerWithin(pane.current, selectedRow.current);
  }, [selected]);
  return (
    <div className="peek-list" ref={pane}>
      {sections.map((section) => (
        <div key={section.title}>
          <div className="peek-section" title={section.hint}>{section.title}</div>
          {section.groups.map((group) => {
            const { name, folder } = splitPath(group.file);
            return (
              <div key={group.file}>
                <div className="peek-file" title={group.file}>
                  <Icon name="file" size={13} />
                  <span>{name}</span>
                  <span className="peek-folder">{folder}</span>
                  <span className="peek-count">{group.references.length}</span>
                </div>
                {group.references.map((reference) => (
                  <ReferenceRow key={reference.line} reference={reference} word={word} isSelected={reference === selected}
                    rowRef={reference === selected ? selectedRow : undefined} onSelect={onSelect} onJump={onJump} />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function countText(search: ReferenceSearch): string {
  const count = `${search.total} place${search.total === 1 ? "" : "s"}`;
  const shown = search.references.length < search.total ? `, first ${search.references.length} shown` : "";
  return `${count}${shown}`;
}

function PrecisionChip({ search }: { search: ReferenceSearch }) {
  if (search.precision === "exact") {
    return <span className="chip ready" title="A language server followed this exact name through the code">Exact match, from {search.engine}</span>;
  }
  return <span className="chip unsure" title="Every line with the same word, in any scope">Name match only</span>;
}

/** VS Code-style peek: preview on the left, places on the right. */
export function PeekReferences({ route, query, onClose, onJump, goLabel }: PeekProps) {
  const [search, setSearch] = useState<ReferenceSearch>();
  const [error, setError] = useState<string>();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
    api.references(route, query).then(
      (found) => {
        setSearch(found);
        setSelectedIndex(startingIndex(inDisplayOrder(sectionsOf(found.references, query.file)), query));
      },
      (searchError: Error) => setError(searchError.message),
    );
  }, [query.word, query.file, query.line, query.column]);

  const sections = search ? sectionsOf(search.references, query.file) : [];
  const orderedReferences = inDisplayOrder(sections);
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
    event.stopPropagation();
    action();
  };

  return (
    <div className="peek" ref={panel} tabIndex={0} onKeyDown={handleKey}>
      <div className="peek-header">
        <span className="peek-title">
          <strong className="mono">{query.word}</strong>
          <span className="muted">{search ? countText(search) : "Finding where this is used..."}</span>
          {search ? <PrecisionChip search={search} /> : null}
        </span>
        <span className="muted small">↑↓ move · Enter go · Esc close <button className="peek-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button></span>
      </div>
      {search?.note ? <div className="peek-note small">{search.note}</div> : null}
      {error ? <div className="banner error" style={{ margin: 8 }}>{error}</div> : null}
      {search && search.total === 0 ? <div className="muted small" style={{ padding: 10 }}>No uses found in this PR's code.</div> : null}
      {search && search.total > 0 ? (
        <div className="peek-body">
          <Preview snippet={snippet} selected={selected} goLabel={goLabel} onJump={onJump} />
          <ReferenceList sections={sections} word={query.word} selected={selected}
            onSelect={(reference) => setSelectedIndex(orderedReferences.indexOf(reference))} onJump={onJump} />
        </div>
      ) : null}
    </div>
  );
}
