import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type AutoPrepare, type Inbox, type InboxRow, type MyPrSection } from "../api.ts";
import { AutoUpdateToggle } from "../components/AutoUpdateToggle.tsx";
import { ErrorBanner } from "../components/basics.tsx";
import { BrandMark } from "../components/BrandMark.tsx";
import { Icon } from "../components/Icon.tsx";
import { KeyHelpButton } from "../components/KeyHelp.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { closeMenuOnFocusLeave, UpdateNotice, useVersion, VersionLine, type VersionState } from "../components/UpdateNotice.tsx";
import { Working } from "../components/Working.tsx";
import { afterRender } from "../essay/session.ts";
import {
  isReadyToRead, matchesQuery, matchesShow, nextShow, rowsOfSection, timeAgo, type InboxSectionKey, type InboxShow,
} from "../inboxView.ts";
import { focusQuietly, isFocusLost, keepCursor, moveCursor, useKeys, type CursorMove, type KeyHandler } from "../keys.ts";

const REFRESH_VIEW_MS = 15_000;
const SECTION_KEY = "review-coach:inbox-section";
const LAST_ROW_KEY = "review-coach:last-row";
// - The size bar is full at this many changed lines.
const FULL_SIZE_LINES = 600;

const STATUS_LABEL = {
  none: "Not prepared",
  queued: "Waiting",
  building: "Preparing",
  ready: "Ready",
  failed: "Failed",
} as const;

function isInProgress(row: InboxRow): boolean {
  return row.status === "building" || row.status === "queued";
}

function StatusChip({ row }: { row: InboxRow }) {
  if (row.isOutOfDate) return <span className="chip stale">Out of date</span>;
  if (row.status === "building") return <span className="chip building is-working"><Working size={12}>Preparing</Working></span>;
  if (row.status === "queued") return <span className="chip queued is-working"><Working size={12}>Waiting</Working></span>;
  return <span className={`chip ${row.status}`}>{STATUS_LABEL[row.status]}</span>;
}

function prepareLabel(row: InboxRow): string | null {
  if (row.isOutOfDate) return "Update";
  if (row.status === "failed") return "Retry";
  if (row.status === "none") return "Prepare";
  return null;
}

function prHash(row: InboxRow): string {
  return `#/pr/${row.owner}/${row.repo}/${row.number}`;
}

function isOnControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest("a, button, input, label, summary, details") !== null;
}

// - The last opened row, so browser Back lands on it again.

function rememberLastRow(key: string): void {
  try {
    sessionStorage.setItem(LAST_ROW_KEY, key);
  } catch {
    // - Private windows may refuse storage; Back then starts at the top.
  }
}

function lastRowKey(): string | null {
  try {
    return sessionStorage.getItem(LAST_ROW_KEY);
  } catch {
    return null;
  }
}

function openPr(row: InboxRow): void {
  rememberLastRow(row.key);
  window.location.hash = prHash(row);
}

function openOnGitHub(row: InboxRow): void {
  window.open(row.url, "_blank", "noreferrer");
}

// - Focus on a row, found by its key.

function rowElementOf(key: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(".inbox-row")].find((rowElement) => rowElement.dataset.key === key);
}

/** Focuses the row's title link and scrolls the row into view. */
function focusRow(key: string | undefined): void {
  const rowElement = key === undefined ? undefined : rowElementOf(key);
  if (!rowElement) return;
  focusQuietly(rowElement.querySelector(".inbox-title"));
  rowElement.scrollIntoView({ block: "nearest" });
}

type NextStepProps = { row: InboxRow; tabIndex: number; onPrepare: (row: InboxRow) => void };

/** The one thing to do next: read it, or prepare it. */
function NextStep({ row, tabIndex, onPrepare }: NextStepProps) {
  const label = prepareLabel(row);
  if (label) return <button tabIndex={tabIndex} onClick={() => onPrepare(row)}>{label}</button>;
  if (!isReadyToRead(row)) return null;
  return (
    <a className="button-link primary" href={prHash(row)} tabIndex={tabIndex} onClick={() => rememberLastRow(row.key)}>
      {row.kind === "review" ? "Read" : "Open"}
    </a>
  );
}

