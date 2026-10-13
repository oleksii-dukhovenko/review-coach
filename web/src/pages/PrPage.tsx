import { useEffect, useState } from "react";

import { api, type JobRecord, type MainJobKind, type PrPageData, type PrRoute } from "../api.ts";
import { AutoUpdateToggle } from "../components/AutoUpdateToggle.tsx";
import { ErrorBanner } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
import { OpenInNeovim } from "../components/OpenInNeovim.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { Working } from "../components/Working.tsx";
import { EssayReview } from "../essay/EssayReview.tsx";
import type { EssayView } from "../essay/session.ts";
import { MyPrReview } from "./MyPrReview.tsx";
import { PrHeader } from "./PrHeader.tsx";

const POLL_WHILE_BUILDING_MS = 5_000;

function isInProgress(status: string | undefined): boolean {
  return status === "queued" || status === "building";
}

const JOB_LABEL: Record<MainJobKind, string> = { walkthrough: "Walkthrough", triage: "Comment help" };

function isBuilding(page: PrPageData | null): boolean {
  const jobs = [page?.walkthrough, page?.triage, page?.guide];
  return jobs.some((job) => isInProgress(job?.status));
}

/** A finished build stays on screen while the next one runs. */
function hasBuild(job: JobRecord | null): boolean {
  return job?.data !== null && job?.data !== undefined && job.builtAt !== null;
}

function UpdatingStatus({ job, onPrepare }: { job: JobRecord; onPrepare: () => void }) {
  if (isInProgress(job.status)) {
    return <div className="banner info"><Working>Updating for the new changes. Only what changed is redone; your answers, notes and checkmarks stay. {job.error ?? ""}</Working></div>;
  }
  if (job.status !== "failed") return null;
  return (
    <div className="banner error">
      <span>Updating failed: {job.error}. You are still looking at the last version.</span>
      <button onClick={onPrepare}>Retry</button>
    </div>
  );
}

function BuildStatus({ kind, job, onPrepare }: { kind: MainJobKind; job: JobRecord | null; onPrepare: () => void }) {
  if (job && hasBuild(job)) return <UpdatingStatus job={job} onPrepare={onPrepare} />;
  const label = JOB_LABEL[kind];
  const status = job?.status ?? "none";
  if (status === "queued") return <div className="banner info"><Working>{label}: waiting its turn. One PR is prepared at a time. {job?.error ?? ""}</Working></div>;
  if (status === "building") return <div className="banner info"><Working>{label}: preparing now. This takes a few minutes. The page updates by itself.</Working></div>;
  if (status === "failed") {
    return (
      <div className="banner error">
        <span>{label}: preparing failed: {job?.error}</span>
        <button onClick={onPrepare}>Retry</button>
      </div>
    );
  }
  if (status === "none") {
    return (
      <div className="banner info">
        <span>{label}: not prepared yet.</span>
        <button className="primary" onClick={onPrepare}>Prepare {label.toLowerCase()}</button>
      </div>
    );
  }
  return null;
}

const OUT_OF_DATE_TEXT: Record<MainJobKind, string> = {
  walkthrough: "New commits since this was prepared.",
  triage: "New or answered comments since this was prepared.",
};

function OutOfDateBanner({ kind, onPrepare }: { kind: MainJobKind; onPrepare: () => void }) {
  return (
    <div className="banner">
      <span>{OUT_OF_DATE_TEXT[kind]} Updating redoes only what changed and keeps your progress.</span>
      <button className="primary" onClick={onPrepare}>Update</button>
    </div>
  );
}

function isAnyJobReady(page: PrPageData): boolean {
  return page.jobKinds.some((kind) => page[kind]?.status === "ready");
}

function PrActions({ page, onRebuild }: { page: PrPageData; onRebuild: () => void }) {
  const { pr } = page;
  return (
    <>
      <AutoUpdateToggle route={pr} isOn={page.autoUpdate} />
      {isAnyJobReady(page) ? <button className="btn btn-ghost btn-small btn-quiet" onClick={onRebuild} title="Write everything again from scratch">Start over</button> : null}
      <OpenInNeovim route={pr} className="btn btn-secondary btn-small" />
      <a className="btn btn-secondary btn-small" href={pr.url} target="_blank" rel="noreferrer"><Icon name="github" size={15} /> GitHub</a>
      <ThemePicker />
    </>
  );
}

export function PrPage({ route, view, goTo }: { route: PrRoute; view: EssayView; goTo: (view: EssayView) => void }) {
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
  }, [page?.walkthrough?.status, page?.triage?.status, page?.guide?.status]);

  const prepare = () => void api.prepare(route).then(load);
  const rebuild = () => {
    const question = "Write everything again from scratch? Your answers may no longer match the new questions. Update is usually enough.";
    if (window.confirm(question)) void api.rebuild(route).then(load);
  };

  if (!page) return <p className="muted page-pad">{error ?? "Loading..."}</p>;
  const buildOf = (kind: MainJobKind) => (hasBuild(page[kind]) ? page[kind] : null);
  const banners = page.jobKinds.map((kind) => (
    <div key={kind}>
      <BuildStatus kind={kind} job={page[kind]} onPrepare={prepare} />
      {page.outOfDate[kind] ? <OutOfDateBanner kind={kind} onPrepare={prepare} /> : null}
    </div>
  ));
  const triage = page.jobKinds.includes("triage") && buildOf("triage") ? <MyPrReview key={buildOf("triage")!.builtAt} route={route} page={page} /> : null;
  const walkthrough = page.jobKinds.includes("walkthrough") ? buildOf("walkthrough") : null;
  if (walkthrough) {
    return (
      <EssayReview key={walkthrough.builtAt} route={route} page={page} view={view} goTo={goTo}
        actions={<PrActions page={page} onRebuild={rebuild} />} banners={<><ErrorBanner message={error} />{banners}</>} extra={triage} />
    );
  }
  return (
    <div className="page-pad">
      <PrHeader pr={page.pr} actions={<PrActions page={page} onRebuild={rebuild} />} />
      <ErrorBanner message={error} />
      {banners}
      {triage}
    </div>
  );
}
