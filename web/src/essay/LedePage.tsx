import { useMemo, useState, type MouseEvent, type ReactNode } from "react";

import type { Anatomy, Scene, ScenePart, TrainView } from "../../../server/sceneSchema.ts";
import { drawableScene, drawableTrainScene } from "../anatomy/frame.ts";
import { StoryPicture } from "../anatomy/StoryPicture.tsx";
import { TrainPicture } from "../anatomy/TrainPicture.tsx";
import { api, type JobRecord, type PictureNode, type PrPageData, type WalkthroughData } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
import type { ClickedNode } from "../components/Mermaid.tsx";
import { Working } from "../components/Working.tsx";
import { focusQuietly, useKeys, type KeyHandler } from "../keys.ts";
import { PrHeader, PrTabs, type PrTab } from "../pages/PrHeader.tsx";
import { BeforeAfter, ChangesBanner, FlowSection, GlossaryTerm, RemovedCodeSection } from "../pages/WalkthroughSections.tsx";
import { useCodeZoom, ZoomablePicture } from "./PictureZoom.tsx";
import { attentionItems, startHereOf, type AttentionItem, type AttentionRisk, type EssayStep, type FlowStep } from "./model.ts";
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
  // - Fetches the page data again.
  onReload: () => void;
};

type Story = WalkthroughData["walkthrough"]["story"];

type OpenLine = ReviewSession["openLine"];

function Glossary({ story }: { story: Story }) {
  if (story.glossary.length === 0) return null;
  return (
    <div className="glossary-row">
      <span className="small muted">Words you'll see:</span>
      {story.glossary.map((entry) => <GlossaryTerm key={entry.term} entry={entry} />)}
    </div>
  );
}

