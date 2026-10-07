import { useState } from "react";

import { askQuestion, type PrRoute } from "../api.ts";
import type { LineSpan } from "../../../server/anchors.ts";
import type { Exchange } from "../savedState.ts";
import { Markdown } from "./basics.tsx";
import { Icon } from "./Icon.tsx";

export type ExplainChatState = { explanation: string; followUps?: Exchange[] };

// - What Claude is told about; repeated on follow-ups since other chats share the session.
export type ExplainSubject = { route: PrRoute; file: string; span: LineSpan; topic: string };

const SIMPLE_FORMAT = [
  "Explain it like I'm five. Assume I have never met these ideas.",
  "- Start with **TL;DR:** and the whole point in one plain sentence.",
  "- Then **What's going on:** 2-4 short bullets, everyday words, one idea each.",
  "- Then **Example:** a tiny concrete story with real values: what goes in, what happens, what someone sees.",
  "  Add a short code or JS snippet only if it makes it clearer.",
  "- Then **Why it matters:** one line, consequence first.",
  "- End with the technical term in one line.",
  "Max ~15 short lines. No jargon without a one-line gloss.",
].join("\n");

/** Asks for a simple explanation of a topic, given what was already said. */
export function explainPrompt(topic: string, alreadySaid: string): string {
  return [`Topic: ${topic}`, `What I was shown:\n${alreadySaid}`, SIMPLE_FORMAT].join("\n\n");
}

/** Asks again in other words, for something that is still fuzzy. */
export function stillFuzzyPrompt(topic: string, alreadySaid: string): string {
  return [
    `I am still fuzzy on: ${topic}`,
    `What I was shown, which did not land:\n${alreadySaid}`,
    "Explain it again in different words and with a different example. Do not repeat what I was shown.",
    SIMPLE_FORMAT,
  ].join("\n\n");
}

function followUpPrompt(topic: string, explanation: string, earlier: Exchange[], asked: string): string {
  const history = earlier.map((exchange) => `Me: ${exchange.question}\nYou: ${exchange.answer}`).join("\n\n");
  return [
    `We are talking about: ${topic}`,
    `You explained it like this:\n${explanation}`,
    history ? `Our chat so far:\n${history}` : "",
    `My follow-up: ${asked}`,
    "Keep the same style: TL;DR first, plain words, a concrete example when it helps. Short.",
  ].filter(Boolean).join("\n\n");
}

/** Streams explanations and follow-ups about one thing, and reports each update. */
export function useExplainChat(subject: ExplainSubject, chat: ExplainChatState | undefined, onChange: (chat: ExplainChatState) => void) {
  const [isWriting, setIsWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stream(prompt: string, onText: (text: string) => void) {
    setIsWriting(true);
    setError(null);
    try {
      await askQuestion(subject.route, { file: subject.file, ...subject.span, question: prompt, keepInHistory: false }, onText);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : String(askError));
    } finally {
      setIsWriting(false);
    }
  }

  const start = (prompt: string) => void stream(prompt, (explanation) => onChange({ explanation, followUps: [] }));

  const followUp = (asked: string) => {
    const earlier = chat?.followUps ?? [];
    const withAnswer = (answer: string) => onChange({ explanation: chat?.explanation ?? "", followUps: [...earlier, { question: asked, answer }] });
    withAnswer("");
    void stream(followUpPrompt(subject.topic, chat?.explanation ?? "", earlier, asked), withAnswer);
  };

  return { isWriting, error, start, followUp };
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

type ExplanationBoxProps = {
  chat: ExplainChatState;
  isWriting: boolean;
  error: string | null;
  onFollowUp: (asked: string) => void;
  title?: string;
};

export function ExplanationBox({ chat, isWriting, error, onFollowUp, title = "Explained simply" }: ExplanationBoxProps) {
  return (
    <div className="explain-box">
      <div className="eyebrow"><Icon name="sparkles" size={13} /> {title} {isWriting ? <span className="chip building">Writing</span> : null}</div>
      <Markdown text={chat.explanation || "..."} />
      {(chat.followUps ?? []).map((exchange, exchangeIndex) => (
        <div key={exchangeIndex} className="follow-up">
          <div className="follow-up-question">{exchange.question}</div>
          <Markdown text={exchange.answer || "..."} />
        </div>
      ))}
      {error ? <div className="banner error" style={{ marginTop: 8 }}>Could not explain: {error}</div> : null}
      {chat.explanation ? <FollowUpInput isBusy={isWriting} onSend={onFollowUp} /> : null}
    </div>
  );
}

type StillFuzzyProps = {
  subject: ExplainSubject;
  // - The explanation that did not land; Claude is asked not to repeat it.
  alreadySaid: string;
  chat: ExplainChatState | undefined;
  onChatChange: (chat: ExplainChatState) => void;
  onMarkFuzzy: () => void;
};

/** "Still fuzzy" saves the concept as fuzzy and asks Claude for another way in. */
export function useStillFuzzy({ subject, alreadySaid, chat, onChatChange, onMarkFuzzy }: StillFuzzyProps) {
  const explainer = useExplainChat(subject, chat, onChatChange);
  const explainAgain = () => explainer.start(stillFuzzyPrompt(subject.topic, alreadySaid));
  const markFuzzy = () => {
    onMarkFuzzy();
    if (!chat) explainAgain();
  };
  return { explainer, explainAgain, markFuzzy };
}

/** The other-words explanation, or a button to ask for one. */
export function StillFuzzyArea({ fuzzy, chat, isFuzzy }: { fuzzy: ReturnType<typeof useStillFuzzy>; chat: ExplainChatState | undefined; isFuzzy: boolean }) {
  const { explainer } = fuzzy;
  const hasSomethingToShow = chat !== undefined || explainer.isWriting || explainer.error !== null;
  if (hasSomethingToShow) {
    return <ExplanationBox chat={chat ?? { explanation: "" }} isWriting={explainer.isWriting} error={explainer.error}
      onFollowUp={explainer.followUp} title="Another way to see it" />;
  }
  if (!isFuzzy) return null;
  return (
    <div className="button-row">
      <button onClick={fuzzy.explainAgain}><Icon name="sparkles" size={14} /> Explain it another way</button>
    </div>
  );
}
