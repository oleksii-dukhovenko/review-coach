import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import type { Train, TrainMember, TrainView } from "../../../server/sceneSchema.ts";
import { afterRender } from "../essay/session.ts";
import { focusQuietly, useWidgetKeys } from "../keys.ts";
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

type GroupPrsProps = { part: FramePart | null; view: TrainView; onBack: (part: FramePart) => void };

/**
 * The PRs behind the part the reader points at.
 * - Escape goes back to the part.
 */
function GroupPrs({ part, view, onBack }: GroupPrsProps) {
  if (!part) return <div className="train-prs muted">Point at a part, or Tab to it, to see its PRs.</div>;
  const backOnEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onBack(part);
    }
  };
  return (
    <div className="train-prs" aria-live="polite" onKeyDown={backOnEscape}>
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

function trainHandlers(onPoint: (part: FramePart) => void, onPick: (part: FramePart, element: Element) => void): PartHandlers {
  return {
    isClickable: () => true,
    describe: (part) => `${part.label}: ${part.prs.length} ${part.prs.length === 1 ? "PR" : "PRs"}`,
    onPick,
    onPoint: (part) => part && onPoint(part),
  };
}

function firstLinkIn(card: HTMLElement | null): Element | null {
  return card?.querySelector(".train-prs a") ?? null;
}

function partElementIn(card: HTMLElement | null, part: FramePart): Element | null {
  return card?.querySelector(`.anatomy-part[data-part="${CSS.escape(part.id)}"][data-clickable]`) ?? null;
}

// - True after Tab or a key, false after a mouse click.
function isKeyboardFocused(element: Element): boolean {
  return element.matches(":focus-visible");
}

function isKeyboardOnLinks(card: HTMLElement | null): boolean {
  const active = document.activeElement;
  const isInLinks = card?.querySelector(".train-prs")?.contains(active) ?? false;
  return isInLinks && active !== null && isKeyboardFocused(active);
}

/**
 * Picking a part from the keyboard moves focus to its PR links.
 * - A mouse click leaves focus where it is.
 * - Back returns focus to the shown part.
 */
function linkFocusOf(card: RefObject<HTMLElement | null>, setPointed: (part: FramePart) => void) {
  const pick = (part: FramePart, element: Element) => {
    setPointed(part);
    if (isKeyboardFocused(element)) afterRender(() => focusQuietly(firstLinkIn(card.current)));
  };
  const back = (part: FramePart) => focusQuietly(partElementIn(card.current, part));
  return { pick, back };
}

/** The whole train as one machine: one part per group of PRs. It does not play. */
export function TrainPicture({ view }: { view: TrainView }) {
  useWidgetKeys("train");
  const frame = useMemo(() => trainFrameOf(view.scene!, view.train, view.currentNumber), [view]);
  const [pointed, setPointed] = useState<FramePart | null>(null);
  const card = useRef<HTMLElement>(null);
  const links = linkFocusOf(card, setPointed);
  // - Keyboard on a PR link: pointing elsewhere keeps the list.
  const point = (part: FramePart) => {
    if (!isKeyboardOnLinks(card.current)) setPointed(part);
  };
  const shown = pointed ?? frame.parts.find((part) => part.status === "current") ?? null;
  return (
    <section ref={card} className="story-card train-card anatomy iso" aria-label="The whole train">
      <h2 className="train-title">The whole train</h2>
      <p className="story-tldr">{view.scene!.summary}</p>
      <div className="story-player">
        <div className="story-drawing">
          <Drawing frame={frame} label={view.scene!.object} handlers={trainHandlers(point, links.pick)} />
        </div>
        <GroupPrs part={shown} view={view} onBack={links.back} />
      </div>
      <TrainKey />
    </section>
  );
}
