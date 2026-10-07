import { useState } from "react";

import { askQuestion, type Concept, type PrRoute, type Walkthrough } from "../api.ts";
import type { LineSpan } from "../../../server/anchors.ts";
import { EMPTY_ANSWER, type Decision, type QuestionAnswer } from "../savedState.ts";
import { Markdown, ProofBadge } from "./basics.tsx";
import {
  ExplanationBox, explainPrompt, StillFuzzyArea, useExplainChat, useStillFuzzy, type ExplainChatState, type ExplainSubject,
} from "./ExplainChat.tsx";
import { Icon } from "./Icon.tsx";

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

/** The question's lines, as a range when it covers more than one. */
function questionSpan(question: CoachingQuestionData): LineSpan {
  const lastLine = Math.max(question.endLine ?? question.line, question.line);
  const range = lastLine > question.line ? { startLine: question.line, startSide: question.side } : {};
  return { line: lastLine, side: question.side, ...range };
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
      <div className="answer-because"><Markdown text={question.because} /></div>
      <details className="more">
        <summary>Show an example</summary>
        <Markdown text={question.example} />
      </details>
    </div>
  );
}

function DecisionButtons({ answer, onDecide }: { answer: QuestionAnswer; onDecide: (decision: Decision) => void }) {
  if (answer.decision) {
    const label = answer.decision === "problem" ? "Marked as a problem" : "Marked fine";
    return (
      <div className="button-row">
        <span className={`chip ${answer.decision === "problem" ? "problem" : "ready"}`}>{label}</span>
        <button onClick={() => onDecide(null)}>Undo</button>
      </div>
    );
  }
  return (
    <div className="button-row">
      <button className="danger" onClick={() => onDecide("problem")}>It's a problem</button>
      <button onClick={() => onDecide("fine")}>Looks fine</button>
    </div>
  );
}

function ExplainButton({ isExplaining, onExplain }: { isExplaining: boolean; onExplain: () => void }) {
  return (
    <button onClick={onExplain} disabled={isExplaining} title="A deeper, simple explanation with examples">
      <Icon name="sparkles" size={14} /> {isExplaining ? "Explaining..." : "Explain"}
    </button>
  );
}

type AnswerBoxProps = {
  answer: QuestionAnswer;
  isChecking: boolean;
  isExplaining: boolean;
  onType: (typed: string) => void;
  onCheck: () => void;
  onReveal: () => void;
  onExplain: () => void;
};

function AnswerBox({ answer, isChecking, isExplaining, onType, onCheck, onReveal, onExplain }: AnswerBoxProps) {
  const [isAnswering, setIsAnswering] = useState(answer.typed !== "");
  if (!isAnswering) {
    return (
      <div className="button-row">
        <button onClick={() => setIsAnswering(true)}>I'll answer</button>
        <button className="primary" onClick={onReveal}>Show me</button>
        <ExplainButton isExplaining={isExplaining} onExplain={onExplain} />
      </div>
    );
  }
  return (
    <>
      <textarea autoFocus placeholder="What do you think?" value={answer.typed} onChange={(event) => onType(event.target.value)} />
      <div className="button-row">
        <button className="primary" disabled={!answer.typed.trim() || isChecking} onClick={onCheck}>{isChecking ? "Checking..." : "Check my answer"}</button>
        <button onClick={onReveal}>Show me</button>
        <ExplainButton isExplaining={isExplaining} onExplain={onExplain} />
      </div>
    </>
  );
}

function questionChat(answer: QuestionAnswer): ExplainChatState | undefined {
  return answer.explanation === undefined ? undefined : { explanation: answer.explanation, followUps: answer.followUps };
}

function whatTheQuestionSaid(question: CoachingQuestionData): string {
  return `${question.because}\n\nExample: ${question.example}`;
}

