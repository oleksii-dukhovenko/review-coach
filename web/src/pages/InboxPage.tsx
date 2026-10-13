import { useEffect, useRef, useState } from "react";

import { api, type AutoPrepare, type Inbox, type InboxRow, type MyPrSection } from "../api.ts";
import { AutoUpdateToggle } from "../components/AutoUpdateToggle.tsx";
import { ErrorBanner } from "../components/basics.tsx";
import { BrandMark } from "../components/BrandMark.tsx";
import { Icon } from "../components/Icon.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { Working } from "../components/Working.tsx";
import {
  isReadyToRead, matchesQuery, matchesShow, rowsOfSection, timeAgo, type InboxSectionKey, type InboxShow,
} from "../inboxView.ts";

const REFRESH_VIEW_MS = 15_000;
const SECTION_KEY = "review-coach:inbox-section";
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
  return <span className={`chip ${row.status}`} title={row.error ?? ""}>{STATUS_LABEL[row.status]}</span>;
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

/** The one thing to do next: read it, or prepare it. */
function NextStep({ row, onPrepare }: { row: InboxRow; onPrepare: (row: InboxRow) => void }) {
  const label = prepareLabel(row);
  if (label) return <button onClick={() => onPrepare(row)}>{label}</button>;
  if (isReadyToRead(row)) return <a className="button-link primary" href={prHash(row)}>{row.kind === "review" ? "Read" : "Open"}</a>;
  return null;
}

