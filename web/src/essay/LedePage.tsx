import type { ReactNode } from "react";

import type { WalkthroughData } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { BeforeAfter, ChangesBanner, FlowSection, GlossaryTerm, RemovedCodeSection } from "../pages/WalkthroughSections.tsx";
import { ZoomablePicture } from "./PictureZoom.tsx";
import { attentionItems, type AttentionItem, type EssayStep } from "./model.ts";
import type { EssayView, ReviewSession } from "./session.ts";

type LedeProps = {
  session: ReviewSession;
  data: WalkthroughData;
  steps: EssayStep[];
  goTo: (view: EssayView) => void;
  // - Auto-update, Start over, GitHub.
  actions: ReactNode;
  // - "Comments waiting on you" for your own PRs.
  extra?: ReactNode;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** "today", "yesterday", "3 days ago", or a date. */
export function relativeDay(isoTime: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(isoTime).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(isoTime).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function Dateline({ session }: { session: ReviewSession }) {
  const { pr } = session.page;
  const when = pr.createdAt ? `opened ${relativeDay(pr.createdAt)}` : `updated ${relativeDay(pr.updatedAt)}`;
  return <div className="dateline">{pr.owner} / {pr.repo} · Pull request #{pr.number} · {when}{pr.isDraft ? " · draft" : ""} · by {pr.author}</div>;
}

function standfirstOf(data: WalkthroughData): string {
  const story = data.walkthrough.story;
  return story.tldr || story.whatItDoes.split(/(?<=\.)\s/)[0];
}

function AttentionList({ items, goTo }: { items: AttentionItem[]; goTo: (view: EssayView) => void }) {
  return (
    <div>
      <div className="small-caps magenta-text">Where to spend your attention</div>
      <ol className="attention-list">
        {items.map((item, itemIndex) => (
          <li key={`${item.title}:${itemIndex}`} className={item.isLowRisk ? "is-low-risk" : ""}>
            <span className="attention-rank">{itemIndex + 1}</span>
            <div>
              <div className="attention-title">{item.title}</div>
              <p className="attention-body">{item.body} <button className="step-ref" onClick={() => goTo({ kind: "step", index: item.stepIndex })}>{item.stepRef}</button></p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function diffStats(data: WalkthroughData) {
  const lines = data.files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines));
  return { files: data.files.length, adds: lines.filter((line) => line.kind === "add").length, dels: lines.filter((line) => line.kind === "del").length };
}

function Contents({ steps, data, goTo }: { steps: EssayStep[]; data: WalkthroughData; goTo: (view: EssayView) => void }) {
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  const stats = diffStats(data);
  return (
    <div>
      <div className="small-caps">Contents · about {total} min</div>
      <ol className="contents-list">
        {steps.map((step) => (
          <li key={step.index}>
            <span className="muted">{step.index + 1}</span>
            <button className="contents-link" onClick={() => goTo({ kind: "step", index: step.index })}>{step.title}</button>
            <span className="muted">{step.minutes} min</span>
          </li>
        ))}
      </ol>
      <div className="lede-stats mono">
        <span>{stats.files} files</span><span className="accent-text">+{stats.adds}</span><span className="magenta-text">−{stats.dels}</span>
      </div>
      <div className="lede-actions">
        <button className="btn btn-primary" onClick={() => goTo({ kind: "step", index: 0 })}>Start reading →</button>
        <button className="btn btn-secondary" onClick={() => goTo({ kind: "files" })}>See all {data.files.length} files</button>
      </div>
    </div>
  );
}

function Background({ session, data }: { session: ReviewSession; data: WalkthroughData }) {
  const { story } = data.walkthrough;
  return (
    <div className="lede-background">
      <h2 className="lede-section-title">Before and after</h2>
      <BeforeAfter story={story} />
      {story.glossary.length ? <div className="glossary-row"><span className="small muted">Words you'll see:</span>{story.glossary.map((entry) => <GlossaryTerm key={entry.term} entry={entry} />)}</div> : null}
      <details className="more"><summary>The full story</summary><Markdown text={story.whatItDoes} /><Markdown text={story.whyNeeded} /></details>
      <ZoomablePicture session={session} data={data} />
      <FlowSection route={session.route} flow={data.walkthrough.flow} files={data.files} onOpenLine={session.openLine} />
      <RemovedCodeSection removed={data.removed} />
    </div>
  );
}

/** The front page: what this PR does, where to look hardest, and how long it takes. */
export function LedePage({ session, data, steps, goTo, actions, extra }: LedeProps) {
  return (
    <div className="lede">
      <div className="lede-top"><Dateline session={session} /><div className="lede-top-actions">{actions}</div></div>
      <h1 className="lede-headline">{session.page.pr.title}</h1>
      <p className="lede-standfirst">{standfirstOf(data)}</p>
      <ChangesBanner change={data.changes?.at(-1)} onOpenFile={session.openFile} />
      <div className="lede-grid">
        <AttentionList items={attentionItems(steps, data.walkthrough.hardIdeas)} goTo={goTo} />
        <Contents steps={steps} data={data} goTo={goTo} />
      </div>
      {extra}
      <Background session={session} data={data} />
    </div>
  );
}
