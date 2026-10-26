import { useMemo, type ReactNode } from "react";

import type { Anatomy, Scene, ScenePart, TrainView } from "../../../server/sceneSchema.ts";
import { StoryPicture } from "../anatomy/StoryPicture.tsx";
import { TrainPicture } from "../anatomy/TrainPicture.tsx";
import type { PictureNode, PrPageData, WalkthroughData } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
import type { ClickedNode } from "../components/Mermaid.tsx";
import { Working } from "../components/Working.tsx";
import { PrHeader, PrTabs, type PrTab } from "../pages/PrHeader.tsx";
import { BeforeAfter, ChangesBanner, FlowSection, GlossaryTerm, RemovedCodeSection } from "../pages/WalkthroughSections.tsx";
import { useCodeZoom, ZoomablePicture } from "./PictureZoom.tsx";
import { attentionItems, type AttentionItem, type AttentionRisk, type EssayStep } from "./model.ts";
import type { EssayView, ReviewSession } from "./session.ts";
import { isStepDone } from "./StepPage.tsx";

type LedeProps = {
  session: ReviewSession;
  data: WalkthroughData;
  steps: EssayStep[];
  goTo: (view: EssayView) => void;
  // - Auto-update, Start over, GitHub.
  actions: ReactNode;
  // - Preparing and out-of-date notices, shown under the header.
  banners?: ReactNode;
  // - "Comments waiting on you" for your own PRs.
  extra?: ReactNode;
};

function standfirstOf(data: WalkthroughData): string {
  const story = data.walkthrough.story;
  return story.tldr || story.whatItDoes.split(/(?<=\.)\s/)[0];
}

const RISK_LABEL: Record<AttentionRisk, string> = { problem: "Problem", hard: "Look closely", low: "Low risk" };

