import { useState } from "react";

import { askQuestion } from "../api.ts";
import { checkAnswerPrompt, splitVerdict } from "../components/Coaching.tsx";
import { Markdown, ProofBadge } from "../components/basics.tsx";
import { ExplanationBox, explainPrompt, useExplainChat, type ExplainChatState } from "../components/ExplainChat.tsx";
import { Icon } from "../components/Icon.tsx";
import { EMPTY_ANSWER, type QuestionAnswer } from "../savedState.ts";
import type { QuestionData } from "./model.ts";
import type { ReviewSession } from "./session.ts";

type Stage = "idle" | "answering" | "answered";

/** Settled questions stop dimming the text after them. */
export function isQuestionSettled(answer: QuestionAnswer | undefined): boolean {
  if (!answer) return false;
  return Boolean(answer.feedback || answer.revealed || answer.skipped || answer.decision || answer.explanation !== undefined);
}

function questionSpan(question: QuestionData) {
  const lastLine = Math.max(question.endLine ?? question.line, question.line);
  const range = lastLine > question.line ? { startLine: question.line, startSide: question.side } : {};
  return { line: lastLine, side: question.side, ...range };
}

function chatOf(answer: QuestionAnswer): ExplainChatState | undefined {
  return answer.explanation === undefined ? undefined : { explanation: answer.explanation, followUps: answer.followUps };
}

type BlockProps = { session: ReviewSession; file: string; question: QuestionData };

function AnsweringBox({ typed, isSending, onType, onSend, onCancel }: {
  typed: string; isSending: boolean; onType: (typed: string) => void; onSend: () => void; onCancel: () => void;
}) {
  const sendOnShortcut = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    onSend();
  };
  return (
    <div className="q-answering">
      <textarea className="input q-input" autoFocus value={typed} onChange={(event) => onType(event.target.value)} onKeyDown={sendOnShortcut}
        placeholder="What do you think? A sentence or two is plenty." />
      <div className="q-actions">
        <button className="btn btn-magenta" disabled={!typed.trim() || isSending} onClick={onSend}>{isSending ? "Sending…" : "Send to coach"}</button>
        <button className="btn btn-ghost btn-quiet" onClick={onCancel}>Cancel</button>
        <span className="q-hint">⌘ Enter to send</span>
      </div>
    </div>
  );
}

function CoachReply({ answer }: { answer: QuestionAnswer }) {
  const { verdict, reply } = splitVerdict(answer.feedback);
  return (
    <div className="q-reply">
      <p className="q-you"><span className="small-caps">You</span>{answer.typed}</p>
      <div className="q-coach-head"><span className="small-caps accent-text">Coach</span>{verdict ? <span className="tag tag-accent">{verdict}</span> : null}</div>
      <div className="q-coach-text"><Markdown text={reply || "…"} /></div>
    </div>
  );
}

function ShownAnswer({ question }: { question: QuestionData }) {
  return (
    <div className="q-shown">
      <div className="q-coach-head">
        <span className="small-caps accent-text">The answer</span>
        <span className={`tag ${question.severity === "problem" ? "tag-accent-2" : "tag-neutral"}`}>{question.severity === "problem" ? "A real problem" : "Worth knowing"}</span>
        <ProofBadge proof={question.proof} />
      </div>
      <div className="q-coach-text"><Markdown text={question.because} /></div>
      <details className="more"><summary>Show an example</summary><Markdown text={question.example} /></details>
    </div>
  );
}

function ReviewChoice({ answer, onAdd, onFine, onUndo }: { answer: QuestionAnswer; onAdd: () => void; onFine: () => void; onUndo: () => void }) {
  if (answer.decision === "problem") {
    return <p className="q-status">In your review as a draft comment · <button className="text-link" onClick={onUndo}>undo</button></p>;
  }
  if (answer.decision === "fine") return <p className="q-status">Marked fine · <button className="text-link" onClick={onUndo}>undo</button></p>;
  return (
    <div className="q-actions">
      <button className="btn btn-primary" onClick={onAdd}><Icon name="message" /> Add as review comment</button>
      <button className="btn btn-ghost" onClick={onFine}>Looks fine</button>
    </div>
  );
}

/** "Q." in the text: answer it, see the answer, get it explained, or skip for now. */
export function QuestionBlock({ session, file, question }: BlockProps) {
  const answer = session.state.answers[question.id] ?? EMPTY_ANSWER;
  const save = (changes: Partial<QuestionAnswer>) => session.saveAnswer(question.id, { ...answer, ...changes });
  const [stage, setStage] = useState<Stage>(answer.feedback ? "answered" : "idle");
  const [isSending, setIsSending] = useState(false);
  const subject = { route: session.route, file, span: questionSpan(question), topic: `the coaching question "${question.question}"` };
  const explainer = useExplainChat(subject, chatOf(answer), (chat) => save({ explanation: chat.explanation, followUps: chat.followUps }));
  const send = async () => {
    setIsSending(true);
    try {
      const onReply = (feedback: string) => session.saveAnswer(question.id, { ...answer, feedback });
      await askQuestion(session.route, { file, ...questionSpan(question), question: checkAnswerPrompt(question, answer.typed), keepInHistory: false }, onReply);
      setStage("answered");
    } finally {
      setIsSending(false);
    }
  };
  const addToReview = () => save({ decision: "problem", draft: answer.draft || question.suggestedComment });
  const hasDecision = answer.feedback !== "" || answer.revealed;
  return (
    <div className="q-block" id={`q-${question.id}`}>
      <span className="q-mark">Q.</span>
      <div className="q-body">
        <p className="q-text">{question.question}</p>
        {stage === "idle" && !answer.skipped ? (
          <div className="q-actions">
            <button className="btn btn-magenta" onClick={() => setStage("answering")}>I'll answer</button>
            <button className="btn btn-secondary" onClick={() => save({ revealed: true })}>Show me</button>
            <button className="btn btn-secondary" disabled={explainer.isWriting} onClick={() => explainer.start(explainPrompt(subject.topic, `${question.because}\n\nExample: ${question.example}`))}>
              {explainer.isWriting ? "Explaining…" : "Explain"}
            </button>
            <button className="btn btn-ghost btn-quiet" onClick={() => save({ skipped: true })}>Skip for now</button>
          </div>
        ) : null}
        {answer.skipped && stage === "idle" && !hasDecision ? <p className="q-status">Skipped · <button className="text-link" onClick={() => save({ skipped: false })}>answer it</button></p> : null}
        {stage === "answering" ? <AnsweringBox typed={answer.typed} isSending={isSending} onType={(typed) => save({ typed })} onSend={() => void send()} onCancel={() => setStage("idle")} /> : null}
        {stage === "answered" && answer.feedback ? <CoachReply answer={answer} /> : null}
        {answer.revealed ? <ShownAnswer question={question} /> : null}
        {answer.explanation !== undefined || explainer.isWriting || explainer.error ? (
          <ExplanationBox chat={chatOf(answer) ?? { explanation: "" }} isWriting={explainer.isWriting} error={explainer.error} onFollowUp={explainer.followUp} />
        ) : null}
        {hasDecision ? <ReviewChoice answer={answer} onAdd={addToReview} onFine={() => save({ decision: "fine" })} onUndo={() => save({ decision: null })} /> : null}
        {stage === "answered" ? <div className="q-actions"><button className="btn btn-ghost btn-quiet" onClick={() => setStage("answering")}>Answer again</button></div> : null}
      </div>
    </div>
  );
}
