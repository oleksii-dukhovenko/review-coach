import { useState, type ReactNode } from "react";

import { api, type AskRecord, type Concept, type DiffFile, type PrPageData, type PrRoute, type WalkthroughData } from "../api.ts";
import { AskBox } from "../components/AskBox.tsx";
import { CoachingQuestion, TeachingNote, type CoachingQuestionData, type TeachingNoteData } from "../components/Coaching.tsx";
import { DiffView, isInDiff, type LineRef } from "../components/DiffView.tsx";
import { Markdown } from "../components/basics.tsx";
import { useSavedState, type QuestionAnswer, type ReviewState } from "../savedState.ts";
import { FinishPanel } from "./FinishPanel.tsx";
import { FlowSection, RemovedCodeSection, skimFiles, StorySection, tourStopId } from "./WalkthroughSections.tsx";

type TourStop = WalkthroughData["walkthrough"]["tour"][number];

type OpenAsk = { file: string } & LineRef;

const DEFAULT_REVIEW_STATE: ReviewState = { answers: {}, summary: "", verdict: null, postedUrl: null };

function isAtLine(item: { line: number; side: string }, lineRef: LineRef): boolean {
  return item.line === lineRef.line && item.side === lineRef.side;
}

/** Notes and questions sit under the last line they cover. */
function isAfterBlock(item: { line: number; endLine?: number; side: string }, lineRef: LineRef): boolean {
  const lastLine = Math.max(item.endLine ?? item.line, item.line);
  return lastLine === lineRef.line && item.side === lineRef.side;
}

function blockEnd(item: { line: number; endLine?: number; side: "LEFT" | "RIGHT" }): LineRef {
  return { line: Math.max(item.endLine ?? item.line, item.line), side: item.side };
}

type Coaching = {
  route: PrRoute;
  asks: AskRecord[];
  conceptsByKey: Map<string, Concept>;
  answers: Record<string, QuestionAnswer>;
  openAsk: OpenAsk | null;
  setOpenAsk: (ask: OpenAsk | null) => void;
  saveAnswer: (questionId: string, answer: QuestionAnswer) => void;
  saveConcept: (note: TeachingNoteData, status: Concept["status"]) => void;
};

function LineAnnotations({ file, notes, questions, lineRef, coaching }: {
  file: string; notes: TeachingNoteData[]; questions: CoachingQuestionData[]; lineRef: LineRef; coaching: Coaching;
}) {
  const isAskOpen = coaching.openAsk?.file === file && isAtLine(coaching.openAsk, lineRef);
  const pastAsks = coaching.asks.filter((ask) => ask.file === file && ask.line === lineRef.line);
  return (
    <>
      {notes.map((note, noteIndex) => (
        <TeachingNote key={noteIndex} note={note} concept={coaching.conceptsByKey.get(note.conceptKey)} onSave={(status) => coaching.saveConcept(note, status)} />
      ))}
      {questions.map((question) => (
        <CoachingQuestion key={question.id} route={coaching.route} file={file} question={question}
          answer={coaching.answers[question.id]} onChange={(answer) => coaching.saveAnswer(question.id, answer)} />
      ))}
      {isAskOpen ? (
        <AskBox route={coaching.route} file={file} line={lineRef.line} side={lineRef.side} pastAsks={pastAsks} onClose={() => coaching.setOpenAsk(null)} />
      ) : null}
    </>
  );
}

function annotationsAt(stop: TourStop, coaching: Coaching, lineRef: LineRef): ReactNode {
  const notes = stop.notes.filter((note) => isAfterBlock(note, lineRef));
  const questions = stop.questions.filter((question) => isAfterBlock(question, lineRef));
  const isAskOpen = coaching.openAsk?.file === stop.file && isAtLine(coaching.openAsk, lineRef);
  const hasAnything = notes.length > 0 || questions.length > 0 || isAskOpen;
  if (!hasAnything) return null;
  return <LineAnnotations file={stop.file} notes={notes} questions={questions} lineRef={lineRef} coaching={coaching} />;
}

function OutsideDiffItems({ stop, file, coaching }: { stop: TourStop; file: DiffFile | undefined; coaching: Coaching }) {
  const isOutside = (item: TeachingNoteData | CoachingQuestionData) => !file || !isInDiff(file, blockEnd(item));
  const notes = stop.notes.filter(isOutside);
  const questions = stop.questions.filter(isOutside);
  if (notes.length === 0 && questions.length === 0) return null;
  return (
    <div className="tour-why">
      <div className="small muted">About lines outside the diff:</div>
      {notes.map((note, noteIndex) => (
        <TeachingNote key={noteIndex} note={note} concept={coaching.conceptsByKey.get(note.conceptKey)} onSave={(status) => coaching.saveConcept(note, status)} />
      ))}
      {questions.map((question) => (
        <CoachingQuestion key={question.id} route={coaching.route} file={stop.file} question={question}
          answer={coaching.answers[question.id]} onChange={(answer) => coaching.saveAnswer(question.id, answer)} />
      ))}
    </div>
  );
}