/** Auto-update and the GitHub link, folded behind ... so the row stays quiet. */
function RowMenu({ row, tabIndex }: { row: InboxRow; tabIndex: number }) {
  return (
    <details className="row-menu" onBlur={closeMenuOnFocusLeave}>
      <summary aria-label={`More for ${row.title}`} title="More" tabIndex={tabIndex}><Icon name="more" size={18} /></summary>
      <div className="menu">
        <AutoUpdateToggle route={row} isOn={row.autoUpdate} />
        <a href={row.url} target="_blank" rel="noreferrer"><Icon name="github" size={15} /> Open on GitHub</a>
      </div>
    </details>
  );
}

function SizeCell({ row }: { row: InboxRow }) {
  const total = Math.max(1, row.additions + row.deletions);
  const scale = Math.min(1, total / FULL_SIZE_LINES);
  const width = (lines: number) => `${Math.round((lines / total) * scale * 100)}%`;
  return (
    <div className="inbox-size" title={`${row.additions} lines added, ${row.deletions} removed`}>
      <span><span className="added-count">+{row.additions}</span> <span className="deleted-count">−{row.deletions}</span></span>
      <span className="size-bar" aria-hidden="true"><span className="size-add" style={{ width: width(row.additions) }} /><span className="size-del" style={{ width: width(row.deletions) }} /></span>
    </div>
  );
}

function UpdatedTime({ isoTime }: { isoTime: string }) {
  const fullDate = new Date(isoTime).toLocaleString();
  return <time dateTime={isoTime} title={fullDate} aria-label={`Updated ${fullDate}`}>{timeAgo(isoTime)}</time>;
}

function ThreadCount({ count }: { count: number }) {
  const label = `${count} comment${count === 1 ? "" : "s"} waiting`;
  return (
    <span className="inbox-threads" title={label}>
      <Icon name="message" size={14} /> <span aria-hidden="true">{count}</span>
      <span className="visually-hidden">{label}</span>
    </span>
  );
}

function RowMeta({ row }: { row: InboxRow }) {
  return (
    <div className="inbox-meta">
      <span className="mono">{row.repo} #{row.number}</span>
      {row.kind === "review" ? <span>{row.author}</span> : null}
      <UpdatedTime isoTime={row.updatedAt} />
      {row.isDraft ? <span className="chip">Draft</span> : null}
      {row.openThreadCount > 0 ? <ThreadCount count={row.openThreadCount} /> : null}
    </div>
  );
}

function FailedReason({ row }: { row: InboxRow }) {
  const hasReason = row.status === "failed" && Boolean(row.error);
  return hasReason ? <div className="inbox-error">{row.error}</div> : null;
}

type RowActions = { onPrepare: (row: InboxRow) => void; onSelect: (key: string) => void };
type RowCursor = { cursorKey: string | undefined; tabStopKey: string | undefined };

/** The whole row opens the PR, except its own buttons and links. */
// - Only the tab stop row's controls are in the Tab order.
function InboxRowView({ row, cursor, actions }: { row: InboxRow; cursor: RowCursor; actions: RowActions }) {
  const openRow = (event: React.MouseEvent) => {
    if (!isOnControl(event.target)) openPr(row);
  };
  const isCursor = cursor.cursorKey === row.key;
  const tabIndex = cursor.tabStopKey === row.key ? 0 : -1;
  return (
    <div className={`inbox-row ${isCursor ? "is-cursor" : ""}`} data-key={row.key} onClick={openRow} onFocus={() => actions.onSelect(row.key)}>
      <div className="inbox-main">
        <a className="inbox-title" href={prHash(row)} tabIndex={tabIndex} onClick={() => rememberLastRow(row.key)}>
          {row.title}
        </a>
        <RowMeta row={row} />
        <FailedReason row={row} />
      </div>
      <SizeCell row={row} />
      <div className="inbox-status"><StatusChip row={row} /></div>
      <div className="inbox-next">
        <NextStep row={row} tabIndex={tabIndex} onPrepare={actions.onPrepare} />
        <RowMenu row={row} tabIndex={tabIndex} />
      </div>
    </div>
  );
}

