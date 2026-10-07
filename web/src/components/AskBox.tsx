import { useState } from "react";

import { askQuestion, type AskRecord, type PrRoute } from "../api.ts";
import { Markdown } from "./basics.tsx";
import { spanLabel, type LineSpan } from "../../../server/anchors.ts";

type AskBoxProps = {
  route: PrRoute;
  file: string;
  span: LineSpan;
  pastAsks: AskRecord[];
  onClose: () => void;
};

export type Exchange = { question: string; answer: string };

export function PastExchange({ exchange }: { exchange: Exchange }) {
  return (
    <div className="ask-thread">
      <div className="small"><strong>You:</strong> {exchange.question}</div>
      <Markdown text={exchange.answer || "..."} />
    </div>
  );
}

type LineAsk = { route: PrRoute; file: string; span: LineSpan; pastAsks: AskRecord[] };

/** Asks Claude about some lines and keeps the thread, answers streaming in. */
export function useLineAsk({ route, file, span, pastAsks }: LineAsk) {
  const [exchanges, setExchanges] = useState<Exchange[]>(pastAsks.map(({ question, answer }) => ({ question, answer })));
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateLatestAnswer = (answerSoFar: string) =>
    setExchanges((current) => [...current.slice(0, -1), { ...current.at(-1)!, answer: answerSoFar }]);
  const ask = async (question: string) => {
    setError(null);
    setIsAsking(true);
    setExchanges((current) => [...current, { question, answer: "" }]);
    try {
      await askQuestion(route, { file, ...span, question }, updateLatestAnswer);
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : String(askError));
    } finally {
      setIsAsking(false);
    }
  };
  return { exchanges, isAsking, error, ask };
}

export function AskBox({ route, file, span, pastAsks, onClose }: AskBoxProps) {
  const [draft, setDraft] = useState("");
  const lineAsk = useLineAsk({ route, file, span, pastAsks });
  const { exchanges, isAsking, error } = lineAsk;

  async function submit() {
    const question = draft.trim();
    if (!question || isAsking) return;
    setDraft("");
    await lineAsk.ask(question);
  }

  const submitOnEnter = (event: React.KeyboardEvent) => {
    const isPlainEnter = event.key === "Enter" && !event.shiftKey;
    if (isPlainEnter) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div className="ask">
      <div className="small muted">Ask about <span className="mono">{file}:{spanLabel(span)}</span></div>
      {exchanges.map((exchange, exchangeIndex) => <PastExchange key={exchangeIndex} exchange={exchange} />)}
      {error ? <div className="chip failed">{error}</div> : null}
      <textarea
        autoFocus
        placeholder="What does this do? Why is it here? (Enter to ask, Shift+Enter for a new line)"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={submitOnEnter}
      />
      <div className="button-row">
        <button className="primary" disabled={isAsking || !draft.trim()} onClick={() => void submit()}>{isAsking ? "Thinking..." : "Ask"}</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