export function CoachingQuestion({ route, file, question, answer = EMPTY_ANSWER, onChange }: QuestionProps) {
  const [isChecking, setIsChecking] = useState(false);
  const update = (changes: Partial<QuestionAnswer>) => onChange({ ...answer, ...changes });
  const subject: ExplainSubject = { route, file, span: questionSpan(question), topic: `the coaching question "${question.question}"` };
  // - Explaining shows the answer too, so the question counts as revealed.
  const saveChat = (chat: ExplainChatState) => onChange({ ...answer, explanation: chat.explanation, followUps: chat.followUps, revealed: true });
  const explainer = useExplainChat(subject, questionChat(answer), saveChat);
  const isExplaining = explainer.isWriting;
  const explain = () => explainer.start(explainPrompt(subject.topic, whatTheQuestionSaid(question)));

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
      <div className="callout-title"><Icon name="question" /> <strong>{question.question}</strong></div>
      {!answer.revealed ? (
        <AnswerBox answer={answer} isChecking={isChecking} isExplaining={isExplaining} onType={(typed) => update({ typed })}
          onCheck={() => void checkMyAnswer()} onReveal={() => update({ revealed: true })} onExplain={() => void explain()} />
      ) : null}
      {explainer.error && answer.explanation === undefined ? <div className="banner error" style={{ marginTop: 8 }}>Could not explain: {explainer.error}</div> : null}
      {answer.typed && answer.revealed ? <div className="small muted" style={{ marginTop: 6 }}>You said: {answer.typed}</div> : null}
      {answer.feedback ? <div className="answer-box"><h3>Coach</h3><Markdown text={answer.feedback} /></div> : null}
      {answer.revealed ? <RevealedAnswer question={question} /> : null}
      {answer.explanation !== undefined ? (
        <ExplanationBox chat={questionChat(answer)!} isWriting={isExplaining} error={explainer.error} onFollowUp={explainer.followUp} />
      ) : null}
      {answer.revealed && answer.explanation === undefined ? (
        <div className="button-row"><ExplainButton isExplaining={isExplaining} onExplain={() => void explain()} /></div>
      ) : null}
      {answer.revealed ? <DecisionButtons answer={answer} onDecide={decide} /> : null}
    </div>
  );
}

type NoteProps = {
  note: TeachingNoteData;
  concept: Concept | undefined;
  onSave: (status: Concept["status"]) => void;
  // - Where the note sits, for asking Claude about it.
  subject: Omit<ExplainSubject, "topic">;
  chat: ExplainChatState | undefined;
  onChatChange: (chat: ExplainChatState) => void;
};

function NoteBody({ note }: { note: TeachingNoteData }) {
  return (
    <>
      <Markdown text={note.explanation} />
      {note.jsExample ? <pre className="code-block"><span className="code-label">In JS</span>{note.jsExample}</pre> : null}
    </>
  );
}

/** Notes built before oneLiner existed show their first sentence. */
function oneLinerOf(note: TeachingNoteData): string {
  return note.oneLiner || note.explanation.split(/(?<=\.)\s/)[0];
}

function whatTheNoteSaid(note: TeachingNoteData): string {
  return [oneLinerOf(note), note.explanation, note.jsExample && `In JS: ${note.jsExample}`].filter(Boolean).join("\n\n");
}

export function TeachingNote({ note, concept, onSave, subject, chat, onChatChange }: NoteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fuzzy = useStillFuzzy({
    subject: { ...subject, topic: `the idea "${note.title}"` }, alreadySaid: whatTheNoteSaid(note),
    chat, onChatChange, onMarkFuzzy: () => onSave("fuzzy"),
  });
  if (concept?.status === "learned") {
    return (
      <details className="note known">
        <summary className="small"><Icon name="check" size={13} /> You know this: {note.title}</summary>
        <NoteBody note={note} />
        <div className="button-row"><button onClick={fuzzy.markFuzzy}>Actually, still fuzzy</button></div>
      </details>
    );
  }
  const isFuzzy = concept?.status === "fuzzy";
  return (
    <div className="note">
      <div className="callout-title">
        <Icon name="bulb" /> <strong>{note.title}</strong>
        <span className="chip">{note.kind}</span>
        {isFuzzy ? <span className="chip unsure">Still fuzzy</span> : null}
      </div>
      <p className="note-one-liner">{oneLinerOf(note)}</p>
      {isOpen ? <NoteBody note={note} /> : null}
      <div className="button-row">
        <button className="link-button" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Less" : "Explain more"}</button>
        <button onClick={() => onSave("learned")}>Got it</button>
        {isFuzzy ? null : <button onClick={fuzzy.markFuzzy}>Still fuzzy</button>}
      </div>
      <StillFuzzyArea fuzzy={fuzzy} chat={chat} isFuzzy={isFuzzy} />
    </div>
  );
}
