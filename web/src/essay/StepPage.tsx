import { useEffect, useState, type ReactNode } from "react";

import type { WalkthroughData } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
import { useActiveAnchor } from "../activeAnchor.ts";
import { CodeFigure } from "./CodeFigure.tsx";
import type { EssayFile, EssayStep, Footnote, QuestionData } from "./model.ts";
import { isQuestionSettled, QuestionBlock } from "./QuestionBlock.tsx";
import { footnoteRefId, InlineNotes, RewriteInPlainWords, Sidenotes, StepFiles, YourReview } from "./ReviewMargin.tsx";
import { fileAnchorId, type EssayView, type ReviewSession } from "./session.ts";

type StepPageProps = {
  session: ReviewSession;
  data: WalkthroughData;
  steps: EssayStep[];
  step: EssayStep;
  goTo: (view: EssayView) => void;
  canPost: boolean;
};

export function isStepDone(step: EssayStep, session: ReviewSession): boolean {
  const files = step.files.filter((file) => file.diff);
  return files.length > 0 && files.every((file) => session.statusOf(file.diff!) === "reviewed");
}

function scrollFraction(): number {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight;
  return scrollable <= 0 ? 1 : Math.min(1, window.scrollY / scrollable);
}

function useScrollFraction(): number {
  const [fraction, setFraction] = useState(0);
  useEffect(() => {
    const update = () => setFraction(scrollFraction());
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return fraction;
}

function ReadingProgress({ steps, step, session }: { steps: EssayStep[]; step: EssayStep | undefined; session: ReviewSession }) {
  const fraction = useScrollFraction();
  const done = steps.filter((candidate) => isStepDone(candidate, session));
  const isReadingOpenStep = step !== undefined && !isStepDone(step, session);
  const progress = (done.length + (isReadingOpenStep ? fraction : 0)) / steps.length;
  const minutesLeft = steps.filter((candidate) => !isStepDone(candidate, session)).reduce((sum, candidate) => sum + candidate.minutes, 0);
  const minutesNow = Math.max(0, Math.round(minutesLeft - (isReadingOpenStep ? step.minutes * fraction : 0)));
  return (
    <div className="reading-progress">
      <span>Reading progress</span>
      <div className="progress-track"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <span>{minutesNow === 0 ? "All done" : `About ${minutesNow} min left`}</span>
    </div>
  );
}

function RailStep({ candidate, isCurrent, currentFile, session, goTo }: {
  candidate: EssayStep; isCurrent: boolean; currentFile: string | undefined; session: ReviewSession; goTo: (view: EssayView) => void;
}) {
  const isDone = isStepDone(candidate, session);
  return (
    <li className={`rail-step ${isCurrent ? "is-current" : ""} ${isDone ? "is-done" : ""}`}>
      <span className="rail-number">{isDone ? <Icon name="checkCircle" /> : candidate.index + 1}</span>
      <span>
        <button className="rail-link" onClick={() => goTo({ kind: "step", index: candidate.index })}>{candidate.title}</button>
        {isCurrent ? candidate.files.filter((file) => !file.isSkim).map((file) => (
          <button key={file.path} className={`rail-file ${file.path === currentFile ? "is-current" : ""}`} onClick={() => session.openFile(file.path)} title={file.path}>
            {file.path.split("/").at(-1)}
          </button>
        )) : null}
      </span>
    </li>
  );
}

export type RailPlace = { step?: EssayStep; isFinish?: boolean; isFiles?: boolean };

export function Rail({ session, steps, place, goTo, currentFile }: { session: ReviewSession; steps: EssayStep[]; place: RailPlace; goTo: (view: EssayView) => void; currentFile?: string }) {
  const step = place.step;
  const { pr } = session.page;
  return (
    <nav className="essay-rail" aria-label="Steps">
      <a href="#/" className="rail-brand">Review Coach</a>
      <button className="rail-pr" onClick={() => goTo({ kind: "lede" })} title="Back to the overview">
        <span className="small muted">{pr.repo} · #{pr.number}</span>
        <span className="rail-pr-title">{pr.title}</span>
      </button>
      <button className={`rail-link rail-files ${place.isFiles ? "is-current" : ""}`} onClick={() => goTo({ kind: "files" })}>
        <Icon name="files" /> All files &amp; changes
      </button>
      <ol className="rail-steps">
        {steps.map((candidate) => (
          <RailStep key={candidate.index} candidate={candidate} isCurrent={candidate.index === step?.index} currentFile={currentFile} session={session} goTo={goTo} />
        ))}
        <li className={`rail-step ${place.isFinish ? "is-current" : ""}`}><span className="rail-number">{steps.length + 1}</span><button className="rail-link" onClick={() => goTo({ kind: "finish" })}>Finish &amp; verdict</button></li>
      </ol>
      <ReadingProgress steps={steps} step={step} session={session} />
    </nav>
  );
}

function FootnoteMarks({ stepIndex, footnotes, onHover }: { stepIndex: number; footnotes: Footnote[]; onHover: (number: number | null) => void }) {
  return (
    <>
      {footnotes.map((footnote) => (
        <sup key={footnote.number} id={footnoteRefId(stepIndex, footnote.number)} className="fn-mark"
          onMouseEnter={() => onHover(footnote.number)} onMouseLeave={() => onHover(null)}>{" "}{footnote.number}</sup>
      ))}
    </>
  );
}

type ArticleParts = { session: ReviewSession; step: EssayStep; hoveredNote: number | null; onHoverNote: (number: number | null) => void };

function hasOpenQuestion(questions: QuestionData[], session: ReviewSession): boolean {
  return questions.some((question) => !isQuestionSettled(session.state.answers[question.id]));
}

/** Text, then figures with their questions inline; text after an open question is dimmed until it is settled. */
function FileSection({ file, parts, dimState }: { file: EssayFile; parts: ArticleParts; dimState: { isDimmed: boolean } }) {
  const { session, step } = parts;
  const paragraphClass = dimState.isDimmed ? "essay-p is-dimmed" : "essay-p";
  const notes = { footnotes: file.footnotes, hovered: parts.hoveredNote, onHover: parts.onHoverNote };
  const allQuestions = [...file.figures.flatMap((figure) => figure.questionsAfter), ...file.looseQuestions];
  if (hasOpenQuestion(allQuestions, session)) dimState.isDimmed = true;
  return (
    <section className="essay-file" id={fileAnchorId(file.path)}>
      <div className="essay-file-label mono" title={file.path}>{file.path}</div>
      <div className={paragraphClass}>
        <Markdown text={file.why || "This file changes as part of this step."} />
        <FootnoteMarks stepIndex={step.index} footnotes={file.footnotes} onHover={parts.onHoverNote} />
      </div>
      <InlineNotes session={session} file={file.path} footnotes={file.footnotes} hoveredNote={parts.hoveredNote} onHoverNote={parts.onHoverNote} />
      {file.figures.map((figure) => (
        <CodeFigure key={figure.id} figure={figure} diff={file.diff!} session={session} notes={notes} showsQuestions />
      ))}
      {file.looseQuestions.map((question) => (
        <QuestionBlock key={question.id} session={session} file={file.path} question={question} onShowLines={() => session.openLine(file.path, question.line, question.side)} />
      ))}
    </section>
  );
}

function SkimmedFiles({ files, parts }: { files: EssayFile[]; parts: ArticleParts }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  if (files.length === 0) return null;
  return (
    <div className="essay-skim">
      <div className="small-caps">Also in this step · safe to skim</div>
      {files.map((file) => (
        <div key={file.path} id={fileAnchorId(file.path)}>
          <button className="text-link mono" onClick={() => setOpenPath(openPath === file.path ? null : file.path)}>
            {file.path} <span className="muted">({file.diff?.tagReason || "skim"}) · {openPath === file.path ? "hide" : "show diff"}</span>
          </button>
          {openPath === file.path ? file.figures.map((figure) => (
            <CodeFigure key={figure.id} figure={figure} diff={file.diff!} session={parts.session} />
          )) : null}
        </div>
      ))}
    </div>
  );
}

function nextView(step: EssayStep, steps: EssayStep[]): EssayView {
  return step.index + 1 < steps.length ? { kind: "step", index: step.index + 1 } : { kind: "finish" };
}

function Article({ parts, steps, goTo, children }: { parts: ArticleParts; steps: EssayStep[]; goTo: (view: EssayView) => void; children?: ReactNode }) {
  const { step, session } = parts;
  const dimState = { isDimmed: false };
  const readFiles = step.files.filter((file) => !file.isSkim);
  const finishStep = () => {
    readFiles.forEach((file) => file.diff && session.statusOf(file.diff) !== "reviewed" && session.toggleReviewed(file.diff));
    goTo(nextView(step, steps));
  };
  return (
    <article className="essay-article">
      <div className="small-caps">Step {step.index + 1} of {steps.length}</div>
      <h1 className="essay-title">{step.title}</h1>
      {step.summary || step.oneLiner ? <div className="essay-p essay-lead"><Markdown text={step.summary || step.oneLiner} /></div> : null}
      {children}
      {readFiles.map((file) => <FileSection key={file.path} file={file} parts={parts} dimState={dimState} />)}
      <SkimmedFiles files={step.files.filter((file) => file.isSkim)} parts={parts} />
      <button className="btn btn-primary btn-block essay-finish" onClick={finishStep}>
        Finish step {step.index + 1} <Icon name="arrowRight" />
      </button>
    </article>
  );
}

function useStepKeys(step: EssayStep, steps: EssayStep[], goTo: (view: EssayView) => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isTyping = target.closest("input, textarea, [contenteditable]") !== null;
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "n") goTo(nextView(step, steps));
      if (event.key === "p") goTo(step.index === 0 ? { kind: "lede" } : { kind: "step", index: step.index - 1 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step.index]);
}

/** One step as an essay: rail on the left, text and figures in the middle, notes and your review on the right. */
export function StepPage({ session, data, steps, step, goTo, canPost, children }: StepPageProps & { children?: ReactNode }) {
  const [hoveredNote, setHoveredNote] = useState<number | null>(null);
  const currentFileId = useActiveAnchor(step.files.map((file) => fileAnchorId(file.path)));
  const currentFile = step.files.find((file) => fileAnchorId(file.path) === currentFileId)?.path ?? step.files[0]?.path;
  useStepKeys(step, steps, goTo);
  const parts = { session, step, hoveredNote, onHoverNote: setHoveredNote };
  return (
    <div className="essay-step">
      <Rail session={session} steps={steps} place={{ step }} goTo={goTo} currentFile={currentFile} />
      <Article parts={parts} steps={steps} goTo={goTo}>{children}</Article>
      <aside className="essay-margin">
        <StepFiles session={session} step={step} />
        <RewriteInPlainWords session={session} data={data} />
        <Sidenotes session={session} step={step} hoveredNote={hoveredNote} onHoverNote={setHoveredNote} />
        <YourReview session={session} data={data} canPost={canPost} />
      </aside>
    </div>
  );
}
