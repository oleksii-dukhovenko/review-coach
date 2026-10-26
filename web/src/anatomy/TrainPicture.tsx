import { useMemo, useState } from "react";

import type { Train, TrainMember, TrainView } from "../../../server/sceneSchema.ts";
import { Drawing, type PartHandlers } from "./Drawing.tsx";
import { trainFrameOf, type FramePart, type PartStatus } from "./frame.ts";
import "./kit/iso.css";
import "./anatomy.css";

const STATUS_WORDS: Record<PartStatus, string> = { current: "This PR's part", done: "Earlier in the train", later: "Later in the train" };

function memberOf(train: Train, number: number): TrainMember | undefined {
  return train.members.find((member) => member.number === number);
}

function reviewCoachLink(train: Train, number: number): string {
  return `#/pr/${train.owner}/${train.repo}/${number}`;
}

/** "this PR", or "Open here" when review-coach has the PR. */
function RowNote({ view, number }: { view: TrainView; number: number }) {
  if (number === view.currentNumber) return <span className="small muted">this PR</span>;
  if (!view.inInbox.includes(number)) return null;
  return <a className="train-here" href={reviewCoachLink(view.train, number)}>Open here</a>;
}

function PrRow({ view, number }: { view: TrainView; number: number }) {
  const member = memberOf(view.train, number);
  const title = member?.title ?? "";
  return (
    <li data-current={number === view.currentNumber ? "" : undefined}>
      {member ? <a href={member.url} target="_blank" rel="noreferrer">#{number} {title}</a> : <span>#{number}</span>}
      <RowNote view={view} number={number} />
    </li>
  );
}

/** The PRs behind the part the reader points at. */
function GroupPrs({ part, view }: { part: FramePart | null; view: TrainView }) {
  if (!part) return <div className="train-prs muted">Point at a part to see its PRs.</div>;
  return (
    <div className="train-prs" aria-live="polite">
      <div className="train-status" data-status={part.status ?? undefined}>{STATUS_WORDS[part.status ?? "later"]}</div>
      <h3>{part.label}</h3>
      <ul>{part.prs.map((number) => <PrRow key={number} view={view} number={number} />)}</ul>
    </div>
  );
}

function TrainKey() {
  return (
    <div className="train-key" aria-hidden="true">
      <span style={{ ["--swatch" as string]: "var(--ink-new)" }}>this PR</span>
      <span style={{ ["--swatch" as string]: "var(--color-neutral-500)" }}>earlier</span>
      <span style={{ ["--swatch" as string]: "transparent", ["--swatch-edge" as string]: "var(--color-neutral-400)" }}>later</span>
    </div>
  );
}

function trainHandlers(onPoint: (part: FramePart) => void): PartHandlers {
  return {
    isClickable: () => true,
    describe: (part) => `${part.label}: ${part.prs.length} ${part.prs.length === 1 ? "PR" : "PRs"}`,
    onPick: (part) => onPoint(part),
    onPoint: (part) => part && onPoint(part),
  };
}

/** The whole train as one machine: one part per group of PRs. It does not play. */
export function TrainPicture({ view }: { view: TrainView }) {
  const frame = useMemo(() => trainFrameOf(view.scene!, view.train, view.currentNumber), [view]);
  const [pointed, setPointed] = useState<FramePart | null>(null);
  const shown = pointed ?? frame.parts.find((part) => part.status === "current") ?? null;
  return (
    <section className="story-card train-card anatomy iso" aria-label="The whole train">
      <h2 className="train-title">The whole train</h2>
      <p className="story-tldr">{view.scene!.summary}</p>
      <div className="story-player">
        <div className="story-drawing">
          <Drawing frame={frame} label={view.scene!.object} handlers={trainHandlers(setPointed)} />
        </div>
        <GroupPrs part={shown} view={view} />
      </div>
      <TrainKey />
    </section>
  );
}