function InboxTable({ rows, emptyText, cursor, actions }: { rows: InboxRow[]; emptyText: string; cursor: RowCursor; actions: RowActions }) {
  if (rows.length === 0) return <div className="inbox-empty">{emptyText}</div>;
  return (
    <div className="inbox-table">
      <div className="inbox-head" aria-hidden="true">
        <span>Pull request</span><span>Size</span><span>Status</span><span className="inbox-head-next">Next step</span>
      </div>
      {rows.map((row) => <InboxRowView key={row.key} row={row} cursor={cursor} actions={actions} />)}
    </div>
  );
}

type SectionInfo = { key: InboxSectionKey; title: string; hint: string; empty: string };

const REVIEW_SECTION: SectionInfo = { key: "review", title: "Review requests", hint: "", empty: "Nobody is waiting on your review." };

const MY_SECTIONS: (SectionInfo & { key: MyPrSection })[] = [
  { key: "waiting-on-me", title: "Waiting on you", hint: "Comments or requested changes to answer.", empty: "No comments are waiting on you." },
  { key: "draft", title: "Drafts to finish", hint: "Not ready for review yet.", empty: "You have no drafts." },
  { key: "no-reviewer", title: "No reviewer yet", hint: "Ready, but nobody is asked to review.", empty: "Every ready PR of yours has a reviewer." },
  { key: "approved", title: "Approved", hint: "Ready to merge.", empty: "Nothing approved and waiting to merge." },
  { key: "waiting-on-others", title: "Waiting on others", hint: "Reviewers have it. Nothing for you to do.", empty: "Nothing is waiting on reviewers." },
];

const ALL_SECTIONS = [REVIEW_SECTION, ...MY_SECTIONS];

function sectionInfo(key: InboxSectionKey): SectionInfo {
  return ALL_SECTIONS.find((section) => section.key === key) ?? REVIEW_SECTION;
}

function savedSection(): InboxSectionKey {
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    return ALL_SECTIONS.some((section) => section.key === saved) ? (saved as InboxSectionKey) : "review";
  } catch {
    return "review";
  }
}

function saveSection(key: InboxSectionKey): void {
  try {
    localStorage.setItem(SECTION_KEY, key);
  } catch {
    // - Private windows may refuse storage; the choice still applies until reload.
  }
}

function reviewSummary(rows: InboxRow[]): string {
  if (rows.length === 0) return "Nobody is waiting on your review.";
  const ready = rows.filter(isReadyToRead).length;
  const waiting = rows.length === 1 ? "1 PR is waiting on your review." : `${rows.length} PRs are waiting on your review.`;
  return ready ? `${waiting} ${ready} ${ready === 1 ? "is" : "are"} ready to read.` : waiting;
}

function NavItem({ section, count, isChosen, onPick }: { section: SectionInfo; count: number; isChosen: boolean; onPick: () => void }) {
  return (
    <button className={`nav-item ${isChosen ? "is-chosen" : ""}`} aria-current={isChosen ? "page" : undefined} onClick={onPick}>
      {section.key === "review" ? null : <span className={`nav-dot dot-${section.key}`} aria-hidden="true" />}
      <span className="nav-label">{section.title}</span>
      <span className="nav-count">{count}</span>
    </button>
  );
}

const AUTO_PREPARE_OPTIONS: { mode: AutoPrepare; label: string; hint: string }[] = [
  { mode: "off", label: "Nothing", hint: "Claude runs only when you click Prepare." },
  { mode: "reviews", label: "PRs I review", hint: "Other people's PRs you are asked to review." },
  { mode: "all", label: "PRs I review + my drafts & comments", hint: "Also your drafts, and your PRs with comments you need to answer." },
];