function AttentionList({ items, goTo }: { items: AttentionItem[]; goTo: (view: EssayView) => void }) {
  if (items.length === 0) return null;
  return (
    <section className="lede-card">
      <h2>Where to look hardest</h2>
      <ol className="attention-list">
        {items.map((item, itemIndex) => (
          <li key={`${item.title}:${itemIndex}`} className={`is-${item.risk}`}>
            <span className={`risk-badge risk-${item.risk}`}>{RISK_LABEL[item.risk]}</span>
            <div>
              <div className="attention-title">{item.title}</div>
              <p className="attention-body">{item.body} <button className="step-ref" onClick={() => goTo({ kind: "step", index: item.stepIndex })}>{item.stepRef}</button></p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function diffStats(data: WalkthroughData) {
  const lines = data.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
  return { files: data.files.length, adds: lines.filter((line) => line.kind === "add").length, dels: lines.filter((line) => line.kind === "del").length };
}

function isGuidePending(session: ReviewSession): boolean {
  const status = session.page.guide?.status;
  return status === "queued" || status === "building";
}

function GuideStatus({ session }: { session: ReviewSession }) {
  if (!isGuidePending(session)) return null;
  return <p className="small muted guide-status"><Working size={13}>Sorting the steps into a reading order. They may change when it is done.</Working></p>;
}

function firstOpenStep(steps: EssayStep[], session: ReviewSession): EssayStep | undefined {
  return steps.find((step) => !isStepDone(step, session));
}

function nextAction(steps: EssayStep[], session: ReviewSession, goTo: (view: EssayView) => void): { label: string; go: () => void } {
  const open = firstOpenStep(steps, session);
  if (!open) return { label: "Finish review", go: () => goTo({ kind: "finish" }) };
  const label = open.index === 0 ? "Start reading" : `Continue with step ${open.index + 1}`;
  return { label, go: () => goTo({ kind: "step", index: open.index }) };
}

function StepMark({ isDone, isNext }: { isDone: boolean; isNext: boolean }) {
  if (isDone) return <span className="plan-mark is-done"><Icon name="check" size={12} /></span>;
  return <span className={`plan-mark ${isNext ? "is-next" : ""}`} />;
}

/** The steps in reading order, what is done, and the button that picks up where you left off. */
function ReadingPlan({ session, steps, data, goTo }: { session: ReviewSession; steps: EssayStep[]; data: WalkthroughData; goTo: (view: EssayView) => void }) {
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  const doneCount = steps.filter((step) => isStepDone(step, session)).length;
  const next = firstOpenStep(steps, session);
  const action = nextAction(steps, session, goTo);
  const stats = diffStats(data);
  return (
    <aside className="lede-aside" aria-label="Reading plan">
      <section className="lede-card reading-plan">
        <div className="plan-head"><h2>Reading plan</h2><span className="small muted">about {total} min</span></div>
        <div className="reading-progress">
          <div className="progress-track"><div style={{ width: `${steps.length ? Math.round((doneCount / steps.length) * 100) : 0}%` }} /></div>
          <span>{doneCount} of {steps.length} steps read</span>
        </div>
        <ol className="plan-list">
          {steps.map((step) => (
            <li key={step.index}>
              <button className={`plan-step ${step === next ? "is-next" : ""}`} onClick={() => goTo({ kind: "step", index: step.index })}>
                <StepMark isDone={isStepDone(step, session)} isNext={step === next} />
                <span className="plan-title">{step.title}</span>
                <span className="small muted">{step.minutes} min</span>
              </button>
            </li>
          ))}
        </ol>
        <GuideStatus session={session} />
        <button className="btn btn-primary" onClick={action.go}>{action.label}</button>
      </section>
      <section className="lede-card lede-stats">
        <span className="mono">{stats.files} files</span>
        <span className="mono added-count">+{stats.adds}</span>
        <span className="mono deleted-count">−{stats.dels}</span>
        <button className="link-button" onClick={() => goTo({ kind: "files" })}>See all</button>
      </section>
    </aside>
  );
}

function Background({ session, data }: { session: ReviewSession; data: WalkthroughData }) {
  const { story } = data.walkthrough;
  const hasStoryCard = (story.before && story.after) || story.glossary.length > 0 || story.whatItDoes || story.whyNeeded;
  return (
    <>
      {hasStoryCard ? (
        <section className="lede-card">
          <h2>Before and after</h2>
          <BeforeAfter story={story} />
          {story.glossary.length ? <div className="glossary-row"><span className="small muted">Words you'll see:</span>{story.glossary.map((entry) => <GlossaryTerm key={entry.term} entry={entry} />)}</div> : null}
          <details className="more"><summary>The full story</summary><Markdown text={story.whatItDoes} /><Markdown text={story.whyNeeded} /></details>
        </section>
      ) : null}
      <ZoomablePicture session={session} data={data} />
      <FlowSection route={session.route} flow={data.walkthrough.flow} files={data.files} onOpenLine={session.openLine} />
      <RemovedCodeSection removed={data.removed} />
    </>
  );
}

function OverviewTabs({ steps, data, goTo, session }: { steps: EssayStep[]; data: WalkthroughData; goTo: (view: EssayView) => void; session: ReviewSession }) {
  const open = firstOpenStep(steps, session) ?? steps[0];
  const tabs: PrTab[] = [
    { label: "Overview", isCurrent: true, onPick: () => goTo({ kind: "lede" }) },
    { label: "Steps", count: steps.length, isCurrent: false, onPick: () => goTo({ kind: "step", index: open?.index ?? 0 }) },
    { label: "Files", count: data.files.length, isCurrent: false, onPick: () => goTo({ kind: "files" }) },
    { label: session.page.pr.kind === "review" ? "Finish review" : "Finish", isCurrent: false, onPick: () => goTo({ kind: "finish" }) },
  ];
  return <PrTabs tabs={tabs} />;
}

// - An older server sends neither field.
function readySceneOf(page: PrPageData): Scene | null {
  const job = page.anatomy;
  if (job?.status !== "ready") return null;
  const scene = (job.data as Anatomy | null)?.scene ?? null;
  return scene?.parts.length ? scene : null;
}

function trainOf(page: PrPageData): TrainView | null {
  const view = page.train;
  return view?.scene?.groups.length ? view : null;
}

function nodeOfPart(part: ScenePart): PictureNode {
  return { id: part.id, file: part.file, startLine: part.startLine, endLine: part.endLine };
}

function isNewInStory(scene: Scene, partId: string): boolean {
  return scene.steps.some((step) => step.looks.some((look) => look.part === partId && look.isNew));
}

function clickedPartOf(scene: Scene, part: ScenePart, element: Element): ClickedNode {
  return { id: part.id, label: part.label, change: isNewInStory(scene, part.id) ? "changed" : "existing", element };
}

/** The playing story; clicking a part opens its code in the big picture's zoom panel. */
function StoryCard({ session, data, scene }: { session: ReviewSession; data: WalkthroughData; scene: Scene }) {
  const lookup = useMemo(() => ({ nodes: scene.parts.map(nodeOfPart), isLoading: false, error: null }), [scene]);
  const zoom = useCodeZoom(session, data, lookup);
  return (
    <>
      <div className="picture-stage story-stage">
        <div className="picture-camera" ref={zoom.camera}>
          <StoryPicture scene={scene} onOpenPart={(part, element) => zoom.open(clickedPartOf(scene, part, element))} />
        </div>
      </div>
      {zoom.panel}
    </>
  );
}

function AnatomyPictures({ session, data }: { session: ReviewSession; data: WalkthroughData }) {
  const train = trainOf(session.page);
  const scene = readySceneOf(session.page);
  return (
    <>
      {train ? <TrainPicture view={train} /> : null}
      {scene ? <StoryCard session={session} data={data} scene={scene} /> : null}
    </>
  );
}

/** The front page: what this PR does, where to look hardest, and how long it takes. */
export function LedePage({ session, data, steps, goTo, actions, banners, extra }: LedeProps) {
  return (
    <div className="lede">
      <PrHeader pr={session.page.pr} actions={actions} tabs={<OverviewTabs steps={steps} data={data} goTo={goTo} session={session} />} />
      {banners}
      <ChangesBanner change={data.changes?.at(-1)} onOpenFile={session.openFile} />
      <div className="lede-grid">
        <div className="lede-main">
          <AnatomyPictures session={session} data={data} />
          <section className="lede-card">
            <h2 className="lede-label">In one line</h2>
            <p className="lede-standfirst">{standfirstOf(data)}</p>
          </section>
          <AttentionList items={attentionItems(steps, data.walkthrough.hardIdeas)} goTo={goTo} />
          {extra}
          <Background session={session} data={data} />
        </div>
        <ReadingPlan session={session} steps={steps} data={data} goTo={goTo} />
      </div>
    </div>
  );
}
