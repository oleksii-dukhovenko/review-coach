import { useEffect, useState } from "react";

import { api, type Inbox, type InboxRow } from "../api.ts";
import { ErrorBanner } from "../components/basics.tsx";

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

function InboxRowView({ row, onPrepare }: { row: InboxRow; onPrepare: (row: InboxRow) => void }) {
  const threadLabel = `${row.openThreadCount} comment${row.openThreadCount === 1 ? "" : "s"} waiting`;
  return (
    <div className="inbox-row">
      <div>
        <a className="inbox-title" href={prHash(row)}>{row.title}</a>
        <div className="inbox-meta small muted">
          <span className="mono">{row.repo}#{row.number}</span>
          <span>by {row.author}</span>
          <span>+{row.additions} / -{row.deletions}</span>
          {row.kind === "mine" ? <span>{threadLabel}</span> : null}
          <a href={row.url} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>
      <div className="inbox-meta">
        <StatusChip row={row} />
        {needsPrepareButton(row) ? <button onClick={() => onPrepare(row)}>{row.isOutOfDate ? "Rebuild" : "Prepare"}</button> : null}
      </div>
    </div>
  );
}

function InboxSection({ title, rows, emptyText, onPrepare }: { title: string; rows: InboxRow[]; emptyText: string; onPrepare: (row: InboxRow) => void }) {
  return (
    <section>
      <h2>{title} <span className="muted">({rows.length})</span></h2>
      {rows.length === 0 ? (
        <div className="empty">{emptyText}</div>
      ) : (
        <div className="inbox-list">{rows.map((row) => <InboxRowView key={row.key} row={row} onPrepare={onPrepare} />)}</div>
      )}
    </section>
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
    <>
      <div className="button-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h1>Inbox</h1>
        <div className="inbox-meta small muted">
          {inbox.lastPollAt ? <span>Checked GitHub {new Date(inbox.lastPollAt).toLocaleTimeString()}</span> : null}
          <button disabled={isRefreshing} onClick={() => void refreshFromGitHub()}>{isRefreshing ? "Checking..." : "Check now"}</button>
        </div>
      </div>
      <ErrorBanner message={error} />
      {inbox.lastPollError ? <div className="banner error">Could not reach GitHub. Showing the last list. ({inbox.lastPollError})</div> : null}
      {inbox.paused ? <PausedBanner onResume={resume} /> : null}
      <InboxSection title="Review for others" rows={inbox.review} emptyText="Nobody is waiting on your review." onPrepare={prepare} />
      <InboxSection title="My PRs" rows={inbox.mine} emptyText="No open comments waiting on you." onPrepare={prepare} />
    </>
  );
}
