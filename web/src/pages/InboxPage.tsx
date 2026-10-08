import { useEffect, useState } from "react";

import { api, type Inbox, type InboxRow, type MyPrSection } from "../api.ts";
import { AutoUpdateToggle } from "../components/AutoUpdateToggle.tsx";
import { ErrorBanner } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";

const REFRESH_VIEW_MS = 15_000;

const STATUS_LABEL = {
  none: "Not started",
  queued: "Waiting",
  building: "Preparing",
  ready: "Ready",
  failed: "Failed",
} as const;

function StatusChip({ row }: { row: InboxRow }) {
  if (row.isOutOfDate) return <span className="chip stale">Out of date</span>;
  return <span className={`chip ${row.status}`} title={row.error ?? ""}>{STATUS_LABEL[row.status]}</span>;
}

function needsPrepareButton(row: InboxRow): boolean {
  const notBuiltYet = row.status === "none" || row.status === "failed";
  return notBuiltYet || row.isOutOfDate;
}

function prHash(row: InboxRow): string {
  return `#/pr/${row.owner}/${row.repo}/${row.number}`;
}

function isOnControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest("a, button, input, label") !== null;
}

/** The whole row opens the PR, except its own buttons and links. */
function InboxRowView({ row, onPrepare }: { row: InboxRow; onPrepare: (row: InboxRow) => void }) {
  const threadLabel = `${row.openThreadCount} comment${row.openThreadCount === 1 ? "" : "s"} waiting`;
  const openRow = (event: React.MouseEvent) => {
    if (!isOnControl(event.target)) window.location.hash = prHash(row);
  };
  return (
    <div className="inbox-row" onClick={openRow}>
      <div>
        <div className="inbox-line">
          <span className="repo-pill">{row.repo}</span>
          <a className="inbox-title" href={prHash(row)}>{row.title}</a>
        </div>
        <div className="inbox-meta small muted">
          <span className="mono">#{row.number}</span>
          <span>{row.author}</span>
          <span><span className="added-count">+{row.additions}</span> <span className="deleted-count">-{row.deletions}</span></span>
          {row.isDraft ? <span className="chip">Draft</span> : null}
          {row.openThreadCount > 0 ? <span><Icon name="message" size={13} /> {threadLabel}</span> : null}
        </div>
      </div>
      <div className="inbox-actions">
        <AutoUpdateToggle route={row} isOn={row.autoUpdate} isCompact />
        <StatusChip row={row} />
        {needsPrepareButton(row) ? <button className="primary" onClick={() => onPrepare(row)}>{row.isOutOfDate ? "Update" : "Prepare"}</button> : null}
        <a className="icon-link" href={row.url} target="_blank" rel="noreferrer" title="Open on GitHub"><Icon name="arrowUpRight" /></a>
      </div>
    </div>
  );
}

function InboxSection({ title, rows, emptyText, onPrepare }: { title: string; rows: InboxRow[]; emptyText: string; onPrepare: (row: InboxRow) => void }) {
  return (
    <section>
      <div className="section-title"><h2>{title}</h2><span className="count-pill">{rows.length}</span></div>
      {rows.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <div className="inbox-list">{rows.map((row) => <InboxRowView key={row.key} row={row} onPrepare={onPrepare} />)}</div>
      )}
    </section>
  );
}

const MY_SECTIONS: { section: MyPrSection; title: string; hint: string }[] = [
  { section: "waiting-on-me", title: "Waiting on you", hint: "Comments or requested changes to answer." },
  { section: "draft", title: "Drafts to finish", hint: "Not ready for review yet." },
  { section: "no-reviewer", title: "No reviewer yet", hint: "Ready, but nobody is asked to review." },
  { section: "approved", title: "Approved", hint: "Ready to merge." },
  { section: "waiting-on-others", title: "Waiting on others", hint: "Reviewers have it. Nothing for you to do." },
];

function MySection({ title, hint, rows, onPrepare }: { title: string; hint: string; rows: InboxRow[]; onPrepare: (row: InboxRow) => void }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <div className="section-title"><h2>{title}</h2><span className="count-pill">{rows.length}</span><span className="small muted">{hint}</span></div>
      <div className="inbox-list">{rows.map((row) => <InboxRowView key={row.key} row={row} onPrepare={onPrepare} />)}</div>
    </section>
  );
}

function MyPrs({ rows, onPrepare }: { rows: InboxRow[]; onPrepare: (row: InboxRow) => void }) {
  if (rows.length === 0) return <InboxSection title="My PRs" rows={rows} emptyText="You have no open PRs." onPrepare={onPrepare} />;
  return (
    <>
      {MY_SECTIONS.map(({ section, title, hint }) => (
        <MySection key={section} title={title} hint={hint} rows={rows.filter((row) => row.section === section)} onPrepare={onPrepare} />
      ))}
    </>
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

export function InboxPage() {
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  if (!inbox) return <p className="muted">{error ?? "Loading..."}</p>;
  return (
    <div className="inbox-page">
      <div className="page-head">
        <div>
          <h1>Inbox</h1>
          <div className="small muted">Reviews for others and every open PR of yours. {inbox.lastPollAt ? `Checked GitHub at ${new Date(inbox.lastPollAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : null}</div>
        </div>
        <button disabled={isRefreshing} onClick={() => void refreshFromGitHub()}>
          <Icon name="refresh" size={14} /> {isRefreshing ? "Checking..." : "Check now"}
        </button>
      </div>
      <ErrorBanner message={error} />
      {inbox.lastPollError ? <div className="banner error">Could not reach GitHub. Showing the last list. ({inbox.lastPollError})</div> : null}
      {inbox.paused ? <PausedBanner onResume={resume} /> : null}
      <InboxSection title="Review for others" rows={inbox.review} emptyText="Nobody is waiting on your review." onPrepare={prepare} />
      <MyPrs rows={inbox.mine} onPrepare={prepare} />
    </div>
  );
}
