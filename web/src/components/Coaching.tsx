import { useState } from "react";

import { askQuestion, type Concept, type PrRoute, type Walkthrough } from "../api.ts";
import { EMPTY_ANSWER, type Decision, type Exchange, type QuestionAnswer } from "../savedState.ts";
import { Markdown, ProofBadge } from "./basics.tsx";
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

function explainPrompt(question: CoachingQuestionData): string {
  return [
    `Coaching question: "${question.question}"`,
    `The answer: ${question.because}`,
    `An example: ${question.example}`,
    "Explain this to me like I'm five. Assume I have never met these ideas.",
    "- Start with **TL;DR:** and the whole point in one plain sentence.",
    "- Then **What's going on:** 2-4 short bullets, everyday words, one idea each.",
    "- Then **Example:** a tiny concrete story with real values: what goes in, what happens, what someone sees.",
    "  Add a short code or JS snippet only if it makes it clearer.",
    "- Then **Why it matters:** one line, consequence first.",
    "- End with the technical term in one line.",
    "Max ~15 short lines. No jargon without a one-line gloss.",
  ].join("\n");
}

/** Restates what "this" is, since other questions may share the chat. */
function followUpPrompt(question: CoachingQuestionData, explanation: string, earlier: Exchange[], asked: string): string {
  const history = earlier.map((exchange) => `Me: ${exchange.question}\nYou: ${exchange.answer}`).join("\n\n");
  return [
    `We are talking about the coaching question: "${question.question}"`,
    `You explained it like this:\n${explanation}`,
    history ? `Our chat so far:\n${history}` : "",
    `My follow-up: ${asked}`,
    "Keep the same style: TL;DR first, plain words, a concrete example when it helps. Short.",
  ].filter(Boolean).join("\n\n");
}

/** The question's lines, as a range when it covers more than one. */
function questionSpan(question: CoachingQuestionData) {
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

function FollowUpInput({ isBusy, onSend }: { isBusy: boolean; onSend: (asked: string) => void }) {
  const [draft, setDraft] = useState("");
  const send = () => {
    const asked = draft.trim();
    if (!asked || isBusy) return;
    setDraft("");
    onSend(asked);
  };
  const sendOnEnter = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    send();
  };
  return (
    <div className="follow-up-input">
      <textarea rows={1} placeholder="Ask a follow-up... (Enter to send, Shift+Enter for a new line)" value={draft}
        onChange={(event) => setDraft(event.target.value)} onKeyDown={sendOnEnter} />
      <button className="primary" disabled={isBusy || !draft.trim()} onClick={send}>Send</button>
    </div>
  );
}

type ExplanationBoxProps = { text: string; followUps: Exchange[]; isWriting: boolean; onFollowUp: (asked: string) => void };

function ExplanationBox({ text, followUps, isWriting, onFollowUp }: ExplanationBoxProps) {
  return (
    <div className="explain-box">
      <div className="eyebrow"><Icon name="sparkles" size={13} /> Explained simply {isWriting ? <span className="chip building">Writing</span> : null}</div>
      <Markdown text={text || "..."} />
      {followUps.map((exchange, exchangeIndex) => (
        <div key={exchangeIndex} className="follow-up">
          <div className="follow-up-question">{exchange.question}</div>
          <Markdown text={exchange.answer || "..."} />
        </div>
      ))}
      {text ? <FollowUpInput isBusy={isWriting} onSend={onFollowUp} /> : null}
    </div>
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

export function CoachingQuestion({ route, file, question, answer = EMPTY_ANSWER, onChange }: QuestionProps) {
  const [isChecking, setIsChecking] = useState(false);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const update = (changes: Partial<QuestionAnswer>) => onChange({ ...answer, ...changes });

  /** Streams one answer from Claude about this question's lines. */
  async function askAboutQuestion(prompt: string, onText: (text: string) => void) {
    setIsExplaining(true);
    setExplainError(null);
    try {
      await askQuestion(route, { file, ...questionSpan(question), question: prompt, keepInHistory: false }, onText);
    } catch (error) {
      setExplainError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsExplaining(false);
    }
  }

  /** Explaining shows the answer too, so the question counts as revealed. */
  const explain = () =>
    askAboutQuestion(explainPrompt(question), (explanation) => onChange({ ...answer, explanation, revealed: true }));

  const followUp = (asked: string) => {
    const earlier = answer.followUps ?? [];
    const withAnswer = (text: string) => onChange({ ...answer, followUps: [...earlier, { question: asked, answer: text }] });
    withAnswer("");
    void askAboutQuestion(followUpPrompt(question, answer.explanation ?? "", earlier, asked), withAnswer);
  };

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
      {explainError ? <div className="banner error" style={{ marginTop: 8 }}>Could not explain: {explainError}</div> : null}
      {answer.typed && answer.revealed ? <div className="small muted" style={{ marginTop: 6 }}>You said: {answer.typed}</div> : null}
      {answer.feedback ? <div className="answer-box"><h3>Coach</h3><Markdown text={answer.feedback} /></div> : null}
      {answer.revealed ? <RevealedAnswer question={question} /> : null}
      {answer.explanation !== undefined ? (
        <ExplanationBox text={answer.explanation} followUps={answer.followUps ?? []} isWriting={isExplaining} onFollowUp={followUp} />
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

export function TeachingNote({ note, concept, onSave }: NoteProps) {
  const [isOpen, setIsOpen] = useState(false);
  if (concept?.status === "learned") {
    return (
      <details className="note known">
        <summary className="small"><Icon name="check" size={13} /> You know this: {note.title}</summary>
        <NoteBody note={note} />
        <div className="button-row"><button onClick={() => onSave("fuzzy")}>Actually, still fuzzy</button></div>
      </details>
    );
  }
  return (
    <div className="note">
      <div className="callout-title">
        <Icon name="bulb" /> <strong>{note.title}</strong>
        <span className="chip">{note.kind}</span>
        {concept?.status === "fuzzy" ? <span className="chip unsure">Still fuzzy</span> : null}
      </div>
      <p className="note-one-liner">{oneLinerOf(note)}</p>
      {isOpen ? <NoteBody note={note} /> : null}
      <div className="button-row">
        <button className="link-button" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Less" : "Explain more"}</button>
        <button onClick={() => onSave("learned")}>Got it</button>
        {concept?.status !== "fuzzy" ? <button onClick={() => onSave("fuzzy")}>Still fuzzy</button> : null}
      </div>
    </div>
  );
}
