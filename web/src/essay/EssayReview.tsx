import { useEffect, useMemo, type ReactNode } from "react";

import type { Guide, PrPageData, PrRoute, WalkthroughData } from "../api.ts";
import { FileViewer } from "../components/FileViewer.tsx";
import { FilesPage } from "./FilesPage.tsx";
import { LedePage } from "./LedePage.tsx";
import { buildSteps, type EssayStep } from "./model.ts";
import { YourReview } from "./ReviewMargin.tsx";
import { useReviewSession, type EssayView, type ReviewSession } from "./session.ts";
import { Rail, StepPage } from "./StepPage.tsx";

type EssayReviewProps = {
  route: PrRoute;
  page: PrPageData;
  view: EssayView;
  goTo: (view: EssayView) => void;
  actions: ReactNode;
  extra?: ReactNode;
};

function readyGuide(page: PrPageData): Guide | null {
  return page.guide?.builtAt ? (page.guide.data as Guide | null) : null;
}

function FinishPage({ session, data, steps, goTo, canPost }: { session: ReviewSession; data: WalkthroughData; steps: EssayStep[]; goTo: (view: EssayView) => void; canPost: boolean }) {
  return (
    <div className="essay-step">
      <Rail session={session} steps={steps} place={{ isFinish: true }} goTo={goTo} />
      <article className="essay-article">
        <div className="small-caps">Finish</div>
        <h1 className="essay-title">{canPost ? "Your verdict" : "You're through"}</h1>
        <p className="essay-p">{canPost
          ? "Read your drafts once more, pick a verdict, and post. Nothing goes to GitHub until you press Submit review."
          : "This is your own PR, so nothing is posted. Your drafts are notes to fix before you ask for review."}</p>
        {canPost ? (
          <>
            <label className="small-caps" htmlFor="review-summary">Summary (optional)</label>
            <textarea id="review-summary" className="input finish-summary" value={session.state.summary}
              onChange={(event) => session.setState((current) => ({ ...current, summary: event.target.value }))} />
          </>
        ) : null}
        <YourReview session={session} data={data} canPost={canPost} isDocked={false} />
      </article>
    </div>
  );
}

function clampView(view: EssayView, steps: EssayStep[]): EssayView {
  if (view.kind !== "step") return view;
  return view.index >= 0 && view.index < steps.length ? view : { kind: "lede" };
}

/** The walkthrough as a front page and an essay per step. */
export function EssayReview({ route, page, view, goTo, actions, extra }: EssayReviewProps) {
  const data = page.walkthrough!.data as WalkthroughData;
  const guide = readyGuide(page);
  const steps = useMemo(() => buildSteps(data, guide), [page.walkthrough?.builtAt, page.guide?.builtAt]);
  const shown = clampView(view, steps);
  const session = useReviewSession(route, page, data.files, steps, shown, goTo);
  const canPost = page.pr.kind === "review";
  useEffect(() => {
    window.scrollTo(0, 0);
    session.setComposer(null);
  }, [shown.kind, shown.kind === "step" ? shown.index : -1]);
  return (
    <>
      {shown.kind === "lede" ? <LedePage session={session} data={data} steps={steps} goTo={goTo} actions={actions} extra={extra} /> : null}
      {shown.kind === "step" ? <StepPage session={session} data={data} steps={steps} step={steps[shown.index]} goTo={goTo} canPost={canPost} /> : null}
      {shown.kind === "finish" ? <FinishPage session={session} data={data} steps={steps} goTo={goTo} canPost={canPost} /> : null}
      {shown.kind === "files" ? <FilesPage session={session} data={data} steps={steps} goTo={goTo} /> : null}
      <FileViewer route={route} viewer={session.viewer} />
    </>
  );
}