function TourStopView({ stop, stopNumber, file, coaching }: { stop: TourStop; stopNumber: number; file: DiffFile | undefined; coaching: Coaching }) {
  return (
    <div className="tour-stop" id={tourStopId(stop.file)}>
      <div className="tour-header">
        <strong>Stop {stopNumber}</strong>
        <span className="mono">{stop.file}</span>
        {file?.tag === "important" ? <span className="chip important" title={file.tagReason}>Important: {file.tagReason}</span> : null}
      </div>
      <div className="tour-why"><Markdown text={stop.whyItMatters} /></div>
      <OutsideDiffItems stop={stop} file={file} coaching={coaching} />
      {file ? (
        <DiffView file={file} annotationsFor={(lineRef) => annotationsAt(stop, coaching, lineRef)}
          onLineClick={(lineRef) => coaching.setOpenAsk({ file: stop.file, ...lineRef })} />
      ) : (
        <div className="card muted small">This file is not in the diff.</div>
      )}
    </div>
  );
}

function SkimSection({ files, coaching }: { files: DiffFile[]; coaching: Coaching }) {
  if (files.length === 0) return null;
  const emptyStop = (file: DiffFile): TourStop => ({ file: file.path, whyItMatters: "", notes: [], questions: [] });
  return (
    <section>
      <h2>Skim <span className="muted">({files.length})</span></h2>
      <p className="small muted">Tests, generated code, lockfiles, and renames. Open one only if you want to.</p>
      {files.map((file) => (
        <details key={file.path} className="card">
          <summary><span className="mono">{file.path}</span> <span className="chip">{file.tagReason}</span></summary>
          <DiffView file={file} annotationsFor={(lineRef) => annotationsAt(emptyStop(file), coaching, lineRef)}
            onLineClick={(lineRef) => coaching.setOpenAsk({ file: file.path, ...lineRef })} />
        </details>
      ))}
    </section>
  );
}

/** Files the tour skipped that are not skim files still get shown. */
function filesMissingFromTour(files: DiffFile[], tour: TourStop[]): DiffFile[] {
  const touredPaths = new Set(tour.map((stop) => stop.file));
  return files.filter((file) => file.tag !== "skim" && !touredPaths.has(file.path));
}

function useCoaching(route: PrRoute, page: PrPageData, answers: ReviewState["answers"], saveAnswer: Coaching["saveAnswer"]): Coaching {
  const [openAsk, setOpenAsk] = useState<OpenAsk | null>(null);
  const [concepts, setConcepts] = useState(page.concepts);
  const saveConcept = (note: TeachingNoteData, status: Concept["status"]) => {
    const concept = { conceptKey: note.conceptKey, title: note.title, status, explanation: note.explanation, jsExample: note.jsExample, seenIn: [page.pr.key] };
    void api.saveConcept(concept).then((saved) => setConcepts((current) => [...current.filter((existing) => existing.conceptKey !== saved.conceptKey), saved]));
  };
  const conceptsByKey = new Map(concepts.map((concept) => [concept.conceptKey, concept]));
  return { route, asks: page.asks, conceptsByKey, answers, openAsk, setOpenAsk, saveAnswer, saveConcept };
}

export function WalkthroughReview({ route, page }: { route: PrRoute; page: PrPageData }) {
  const data = page.job!.data as WalkthroughData;
  const [state, setState] = useSavedState<ReviewState>(route, page.reviewState, DEFAULT_REVIEW_STATE);
  const saveAnswer = (questionId: string, answer: QuestionAnswer) =>
    setState((current) => ({ ...current, answers: { ...current.answers, [questionId]: answer } }));
  const coaching = useCoaching(route, page, state.answers, saveAnswer);
  const fileByPath = new Map(data.files.map((file) => [file.path, file]));
  const extraStops = filesMissingFromTour(data.files, data.walkthrough.tour).map((file) => ({ file: file.path, whyItMatters: "Not covered by the walkthrough.", notes: [], questions: [] }));
  const stops = [...data.walkthrough.tour, ...extraStops];

  return (
    <>
      <p className="small muted">Click any line number to ask about that line.</p>
      <StorySection story={data.walkthrough.story} />
      <FlowSection flow={data.walkthrough.flow} />
      <RemovedCodeSection removed={data.removed} />
      <h2>Guided tour</h2>
      {stops.map((stop, stopIndex) => (
        <TourStopView key={stop.file} stop={stop} stopNumber={stopIndex + 1} file={fileByPath.get(stop.file)} coaching={coaching} />
      ))}
      <SkimSection files={skimFiles(data.files)} coaching={coaching} />
      <FinishPanel route={route} walkthrough={data.walkthrough} state={state} setState={setState} />
    </>
  );
}
