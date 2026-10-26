import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";

import type { Scene, ScenePart, StoryStep } from "../../../server/sceneSchema.ts";
import { Drawing, type PartHandlers } from "./Drawing.tsx";
import { storyFrames, type FramePart } from "./frame.ts";
import { useOnScreen, useStillness } from "./motion.ts";
import "./kit/iso.css";
import "./anatomy.css";

/** How long each step shows while the story plays. */
const STEP_MS = 3200;

const STEP_NAMES: Record<StoryStep["key"], string> = { before: "Before", change: "What the PR adds", after: "After" };

// - The progress bar fills while a step shows.
const STEP_TIME = { "--story-step-time": `${STEP_MS}ms` } as CSSProperties;

type Player = { step: number; isRunning: boolean; show: (step: number) => void; stop: () => void };

function useAutoAdvance(isRunning: boolean, step: number, advance: () => void) {
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setTimeout(advance, STEP_MS);
    return () => window.clearTimeout(timer);
  }, [isRunning, step]);
}

/**
 * Plays the steps in a loop until the reader picks one.
 * - Pauses off screen.
 * - Never plays under reduced motion.
 */
function useStoryPlayer(card: RefObject<Element | null>, count: number, startStep: number, canPlay: boolean): Player {
  const [step, setStep] = useState(startStep);
  const [isStopped, setStopped] = useState(!canPlay);
  const isOnScreen = useOnScreen(card);
  const isStill = useStillness();
  const isAllowed = !isStopped && !isStill;
  const hasSteps = count > 1;
  const isRunning = isAllowed && isOnScreen && hasSteps;
  useAutoAdvance(isRunning, step, () => setStep((current) => (current + 1) % count));
  const stop = () => setStopped(true);
  const show = (next: number) => {
    stop();
    setStep(next);
  };
  return { step, isRunning, show, stop };
}

function isForwardKey(key: string): boolean {
  return key === "ArrowDown" || key === "ArrowRight";
}

function isBackKey(key: string): boolean {
  return key === "ArrowUp" || key === "ArrowLeft";
}

function nextStepFor(key: string, step: number, count: number): number | null {
  if (isForwardKey(key)) return (step + 1) % count;
  if (isBackKey(key)) return (step - 1 + count) % count;
  if (key === "Home") return 0;
  return key === "End" ? count - 1 : null;
}

function StepButton({ step, index, player, buttonRef }: { step: StoryStep; index: number; player: Player; buttonRef: (button: HTMLButtonElement | null) => void }) {
  const isShown = index === player.step;
  return (
    <button ref={buttonRef} className="story-step" aria-pressed={isShown} onClick={() => player.show(index)}>
      <span className="story-step-key">{index + 1} · {STEP_NAMES[step.key]}</span>
      <span className="story-step-say">{step.say}</span>
      <span className="story-bar" aria-hidden="true"><i key={`${player.step}:${String(player.isRunning)}`} /></span>
    </button>
  );
}

/** The three steps beside the drawing; arrow keys move between them. */
function StepList({ steps, player }: { steps: StoryStep[]; player: Player }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const moveWithKeys = (event: KeyboardEvent) => {
    const next = nextStepFor(event.key, player.step, steps.length);
    if (next === null) return;
    event.preventDefault();
    player.show(next);
    buttons.current[next]?.focus();
  };
  return (
    <ol className="story-steps" onKeyDown={moveWithKeys} aria-label="Story steps">
      {steps.map((step, index) => (
        <li key={step.key}>
          <StepButton step={step} index={index} player={player} buttonRef={(button) => { buttons.current[index] = button; }} />
        </li>
      ))}
    </ol>
  );
}

// - Focus stops the story; the focused part stays shown.
function partHandlers(scene: Scene, player: Player, onOpenPart?: (part: ScenePart, element: Element) => void): PartHandlers {
  const scenePartOf = (part: FramePart) => scene.parts.find((candidate) => candidate.id === part.id);
  return {
    isClickable: (part) => Boolean(onOpenPart && part.code),
    describe: (part) => `${part.label}: show its code`,
    onPick: (part, element) => {
      const scenePart = scenePartOf(part);
      if (!scenePart || !onOpenPart) return;
      player.stop();
      onOpenPart(scenePart, element);
    },
    onFocus: () => player.stop(),
  };
}

type StoryPictureProps = {
  scene: Scene;
  onOpenPart?: (part: ScenePart, element: Element) => void;
  // - Shows this step and never plays.
  // - Pins a step for screenshots.
  pinnedStep?: number;
  // - Shows the scene's one-line summary on top.
  withTldr?: boolean;
};

function stepCaption(step: StoryStep | undefined): string {
  return step ? `${STEP_NAMES[step.key]}: ${step.say}` : "";
}

/** One small drawing that plays the PR's story: before, what the PR adds, after. */
export function StoryPicture({ scene, onOpenPart, pinnedStep, withTldr }: StoryPictureProps) {
  const frames = useMemo(() => storyFrames(scene), [scene]);
  const card = useRef<HTMLElement>(null);
  const player = useStoryPlayer(card, frames.length, pinnedStep ?? 0, pinnedStep === undefined);
  const label = `${scene.object} ${stepCaption(scene.steps[player.step])}`;
  return (
    <section ref={card} className="story-card anatomy iso" data-playing={player.isRunning ? "" : undefined} style={STEP_TIME} aria-label="This PR as a story">
      {withTldr ? <p className="story-tldr"><b>In one line:</b> {scene.tldr}</p> : null}
      <div className="story-player">
        <div className="story-drawing">
          <Drawing frame={frames[player.step]!} label={label} handlers={partHandlers(scene, player, onOpenPart)} />
        </div>
        <StepList steps={scene.steps} player={player} />
      </div>
      <p className="story-why"><b>Why it's better:</b> {scene.why}</p>
    </section>
  );
}
