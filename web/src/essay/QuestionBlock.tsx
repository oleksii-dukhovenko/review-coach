import { useRef, useState, type RefObject } from "react";

import { askQuestion } from "../api.ts";
import { checkAnswerPrompt, splitVerdict } from "../components/Coaching.tsx";
import { Markdown, ProofBadge } from "../components/basics.tsx";
import { ExplanationBox, explainPrompt, useExplainChat, type ExplainChatState } from "../components/ExplainChat.tsx";
import { Icon } from "../components/Icon.tsx";
import { focusQuietly, useWidgetKeys } from "../keys.ts";
import { EMPTY_ANSWER, type QuestionAnswer } from "../savedState.ts";
import { rangeLabel, rangeOf, type QuestionData } from "./model.ts";
import { afterRender, type ReviewSession } from "./session.ts";

type Stage = "idle" | "answering" | "answered";
export type QuestionDirection = "next" | "previous";

const ANSWER_BUTTON = ".q-answer";
const ADD_BUTTON = ".q-add";

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

// - Open questions: those still showing an Answer button.

function isOnPage(button: HTMLElement): boolean {
  const isShown = button.getClientRects().length > 0;
  return isShown && button.closest(".zoom-panel") === null;
}

function openQuestionButtons(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`.q-block ${ANSWER_BUTTON}`)].filter(isOnPage);
}

