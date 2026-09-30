import { useState } from "react";

import { askQuestion, type Concept, type PrRoute, type Walkthrough } from "../api.ts";
import { EMPTY_ANSWER, type Decision, type QuestionAnswer } from "../savedState.ts";
import { Markdown, ProofBadge } from "./basics.tsx";

type TourStop = Walkthrough["tour"][number];
export type CoachingQuestionData = TourStop["questions"][number];
export type TeachingNoteData = TourStop["notes"][number];

const SOURCE_LABEL = { logic: "Logic", "style-guide": "Style guide", readability: "Readability" } as const;

function checkAnswerPrompt(question: CoachingQuestionData, typed: string): string {
  return [
    `Coaching question: "${question.question}"`,
    `My answer: "${typed}"`,
    `The expected answer: ${question.because}`,
    "In 3-5 short lines: what I got right, what I missed, and why it matters. Do not repeat the whole answer.",
  ].join("\n");
}

type QuestionProps = {
  route: PrRoute;
  file: string;
  question: CoachingQuestionData;
  answer: QuestionAnswer | undefined;
  onChange: (answer: QuestionAnswer) => void;
};

function RevealedAnswer({ question }: { question: CoachingQuestionData }) {
  const isProblem = question.severity === "problem";
  return (
    <div className="answer-box">
      <div className="button-row" style={{ marginTop: 0 }}>
        <span className={`chip ${isProblem ? "problem" : ""}`}>{isProblem ? "Problem" : "Worth knowing"}</span>
        <span className="chip">{SOURCE_LABEL[question.source]}</span>
        <ProofBadge proof={question.proof} />
      </div>
      <h3 style={{ marginTop: 8 }}>Because</h3>
      <Markdown text={question.because} />
      <h3>Example</h3>
      <Markdown text={question.example} />
    </div>
  );
}

function DecisionButtons({ answer, onDecide }: { answer: QuestionAnswer; onDecide: (decision: Decision) => void }) {
  if (answer.decision) {
    const label = answer.decision === "problem" ? "Added to your review" : "Marked fine";
    return (
      <div className="button-row">
        <span className={`chip ${answer.decision === "problem" ? "problem" : "ready"}`}>{label}</span>
        <button onClick={() => onDecide(null)}>Undo</button>
      </div>
    );
  }
  return (
    <div className="button-row">
      <button className="danger" onClick={() => onDecide("problem")}>Problem: add to my review</button>
      <button onClick={() => onDecide("fine")}>Looks fine</button>
    </div>
  );
}

export function CoachingQuestion({ route, file, question, answer = EMPTY_ANSWER, onChange }: QuestionProps) {
  const [isChecking, setIsChecking] = useState(false);
  const update = (changes: Partial<QuestionAnswer>) => onChange({ ...answer, ...changes });

  async function checkMyAnswer() {
    setIsChecking(true);
    try {
      const prompt = checkAnswerPrompt(question, answer.typed);
      const onFeedback = (feedback: string) => onChange({ ...answer, feedback, revealed: true });
      await askQuestion(route, { file, line: question.line, side: question.side, question: prompt, keepInHistory: false }, onFeedback);
    } finally {
      setIsChecking(false);
    }
  }

  const decide = (decision: Decision) => {
    const draft = answer.draft || question.suggestedComment;
    update({ decision, draft, revealed: true });
  };

  return (
    <div className={`question ${answer.decision ? `decided-${answer.decision}` : ""}`}>
      <strong>{question.question}</strong>
      {!answer.revealed ? (
        <>
          <textarea placeholder="What do you think? (optional)" value={answer.typed} onChange={(event) => update({ typed: event.target.value })} />
          <div className="button-row">
            <button className="primary" disabled={!answer.typed.trim() || isChecking} onClick={() => void checkMyAnswer()}>
              {isChecking ? "Checking..." : "Check my answer"}
            </button>
            <button onClick={() => update({ revealed: true })}>Show me</button>
          </div>
        </>
      ) : null}
      {answer.typed && answer.revealed ? <div className="small muted" style={{ marginTop: 6 }}>You said: {answer.typed}</div> : null}
      {answer.feedback ? <div className="answer-box"><h3>Coach</h3><Markdown text={answer.feedback} /></div> : null}
      {answer.revealed ? <RevealedAnswer question={question} /> : null}
      {answer.revealed ? <DecisionButtons answer={answer} onDecide={decide} /> : null}
    </div>
  );
}

type NoteProps = {
  note: TeachingNoteData;
  concept: Concept | undefined;
  onSave: (status: Concept["status"]) => void;
};

function NoteBody({ note }: { note: TeachingNoteData }) {
  return (
    <>
      <Markdown text={note.explanation} />
      {note.jsExample ? (
        <>
          <div className="small muted">In JS:</div>
          <pre className="code-block">{note.jsExample}</pre>
        </>
      ) : null}
    </>
  );
}

export function TeachingNote({ note, concept, onSave }: NoteProps) {
  if (concept?.status === "learned") {
    return (
      <details className="note known">
        <summary className="small">You know this: {note.title}</summary>
        <NoteBody note={note} />
        <div className="button-row"><button onClick={() => onSave("fuzzy")}>Actually, still fuzzy</button></div>
      </details>
    );
  }
  return (
    <div className="note">
      <div className="button-row" style={{ marginTop: 0 }}>
        <strong>{note.title}</strong>
        <span className="chip">{note.kind}</span>
        {concept?.status === "fuzzy" ? <span className="chip unsure">Still fuzzy</span> : null}
      </div>
      <NoteBody note={note} />
      <div className="button-row">
        <button onClick={() => onSave("learned")}>Got it, remember this</button>
        {concept?.status !== "fuzzy" ? <button onClick={() => onSave("fuzzy")}>Still fuzzy</button> : null}
      </div>
    </div>
  );
}