function StartHereLine({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return <div className="start-here-line"><dt>{label}</dt><dd>{text}</dd></div>;
}

/** Problem, fix and how you'd notice, before any code. */
function StartHereCard({ story }: { story: Story }) {
  const lines = startHereOf(story);
  return (
    <section className="lede-card start-here">
      <h2>Start here</h2>
      <dl className="start-here-lines">
        <StartHereLine label="The problem" text={lines.problem} />
        <StartHereLine label="The fix" text={lines.fix} />
        <StartHereLine label="How you'd notice" text={lines.howYouNotice} />
      </dl>
      <Glossary story={story} />
    </section>
  );
}

// - Older flows have no plain sentence.
function storyLineOf(flowStep: FlowStep): string {
  return flowStep.inPlainWords || `${flowStep.actor}: ${flowStep.label}. ${flowStep.explanation}`;
}

function FlowStepItem({ flowStep, onOpenLine }: { flowStep: FlowStep; onOpenLine: OpenLine }) {
  return (
    <li>
      <span className="flow-step-story">{storyLineOf(flowStep)}</span>
      <span className="flow-step-code">
        <span className="mono">{flowStep.actor} · {flowStep.label}</span>
        <button className="link-button small" onClick={() => onOpenLine(flowStep.file, flowStep.line, "RIGHT")}>See the code</button>
      </span>
    </li>
  );
}

/** The run as a short story, from the moment it starts. */
function PlainFlow({ moment, flow, onOpenLine }: { moment: string | undefined; flow: FlowStep[]; onOpenLine: OpenLine }) {
  if (flow.length === 0) return null;
  return (
    <section className="lede-card">
      <h2>How it runs</h2>
      {moment ? <p className="flow-moment">{moment}:</p> : null}
      <ol className="plain-flow">
        {flow.map((flowStep, flowIndex) => <FlowStepItem key={flowIndex} flowStep={flowStep} onOpenLine={onOpenLine} />)}
      </ol>
    </section>
  );
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

export function firstOpenStep(steps: EssayStep[], session: ReviewSession): EssayStep | undefined {
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
    <aside id={READING_PLAN_ID} className="lede-aside" aria-label="Reading plan">
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
  const hasStoryCard = (story.before && story.after) || story.whatItDoes || story.whyNeeded;
  return (
    <>
      {hasStoryCard ? (
        <section className="lede-card">
          <h2>Before and after</h2>
          <BeforeAfter story={story} />
          <details className="more"><summary>The full story</summary><Markdown text={story.tldr} /><Markdown text={story.whatItDoes} /><Markdown text={story.whyNeeded} /></details>
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

// - The saved picture stays up during a rebuild.
function hasSavedBuild(job: JobRecord | null): job is JobRecord {
  return Boolean(job?.data && job.builtAt);
}

/** The saved scene, without parts this build cannot draw. */
function savedSceneOf(page: PrPageData): Scene | null {
  const job = page.anatomy;
  if (!hasSavedBuild(job)) return null;
  const scene = (job.data as Anatomy).scene;
  const drawable = scene ? drawableScene(scene) : null;
  return drawable?.parts.length ? drawable : null;
}

/** The train view, without groups this build cannot draw. */
function trainOf(page: PrPageData): TrainView | null {
  const view = page.train;
  if (!view?.scene) return null;
  const scene = drawableTrainScene(view.scene);
  return scene.groups.length ? { ...view, scene } : null;
}

function isDrawing(job: JobRecord | null): boolean {
  return job?.status === "queued" || job?.status === "building";
}

/** A quiet line while the picture is drawn, or a retry when it failed. */
function StoryStatus({ session, onReload }: { session: ReviewSession; onReload: () => void }) {
  const job = session.page.anatomy;
  const tryAgain = () => void api.prepareAnatomy(session.route).then(onReload);
  if (isDrawing(job)) return <p className="small muted story-status"><Working size={13}>Drawing the picture...</Working></p>;
  if (job?.status !== "failed") return null;
  return (
    <p className="small muted story-status">
      <span>The picture could not be drawn.</span>
      <button className="btn btn-ghost btn-small" onClick={tryAgain}>Try again</button>
    </p>
  );
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

function AnatomyPictures({ session, data, onReload }: { session: ReviewSession; data: WalkthroughData; onReload: () => void }) {
  const train = trainOf(session.page);
  const scene = savedSceneOf(session.page);
  return (
    <>
      {train ? <TrainPicture view={train} /> : null}
      {scene ? <StoryCard session={session} data={data} scene={scene} /> : <StoryStatus session={session} onReload={onReload} />}
    </>
  );
}

const READING_PLAN_ID = "reading-plan";

function focusAndShow(element: Element | null): void {
  if (!focusQuietly(element)) return;
  element?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// - The first big-picture box, else the first story part.
function firstPictureTarget(): Element | null {
  return document.querySelector("#picture g.node[tabindex]") ?? document.querySelector(".story-stage .anatomy-part[data-clickable]");
}

// - Moves focus; leaves the route in the hash alone.
function SkipToReadingPlan() {
  const skip = (event: MouseEvent) => {
    event.preventDefault();
    focusAndShow(document.getElementById(READING_PLAN_ID));
  };
  return <a className="skip-link" href={`#${READING_PLAN_ID}`} onClick={skip}>Skip to reading plan</a>;
}

function openStepKey(steps: EssayStep[], goTo: (view: EssayView) => void, stepNumber: number): KeyHandler {
  return { run: () => goTo({ kind: "step", index: stepNumber - 1 }), when: () => stepNumber <= steps.length };
}

const PICTURE_TRIES = 20;
const PICTURE_TRY_MS = 100;

/** Focuses the picture once the fold has drawn it. */
function focusPictureWhenDrawn(triesLeft = PICTURE_TRIES): void {
  const target = firstPictureTarget();
  if (target) focusAndShow(target);
  else if (triesLeft > 0) window.setTimeout(() => focusPictureWhenDrawn(triesLeft - 1), PICTURE_TRY_MS);
}

type OverviewKeyParts = { steps: EssayStep[]; session: ReviewSession; goTo: (view: EssayView) => void; showMore: () => void };

/** n for the plan's main button, 1 to 9 for a step, b for the big picture. */
function useOverviewKeys({ steps, session, goTo, showMore }: OverviewKeyParts): void {
  const openStep = (stepNumber: number) => openStepKey(steps, goTo, stepNumber);
  useKeys("overview", {
    mainAction: () => nextAction(steps, session, goTo).go(),
    step1: openStep(1), step2: openStep(2), step3: openStep(3),
    step4: openStep(4), step5: openStep(5), step6: openStep(6),
    step7: openStep(7), step8: openStep(8), step9: openStep(9),
    focusPicture: () => {
      showMore();
      focusPictureWhenDrawn();
    },
  });
}

type MoreProps = { isOpen: boolean; onToggle: () => void; children: ReactNode };

/** Everything past the first read, folded until asked for. */
function MoreAboutThisPr({ isOpen, onToggle, children }: MoreProps) {
  return (
    <div className="lede-more">
      <button className="btn btn-ghost lede-more-toggle" aria-expanded={isOpen} onClick={onToggle}>
        {isOpen ? "Hide the details" : "More about this PR: where to look hardest, diagrams, the full story"}
      </button>
      {isOpen ? <div className="lede-more-body">{children}</div> : null}
    </div>
  );
}

function StartReadingButton({ steps, session, goTo }: { steps: EssayStep[]; session: ReviewSession; goTo: (view: EssayView) => void }) {
  const action = nextAction(steps, session, goTo);
  return <button className="btn btn-primary lede-start" onClick={action.go}>{action.label} <Icon name="arrowRight" /></button>;
}

/** Front page: start here, how it runs, the rest folded. */
export function LedePage({ session, data, steps, goTo, actions, banners, extra, onReload }: LedeProps) {
  const [isMoreOpen, setMoreOpen] = useState(false);
  useOverviewKeys({ steps, session, goTo, showMore: () => setMoreOpen(true) });
  return (
    <div className="lede">
      <PrHeader pr={session.page.pr} actions={actions} tabs={<OverviewTabs steps={steps} data={data} goTo={goTo} session={session} />} />
      {banners}
      <ChangesBanner change={data.changes?.at(-1)} onOpenFile={session.openFile} />
      <div className="lede-grid">
        <SkipToReadingPlan />
        <div className="lede-main">
          <StartHereCard story={data.walkthrough.story} />
          <AnatomyPictures session={session} data={data} onReload={onReload} />
          <PlainFlow moment={data.walkthrough.story.moment} flow={data.walkthrough.flow} onOpenLine={session.openLine} />
          <StartReadingButton steps={steps} session={session} goTo={goTo} />
          {extra}
          <MoreAboutThisPr isOpen={isMoreOpen} onToggle={() => setMoreOpen(!isMoreOpen)}>
            <AttentionList items={attentionItems(steps, data.walkthrough.hardIdeas)} goTo={goTo} />
            <Background session={session} data={data} />
          </MoreAboutThisPr>
        </div>
        <ReadingPlan session={session} steps={steps} data={data} goTo={goTo} />
      </div>
    </div>
  );
}