function comesAfter(element: Element, from: Element): boolean {
  return (from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function comesBefore(element: Element, from: Element): boolean {
  return (from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
}

function focusedInArticle(): Element | undefined {
  const focused = document.activeElement;
  return focused?.closest(".essay-article") ? focused : undefined;
}

function buttonFrom(buttons: HTMLElement[], from: Element, direction: QuestionDirection): HTMLElement | undefined {
  if (direction === "next") return buttons.find((button) => comesAfter(button, from));
  return buttons.findLast((button) => comesBefore(button, from));
}

function buttonInView(buttons: HTMLElement[], direction: QuestionDirection): HTMLElement | undefined {
  if (direction === "next") return buttons.find((button) => button.getBoundingClientRect().top >= 0);
  return buttons.findLast((button) => button.getBoundingClientRect().bottom <= window.innerHeight);
}

/** Scrolls the question text into view, keeping its button shown. */
function showQuestionOf(button: HTMLElement): void {
  button.closest(".q-block")?.scrollIntoView({ block: "nearest" });
  button.scrollIntoView({ block: "nearest" });
}

/** Focuses the Answer button of the next open question; from defaults to the focused element. */
export function focusNextOpenQuestion(from: Element | null | undefined, direction: QuestionDirection): boolean {
  const buttons = openQuestionButtons();
  const anchor = from ?? focusedInArticle();
  const target = anchor ? buttonFrom(buttons, anchor, direction) : buttonInView(buttons, direction);
  if (!target) return false;
  focusQuietly(target);
  showQuestionOf(target);
  return true;
}

/** After a question folds: the next open question, else the folded one. */
function focusAfterFold(folded: HTMLElement | null): void {
  const hasMovedOn = focusNextOpenQuestion(folded, "next");
  if (!hasMovedOn) focusQuietly(folded);
}

function focusInBlock(block: HTMLElement | null, selector: string): void {
  focusQuietly(block?.querySelector(selector) ?? block);
}

/** Where focus goes inside one question after an action, once React has drawn it. */
function useQuestionFocus() {
  const blockRef = useRef<HTMLDivElement>(null);
  const foldedRef = useRef<HTMLButtonElement>(null);
  return {
    blockRef,
    foldedRef,
    isInside: () => blockRef.current?.contains(document.activeElement) ?? false,
    toAnswer: () => afterRender(() => focusInBlock(blockRef.current, ANSWER_BUTTON)),
    toDecision: () => afterRender(() => focusInBlock(blockRef.current, ADD_BUTTON)),
    afterFold: () => afterRender(() => focusAfterFold(foldedRef.current)),
  };
}

// - onShowLines: set when the question sits outside the code it asks about.
type BlockProps = { session: ReviewSession; file: string; question: QuestionData; onShowLines?: () => void };

function AnsweringBox({ typed, isSending, onType, onSend, onCancel }: {
  typed: string; isSending: boolean; onType: (typed: string) => void; onSend: () => void; onCancel: () => void;
}) {
  const handleKey = (event: React.KeyboardEvent) => {
    const isCancel = event.key === "Escape";
    const isSend = event.key === "Enter" && !event.shiftKey;
    if (isCancel || isSend) event.preventDefault();
    if (isSending) return;
    if (isCancel) onCancel();
    if (isSend && typed.trim()) onSend();
  };
  // - Read-only while sending keeps focus in the box.
  return (
    <div className="q-answering">
      <textarea className="q-input" autoFocus rows={2} value={typed} readOnly={isSending} aria-busy={isSending} onChange={(event) => onType(event.target.value)} onKeyDown={handleKey}
        placeholder="Your answer, in a sentence or two." />
      <span className="q-hint">{isSending ? "Asking the coach…" : "Enter to send · Shift+Enter for a new line · Esc to cancel"}</span>
    </div>
  );
}

function CoachReply({ answer, isWriting }: { answer: QuestionAnswer; isWriting: boolean }) {
  const { verdict, reply } = splitVerdict(answer.feedback);
  return (
    <div className="q-reply" aria-live="polite" aria-busy={isWriting}>
      <p className="q-you"><span className="small-caps">You</span>{answer.typed}</p>
      <div className="q-coach-head"><span className="small-caps accent-text">Coach</span>{verdict ? <span className="tag tag-accent">{verdict}</span> : null}</div>
      <div className="q-coach-text"><Markdown text={reply || "…"} /></div>
    </div>
  );
}

/** Tells a screen reader once the coach's whole reply is in. */
function ReplyAnnouncer({ answer, isDone }: { answer: QuestionAnswer; isDone: boolean }) {
  const { verdict } = splitVerdict(answer.feedback);
  const text = isDone ? `The coach replied${verdict ? `: ${verdict}` : ""}.` : "";
  return <p className="visually-hidden" aria-live="polite">{text}</p>;
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
    <div className="q-links">
      <button className="q-link is-main q-add" onClick={onAdd}>Add as review comment</button>
      <button className="q-link" onClick={onFine}>Looks fine</button>
    </div>
  );
}

/** One line saying where a settled question ended up. */
function summaryOf(answer: QuestionAnswer): string {
  if (answer.decision === "problem") return "In your review";
  if (answer.decision === "fine") return "Looks fine";
  if (answer.feedback) return ["Answered", splitVerdict(answer.feedback).verdict].filter(Boolean).join(" · ");
  if (answer.revealed) return "Answer shown";
  if (answer.explanation !== undefined) return "Explained";
  return "Skipped";
}

type FoldedProps = { question: QuestionData; answer: QuestionAnswer; onOpen: () => void; buttonRef: RefObject<HTMLButtonElement | null> };

function FoldedQuestion({ question, answer, onOpen, buttonRef }: FoldedProps) {
  return (
    <button ref={buttonRef} className="q-folded" onClick={onOpen} title="Open the question">
      <Icon name="check" size={14} /> <span className="q-folded-text">{question.question}</span>
      <span className="q-folded-status">{summaryOf(answer)}</span>
    </button>
  );
}

type QuestionActions = { onAnswer: () => void; onShow: () => void; onExplain: () => void; onSkip: () => void; isExplaining: boolean };

function QuestionLinks({ actions }: { actions: QuestionActions }) {
  return (
    <div className="q-links">
      <button className="q-link is-main q-answer" onClick={actions.onAnswer}>Answer</button>
      <button className="q-link" onClick={actions.onShow}>Show me</button>
      <button className="q-link" aria-disabled={actions.isExplaining} onClick={actions.onExplain}>{actions.isExplaining ? "Explaining…" : "Explain"}</button>
      <button className="q-link" onClick={actions.onSkip}>Skip</button>
    </div>
  );
}

function useAnswerSending(session: ReviewSession, file: string, question: QuestionData, answer: QuestionAnswer, onDone: () => void) {
  const [isSending, setIsSending] = useState(false);
  const send = async () => {
    setIsSending(true);
    try {
      const onReply = (feedback: string) => session.saveAnswer(question.id, { ...answer, feedback });
      await askQuestion(session.route, { file, ...questionSpan(question), question: checkAnswerPrompt(question, answer.typed), keepInHistory: false }, onReply);
      onDone();
    } finally {
      setIsSending(false);
    }
  };
  return { isSending, send };
}

/** A question in the code: answer it, see the answer, get it explained, or skip; settled ones fold to one line. */
export function QuestionBlock({ session, file, question, onShowLines }: BlockProps) {
  useWidgetKeys("answerBox");
  const answer = session.state.answers[question.id] ?? EMPTY_ANSWER;
  const save = (changes: Partial<QuestionAnswer>) => session.saveAnswer(question.id, { ...answer, ...changes });
  const [stage, setStage] = useState<Stage>(answer.feedback ? "answered" : "idle");
  const [isOpen, setIsOpen] = useState(!isQuestionSettled(answer));
  const subject = { route: session.route, file, span: questionSpan(question), topic: `the coaching question "${question.question}"` };
  const explainer = useExplainChat(subject, chatOf(answer), (chat) => save({ explanation: chat.explanation, followUps: chat.followUps }));
  const focus = useQuestionFocus();
  // - Moves focus only when it is still in this question.
  const showReply = () => {
    const isStillHere = focus.isInside();
    setStage("answered");
    if (isStillHere) focus.toDecision();
  };
  const sending = useAnswerSending(session, file, question, answer, showReply);
  // - Folding moves focus on to the next open question.
  const fold = () => {
    setIsOpen(false);
    focus.afterFold();
  };
  // - Skipping or deciding folds the question to one line.
  const settle = (changes: Partial<QuestionAnswer>) => {
    save(changes);
    fold();
  };
  const cancelAnswer = () => {
    setStage("idle");
    focus.toAnswer();
  };
  const unfold = () => {
    setIsOpen(true);
    focus.toAnswer();
  };
  const unskip = () => {
    save({ skipped: false });
    focus.toAnswer();
  };
  const undoDecision = () => {
    save({ decision: null });
    focus.toDecision();
  };
  const explain = () => {
    if (explainer.isWriting) return;
    explainer.start(explainPrompt(subject.topic, `${question.because}\n\nExample: ${question.example}`));
  };
  if (!isOpen && stage !== "answering") return <FoldedQuestion question={question} answer={answer} onOpen={unfold} buttonRef={focus.foldedRef} />;
  const actions: QuestionActions = {
    onAnswer: () => setStage("answering"),
    onShow: () => save({ revealed: true }),
    onExplain: explain,
    onSkip: () => settle({ skipped: true }),
    isExplaining: explainer.isWriting,
  };
  const hasDecision = answer.feedback !== "" || answer.revealed;
  const isSettled = isQuestionSettled(answer);
  const isReplyDone = stage === "answered" && !sending.isSending && answer.feedback !== "";
  return (
    <div className="q-block" id={`q-${question.id}`} ref={focus.blockRef}>
      <div className="q-label">
        Question · {onShowLines ? <button className="text-link" onClick={onShowLines}>{rangeLabel(rangeOf(question))}</button> : rangeLabel(rangeOf(question))}
        {isSettled ? <button className="q-fold" onClick={fold}>fold</button> : null}
      </div>
      <p className="q-text">{question.question}</p>
      {stage === "idle" && !answer.skipped ? <QuestionLinks actions={actions} /> : null}
      {answer.skipped && stage === "idle" && !hasDecision ? <p className="q-status">Skipped · <button className="text-link" onClick={unskip}>answer it</button></p> : null}
      {stage === "answering" ? <AnsweringBox typed={answer.typed} isSending={sending.isSending} onType={(typed) => save({ typed })} onSend={() => void sending.send()} onCancel={cancelAnswer} /> : null}
      {stage === "answered" && answer.feedback ? <CoachReply answer={answer} isWriting={sending.isSending} /> : null}
      <ReplyAnnouncer answer={answer} isDone={isReplyDone} />
      {answer.revealed ? <ShownAnswer question={question} /> : null}
      {answer.explanation !== undefined || explainer.isWriting || explainer.error ? (
        <ExplanationBox chat={chatOf(answer) ?? { explanation: "" }} isWriting={explainer.isWriting} error={explainer.error} onFollowUp={explainer.followUp} />
      ) : null}
      {hasDecision ? <ReviewChoice answer={answer} onAdd={() => settle({ decision: "problem", draft: answer.draft || question.suggestedComment })} onFine={() => settle({ decision: "fine" })} onUndo={undoDecision} /> : null}
      {stage === "answered" ? <div className="q-links"><button className="q-link" onClick={() => setStage("answering")}>Answer again</button></div> : null}
    </div>
  );
}