function isRadio(target: EventTarget): boolean {
  return target instanceof HTMLInputElement && target.type === "radio";
}

/** The choices, held here until Save, so an arrow key alone never changes the setting. */
// - Enter on a choice saves; Escape cancels.
function AutoPrepareOptions({ mode, onSave, onCancel }: { mode: AutoPrepare; onSave: (mode: AutoPrepare) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState(mode);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => void focusQuietly(group.current?.querySelector("input:checked")), []);
  const handleKey = (event: React.KeyboardEvent) => {
    const isSaveKey = event.key === "Enter" && isRadio(event.target);
    const isCancelKey = event.key === "Escape";
    if (isSaveKey) onSave(picked);
    if (isCancelKey) onCancel();
    if (isSaveKey || isCancelKey) event.preventDefault();
  };
  return (
    <div onKeyDown={handleKey}>
      <div ref={group} className="auto-prepare-options" role="radiogroup" aria-label="Prepare on its own">
        {AUTO_PREPARE_OPTIONS.map((option) => (
          <label key={option.mode} className="radio">
            <input type="radio" name="auto-prepare" checked={picked === option.mode} onChange={() => setPicked(option.mode)} />
            <span className="dot" />
            {option.label}
          </label>
        ))}
      </div>
      <div className="auto-prepare-actions">
        <button className="link-button" onClick={() => onSave(picked)}>Save</button>
        <button className="link-button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** How much gets prepared without a click, since each walkthrough uses Claude tokens. */
function AutoPrepareSetting({ mode, onChange }: { mode: AutoPrepare; onChange: (mode: AutoPrepare) => void }) {
  const [isChanging, setIsChanging] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const chosen = AUTO_PREPARE_OPTIONS.find((option) => option.mode === mode);
  const close = () => {
    setIsChanging(false);
    afterRender(() => focusQuietly(changeButton.current));
  };
  const save = (next: AutoPrepare) => {
    if (next !== mode) onChange(next);
    close();
  };
  return (
    <div className="auto-prepare">
      <div className="small muted">Prepare on its own</div>
      {isChanging ? <AutoPrepareOptions mode={mode} onSave={save} onCancel={close} /> : (
        <>
          <div className="auto-prepare-choice">{chosen?.label}</div>
          <div className="small muted">{chosen?.hint}</div>
          <button ref={changeButton} className="link-button" onClick={() => setIsChanging(true)}>Change</button>
        </>
      )}
    </div>
  );
}

/** Names what Claude is preparing right now, so you know the inbox is busy. */
function PreparingNote({ rows }: { rows: InboxRow[] }) {
  const building = rows.find((row) => row.status === "building");
  const waitingCount = rows.filter((row) => row.status === "queued").length;
  if (!building && waitingCount === 0) return null;
  return (
    <div className="preparing-note">
      <Working>{building ? <>Preparing <strong>{building.title}</strong></> : "Starting the next one"}</Working>
      <span>{building ? "This takes a few minutes." : null}{waitingCount ? ` ${waitingCount} more waiting, one at a time.` : null}</span>
    </div>
  );
}

function PausedBanner({ onResume }: { onResume: () => void }) {
  return (
    <div className="banner">
      <span>Preparing is paused because Claude hit a usage limit.</span>
      <button onClick={onResume}>Retry now</button>
    </div>
  );
}

const SHOW_OPTIONS: { show: InboxShow; label: string }[] = [
  { show: "all", label: "All" },
  { show: "ready", label: "Ready" },
  { show: "unprepared", label: "Not prepared" },
];

function ShowPicker({ show, onChange }: { show: InboxShow; onChange: (show: InboxShow) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Show">
      {SHOW_OPTIONS.map((option) => (
        <label key={option.show} className="seg-opt">
          <input type="radio" name="inbox-show" checked={show === option.show} onChange={() => onChange(option.show)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** Closes an open ... menu on a click elsewhere. */
function useMenusClose() {
  useEffect(() => {
    const closeOthers = (keep: Element | null) =>
      document.querySelectorAll("details.row-menu[open]").forEach((menu) => menu !== keep && menu.removeAttribute("open"));
    const onClick = (event: MouseEvent) => closeOthers(event.target instanceof Element ? event.target.closest("details.row-menu") : null);
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

function openMenuElement(): HTMLDetailsElement | null {
  return document.querySelector("details.row-menu[open]");
}

/** Closes the open row menu or update panel, and focuses its button. */
function closeOpenMenu(): void {
  const menu = openMenuElement();
  if (!menu) return;
  menu.removeAttribute("open");
  focusQuietly(menu.querySelector("summary"));
}

function checkedAt(inbox: Inbox | null): string | null {
  if (!inbox?.lastPollAt) return null;
  return `Checked GitHub at ${new Date(inbox.lastPollAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

type FilterBox = {
  input: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (query: string) => void;
  onKey: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

function TopBar({ inbox, filter, isRefreshing, onRefresh, version }: {
  inbox: Inbox | null; filter: FilterBox; isRefreshing: boolean; onRefresh: () => void; version: VersionState;
}) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#/" className="brand"><BrandMark /> Review Coach</a>
        <label className="filter-box">
          <Icon name="search" size={16} />
          <input ref={filter.input} type="search" value={filter.query} placeholder="Filter by title, repo or author" aria-label="Filter pull requests"
            onChange={(event) => filter.onQuery(event.target.value)} onKeyDown={filter.onKey} />
          <kbd>/</kbd>
        </label>
        <span className="topbar-spacer" />
        <UpdateNotice version={version} />
        <span className="small muted topbar-checked">{isRefreshing ? "Checking GitHub..." : checkedAt(inbox)}</span>
        <button className="icon-button" aria-disabled={isRefreshing} onClick={onRefresh} aria-label="Check GitHub now" title="Check GitHub now">
          <Icon name="refresh" size={16} />
        </button>
        <KeyHelpButton />
        <ThemePicker />
      </div>
    </header>
  );
}

/** The selected row, kept by key so the 15 s reload does not move it. */
function useRowCursor(shownKeys: string[]) {
  const [cursorKey, setCursorKey] = useState<string | undefined>();
  const [previousKeys, setPreviousKeys] = useState(shownKeys);
  const hasListChanged = previousKeys.join("\n") !== shownKeys.join("\n");
  // - Settles during render; focus never sees a stale cursor.
  if (hasListChanged) {
    setPreviousKeys(shownKeys);
    setCursorKey(keepCursor(previousKeys, cursorKey, shownKeys));
  }
  const isCursorShown = cursorKey !== undefined && shownKeys.includes(cursorKey);
  const tabStopKey = isCursorShown ? cursorKey : shownKeys[0];
  const latestTabStop = useRef(tabStopKey);
  useLayoutEffect(() => {
    latestTabStop.current = tabStopKey;
  });
  const select = (key: string | undefined) => {
    setCursorKey(key);
    focusRow(key);
  };
  const move = (step: CursorMove) => select(moveCursor(shownKeys, cursorKey, step));
  // - Focus drops when a row loses its button or leaves the list.
  const refocus = () => {
    if (isFocusLost()) focusRow(latestTabStop.current);
  };
  return { cursorKey, tabStopKey, setCursorKey, select, move, refocus };
}

type RowCursorState = ReturnType<typeof useRowCursor>;

/** After the first load, selects the row opened last, so browser Back lands on it. */
function useLastRowRestore(isLoaded: boolean, shownKeys: string[], cursor: RowCursorState) {
  useEffect(() => {
    const lastKey = lastRowKey();
    const isLastRowShown = lastKey !== null && shownKeys.includes(lastKey);
    // - Typing in the filter while loading keeps focus there.
    if (isLoaded && isLastRowShown && isFocusLost()) cursor.select(lastKey);
  }, [isLoaded]);
}

/** Keys the filter box keeps: Down and Enter go to the list, Escape clears. */
function filterKeyHandler(query: string, shownRows: InboxRow[], cursor: RowCursorState, onQuery: (query: string) => void) {
  const goToFirstRow = () => {
    if (shownRows.length > 0) cursor.select(shownRows[0].key);
  };
  const actions: Record<string, () => void> = {
    ArrowDown: goToFirstRow,
    Enter: () => (shownRows.length === 1 ? openPr(shownRows[0]) : goToFirstRow()),
    Escape: () => (query === "" ? focusRow(cursor.tabStopKey) : onQuery("")),
  };
  return (event: React.KeyboardEvent<HTMLInputElement>) => {
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    const action = actions[event.key];
    if (!action || hasModifier || event.nativeEvent.isComposing) return;
    event.preventDefault();
    action();
  };
}

/** Runs only while a row is selected; otherwise the key passes on. */
function onSelectedRow(row: InboxRow | undefined, action: (row: InboxRow) => void, isAllowed: (row: InboxRow) => boolean = () => true): KeyHandler {
  return {
    run: () => {
      if (row) action(row);
    },
    when: () => row !== undefined && isAllowed(row),
  };
}

type InboxKeyActions = {
  selectedRow: InboxRow | undefined;
  cursor: RowCursorState;
  onPrepare: (row: InboxRow) => void;
  onPickSection: (key: InboxSectionKey) => void;
  onCycleShow: () => void;
  onRefresh: () => void;
  filterInput: React.RefObject<HTMLInputElement | null>;
};

// - A section or Show switch can unmount the focused row.
function useInboxKeys({ selectedRow, cursor, onPrepare, onPickSection, onCycleShow, onRefresh, filterInput }: InboxKeyActions) {
  const pickSection = (index: number) => () => {
    onPickSection(ALL_SECTIONS[index].key);
    afterRender(cursor.refocus);
  };
  const cycleShow = () => {
    onCycleShow();
    afterRender(cursor.refocus);
  };
  useKeys("inbox", {
    next: () => cursor.move("next"),
    previous: () => cursor.move("previous"),
    first: () => cursor.move("first"),
    last: () => cursor.move("last"),
    open: onSelectedRow(selectedRow, openPr),
    prepare: onSelectedRow(selectedRow, onPrepare, (row) => prepareLabel(row) !== null),
    github: onSelectedRow(selectedRow, openOnGitHub),
    section1: pickSection(0),
    section2: pickSection(1),
    section3: pickSection(2),
    section4: pickSection(3),
    section5: pickSection(4),
    section6: pickSection(5),
    cycleShow,
    refresh: onRefresh,
    focusFilter: () => focusQuietly(filterInput.current),
    closeMenu: { run: closeOpenMenu, when: () => openMenuElement() !== null },
  });
}

type InboxList = { sectionRows: InboxRow[]; shownRows: InboxRow[] };

function inboxListOf(inbox: Inbox | null, chosen: InboxSectionKey, show: InboxShow, query: string): InboxList {
  if (!inbox) return { sectionRows: [], shownRows: [] };
  const isSearching = query.trim() !== "";
  const sectionRows = isSearching ? [...inbox.review, ...inbox.mine].filter((row) => matchesQuery(row, query)) : rowsOfSection(inbox, chosen);
  return { sectionRows, shownRows: sectionRows.filter((row) => matchesShow(row, show)) };
}

export function InboxPage() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [chosen, setChosen] = useState<InboxSectionKey>(savedSection);
  const [show, setShow] = useState<InboxShow>("all");
  const [query, setQuery] = useState("");
  const filterInput = useRef<HTMLInputElement>(null);
  const version = useVersion();
  useMenusClose();

  const load = () => api.inbox().then(setInbox, (loadError: Error) => setError(loadError.message));

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_VIEW_MS);
    return () => clearInterval(timer);
  }, []);

  const { sectionRows, shownRows } = inboxListOf(inbox, chosen, show, query);
  const shownKeys = shownRows.map((row) => row.key);
  const cursor = useRowCursor(shownKeys);
  useLastRowRestore(inbox !== null, shownKeys, cursor);

  async function refreshFromGitHub() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    await api.refreshInbox().catch((refreshError: Error) => setError(refreshError.message));
    await load();
    setIsRefreshing(false);
  }

  const prepare = (row: InboxRow) => void api.prepare(row).then(load).then(() => afterRender(cursor.refocus));
  const resume = () => void api.resumeQueue().then(load).then(() => afterRender(cursor.refocus));
  const changeAutoPrepare = (mode: AutoPrepare) => void api.setAutoPrepare(mode).then(load);
  const pick = (key: InboxSectionKey) => {
    setChosen(key);
    saveSection(key);
    setQuery("");
  };
  useInboxKeys({
    selectedRow: shownRows.find((row) => row.key === cursor.cursorKey),
    cursor,
    onPrepare: prepare,
    onPickSection: pick,
    onCycleShow: () => setShow(nextShow(show)),
    onRefresh: () => void refreshFromGitHub(),
    filterInput,
  });

  const filter: FilterBox = { input: filterInput, query, onQuery: setQuery, onKey: filterKeyHandler(query, shownRows, cursor, setQuery) };
  const topBar = <TopBar inbox={inbox} filter={filter} isRefreshing={isRefreshing} onRefresh={() => void refreshFromGitHub()} version={version} />;
  if (!inbox) return <>{topBar}<main className="content"><p className="muted">{error ?? "Loading..."}</p></main></>;

  const isSearching = query.trim() !== "";
  const section = sectionInfo(chosen);
  const title = isSearching ? `Results for “${query.trim()}”` : section.title;
  const matchText = sectionRows.length === 1 ? "1 PR matches." : `${sectionRows.length} PRs match.`;
  const summary = isSearching ? matchText : chosen === "review" ? reviewSummary(sectionRows) : section.hint;
  const emptyText = isSearching ? "Nothing matches. Press Escape to clear the filter."
    : show === "all" ? section.empty : `None here are ${show === "ready" ? "ready to read" : "unprepared"}.`;

  return (
    <>
      {topBar}
      <div className="content inbox-layout">
        <nav className="inbox-nav" aria-label="Inbox sections">
          <div className="nav-group">For you to review</div>
          <NavItem section={REVIEW_SECTION} count={inbox.review.length} isChosen={!isSearching && chosen === "review"} onPick={() => pick("review")} />
          <div className="nav-group">Your PRs</div>
          {MY_SECTIONS.map((mine) => (
            <NavItem key={mine.key} section={mine} count={rowsOfSection(inbox, mine.key).length} isChosen={!isSearching && chosen === mine.key} onPick={() => pick(mine.key)} />
          ))}
          <AutoPrepareSetting mode={inbox.autoPrepare} onChange={changeAutoPrepare} />
          <VersionLine version={version} />
        </nav>
        <main className="inbox-body">
          <div className="inbox-heading">
            <div>
              <h1>{title}</h1>
              <p className="muted" aria-live="polite">{summary}</p>
            </div>
            <ShowPicker show={show} onChange={setShow} />
          </div>
          <ErrorBanner message={error} />
          {inbox.lastPollError ? <div className="banner error" role="alert">Could not reach GitHub. Showing the last list. ({inbox.lastPollError})</div> : null}
          {inbox.paused ? <PausedBanner onResume={resume} /> : null}
          <PreparingNote rows={[...inbox.review, ...inbox.mine].filter(isInProgress)} />
          <InboxTable rows={shownRows} emptyText={emptyText} cursor={cursor} actions={{ onPrepare: prepare, onSelect: cursor.setCursorKey }} />
        </main>
      </div>
    </>
  );
}
