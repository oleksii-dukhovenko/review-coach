import { useEffect, useState } from "react";

import { api, type PrPageData, type PrRoute } from "../api.ts";
import { ErrorBanner } from "../components/basics.tsx";
import { MyPrReview } from "./MyPrReview.tsx";
import { WalkthroughReview } from "./WalkthroughReview.tsx";

const POLL_WHILE_BUILDING_MS = 5_000;

function isInProgress(status: string | undefined): boolean {
  return status === "queued" || status === "building";
}

function isBuilding(page: PrPageData | null): boolean {
  return isInProgress(page?.job?.status) || isInProgress(page?.guide?.status);
}

function BuildStatus({ page, onPrepare }: { page: PrPageData; onPrepare: () => void }) {
  const status = page.job?.status ?? "none";
  if (status === "queued") return <div className="banner info">Waiting its turn. One PR is prepared at a time. {page.job?.error ?? ""}</div>;
  if (status === "building") return <div className="banner info">Preparing now. This takes a few minutes. The page updates by itself.</div>;
  if (status === "failed") {
    return (
      <div className="banner error">
        <span>Preparing failed: {page.job?.error}</span>
        <button onClick={onPrepare}>Retry</button>
      </div>
    );
  }
  if (status === "none") {
    return (
      <div className="banner info">
        <span>Not prepared yet.</span>
        <button className="primary" onClick={onPrepare}>Prepare walkthrough</button>
      </div>
    );
  }
  return null;
}

function OutOfDateBanner({ onPrepare }: { onPrepare: () => void }) {
  return (
    <div className="banner">
      <span>This PR changed since this was prepared. Line numbers may be off.</span>
      <button onClick={onPrepare}>Rebuild</button>
    </div>
  );
}

function PrHeader({ page }: { page: PrPageData }) {
  const { pr } = page;
  return (
    <div style={{ marginBottom: 16 }}>
      <a href="#/" className="small">Back to inbox</a>
      <h1>{pr.title}</h1>
      <div className="inbox-meta small muted">
        <span className="mono">{pr.owner}/{pr.repo}#{pr.number}</span>
        <span>by {pr.author}</span>
        <span>into <span className="mono">{pr.baseRef}</span></span>
        <span>+{pr.additions} / -{pr.deletions}</span>
        <a href={pr.url} target="_blank" rel="noreferrer">Open on GitHub</a>
      </div>
    </div>
  );
}

export function PrPage({ route }: { route: PrRoute }) {
  const [page, setPage] = useState<PrPageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.prPage(route).then(setPage, (loadError: Error) => setError(loadError.message));

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!isBuilding(page)) return;
    const timer = setInterval(() => void load(), POLL_WHILE_BUILDING_MS);
    return () => clearInterval(timer);
  }, [page?.job?.status, page?.guide?.status]);

  const prepare = () => void api.prepare(route).then(load);

  if (!page) return <p className="muted">{error ?? "Loading..."}</p>;
  const isReady = page.job?.status === "ready";
  return (
    <>
      <PrHeader page={page} />
      <ErrorBanner message={error} />
      <BuildStatus page={page} onPrepare={prepare} />
      {page.isOutOfDate ? <OutOfDateBanner onPrepare={prepare} /> : null}
      {isReady && page.pr.kind === "review" ? <WalkthroughReview route={route} page={page} onReload={() => void load()} /> : null}
      {isReady && page.pr.kind === "mine" ? <MyPrReview route={route} page={page} /> : null}
    </>
  );
}