/** Auto-update and the GitHub link, folded behind ⋯ so the row stays quiet. */
function RowMenu({ row }: { row: InboxRow }) {
  return (
    <details className="row-menu">
      <summary aria-label={`More for ${row.title}`} title="More"><Icon name="more" size={18} /></summary>
      <div className="menu" role="menu">
        <AutoUpdateToggle route={row} isOn={row.autoUpdate} />
        <a href={row.url} target="_blank" rel="noreferrer" role="menuitem"><Icon name="github" size={15} /> Open on GitHub</a>
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

/** The whole row opens the PR, except its own buttons and links. */
function InboxRowView({ row, onPrepare }: { row: InboxRow; onPrepare: (row: InboxRow) => void }) {
  const threadLabel = `${row.openThreadCount} comment${row.openThreadCount === 1 ? "" : "s"} waiting`;
  const openRow = (event: React.MouseEvent) => {
    if (!isOnControl(event.target)) window.location.hash = prHash(row);
  };
  return (
    <div className="inbox-row" onClick={openRow}>
      <div className="inbox-main">
        <a className="inbox-title" href={prHash(row)}>{row.title}</a>
        <div className="inbox-meta">
          <span className="mono">{row.repo} #{row.number}</span>
          {row.kind === "review" ? <span>{row.author}</span> : null}
          <span title={new Date(row.updatedAt).toLocaleString()}>{timeAgo(row.updatedAt)}</span>
          {row.isDraft ? <span className="chip">Draft</span> : null}
          {row.openThreadCount > 0 ? <span className="inbox-threads" title={threadLabel}><Icon name="message" size={14} /> {row.openThreadCount}</span> : null}
        </div>
      </div>
      <SizeCell row={row} />
      <div className="inbox-status"><StatusChip row={row} /></div>
      <div className="inbox-next">
        <NextStep row={row} onPrepare={onPrepare} />
        <RowMenu row={row} />
      </div>
    </div>
  );
}

function InboxTable({ rows, emptyText, onPrepare }: { rows: InboxRow[]; emptyText: string; onPrepare: (row: InboxRow) => void }) {
  if (rows.length === 0) return <div className="inbox-empty">{emptyText}</div>;
  return (
    <div className="inbox-table">
      <div className="inbox-head" aria-hidden="true">
        <span>Pull request</span><span>Size</span><span>Status</span><span className="inbox-head-next">Next step</span>
      </div>
      {rows.map((row) => <InboxRowView key={row.key} row={row} onPrepare={onPrepare} />)}
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

/** How much gets prepared without a click, since each walkthrough uses Claude tokens. */
function AutoPrepareSetting({ mode, onChange }: { mode: AutoPrepare; onChange: (mode: AutoPrepare) => void }) {
  const [isChanging, setIsChanging] = useState(false);
  const chosen = AUTO_PREPARE_OPTIONS.find((option) => option.mode === mode);
  const pick = (next: AutoPrepare) => {
    onChange(next);
    setIsChanging(false);
  };
  return (
    <div className="auto-prepare">
      <div className="small muted">Prepare on its own</div>
      {isChanging ? (
        <div className="auto-prepare-options" role="radiogroup" aria-label="Prepare on its own">
          {AUTO_PREPARE_OPTIONS.map((option) => (
            <label key={option.mode} className="radio">
              <input type="radio" name="auto-prepare" checked={mode === option.mode} onChange={() => pick(option.mode)} />
              <span className="dot" />
              {option.label}
            </label>
          ))}
        </div>
      ) : (
        <>
          <div className="auto-prepare-choice">{chosen?.label}</div>
          <div className="small muted">{chosen?.hint}</div>
        </>
      )}
      <button className="link-button" onClick={() => setIsChanging(!isChanging)}>{isChanging ? "Cancel" : "Change"}</button>
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

/** "/" jumps to the filter box, unless you are typing somewhere. */
function useSlashToFilter(input: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const focusFilter = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.closest("input, textarea, select, [contenteditable='true']") !== null;
      if (event.key !== "/" || isTyping || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", focusFilter);
    return () => window.removeEventListener("keydown", focusFilter);
  }, []);
}

/** Closes an open ⋯ menu on a click elsewhere or Escape. */
function useMenusClose() {
  useEffect(() => {
    const closeOthers = (keep: Element | null) =>
      document.querySelectorAll("details.row-menu[open]").forEach((menu) => menu !== keep && menu.removeAttribute("open"));
    const onClick = (event: MouseEvent) => closeOthers(event.target instanceof Element ? event.target.closest("details.row-menu") : null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && closeOthers(null);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
}

function checkedAt(inbox: Inbox | null): string | null {
  if (!inbox?.lastPollAt) return null;
  return `Checked GitHub at ${new Date(inbox.lastPollAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function TopBar({ inbox, query, onQuery, isRefreshing, onRefresh }: {
  inbox: Inbox | null; query: string; onQuery: (query: string) => void; isRefreshing: boolean; onRefresh: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useSlashToFilter(input);
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a href="#/" className="brand"><BrandMark /> Review Coach</a>
        <label className="filter-box">
          <Icon name="search" size={16} />
          <input ref={input} type="search" value={query} placeholder="Filter by title, repo or author" aria-label="Filter pull requests"
            onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => event.key === "Escape" && onQuery("")} />
          <kbd>/</kbd>
        </label>
        <span className="topbar-spacer" />
        <span className="small muted topbar-checked">{isRefreshing ? "Checking GitHub..." : checkedAt(inbox)}</span>
        <button className="icon-button" disabled={isRefreshing} onClick={onRefresh} aria-label="Check GitHub now" title="Check GitHub now">
          <Icon name="refresh" size={16} />
        </button>
        <ThemePicker />
      </div>
    </header>
  );
}

export function InboxPage() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [chosen, setChosen] = useState<InboxSectionKey>(savedSection);
  const [show, setShow] = useState<InboxShow>("all");
  const [query, setQuery] = useState("");
  useMenusClose();

  const load = () => api.inbox().then(setInbox, (loadError: Error) => setError(loadError.message));

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_VIEW_MS);
    return () => clearInterval(timer);
  }, []);

  async function refreshFromGitHub() {
    setIsRefreshing(true);
    await api.refreshInbox().catch((refreshError: Error) => setError(refreshError.message));
    await load();
    setIsRefreshing(false);
  }

  const prepare = (row: InboxRow) => void api.prepare(row).then(load);
  const resume = () => void api.resumeQueue().then(load);
  const changeAutoPrepare = (mode: AutoPrepare) => void api.setAutoPrepare(mode).then(load);
  const pick = (key: InboxSectionKey) => {
    setChosen(key);
    saveSection(key);
    setQuery("");
  };

  const topBar = <TopBar inbox={inbox} query={query} onQuery={setQuery} isRefreshing={isRefreshing} onRefresh={() => void refreshFromGitHub()} />;
  if (!inbox) return <>{topBar}<main className="content"><p className="muted">{error ?? "Loading..."}</p></main></>;

  const isSearching = query.trim() !== "";
  const section = sectionInfo(chosen);
  const sectionRows = isSearching ? [...inbox.review, ...inbox.mine].filter((row) => matchesQuery(row, query)) : rowsOfSection(inbox, chosen);
  const shownRows = sectionRows.filter((row) => matchesShow(row, show));
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
        </nav>
        <main className="inbox-body">
          <div className="inbox-heading">
            <div>
              <h1>{title}</h1>
              <p className="muted">{summary}</p>
            </div>
            <ShowPicker show={show} onChange={setShow} />
          </div>
          <ErrorBanner message={error} />
          {inbox.lastPollError ? <div className="banner error">Could not reach GitHub. Showing the last list. ({inbox.lastPollError})</div> : null}
          {inbox.paused ? <PausedBanner onResume={resume} /> : null}
          <PreparingNote rows={[...inbox.review, ...inbox.mine].filter(isInProgress)} />
          <InboxTable rows={shownRows} emptyText={emptyText} onPrepare={prepare} />
        </main>
      </div>
    </>
  );
}
