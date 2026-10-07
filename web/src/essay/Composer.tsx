import { useState } from "react";

import { askQuestion } from "../api.ts";
import { spanLabel } from "../../../server/anchors.ts";
import { PastExchange, useLineAsk } from "../components/AskBox.tsx";
import type { ComposerTarget, ReviewSession } from "./session.ts";

const SOFTEN_PROMPT = [
  "Rewrite my review comment below so it is kind and curious: questions over commands, plain words.",
  "Keep its point and any code. Reply with only the new comment text, no preamble.",
].join(" ");

const SUGGESTION_PROMPT = [
  "Rewrite my review comment below as a GitHub suggestion for the line(s) shown:",
  "one short line of reasoning, then a ```suggestion block holding the full replacement code for exactly those lines.",
  "Reply with only the comment text, no preamble.",
].join(" ");

type Rewrite = { prompt: string; label: string };

const REWRITES: Rewrite[] = [
  { prompt: SOFTEN_PROMPT, label: "soften wording" },
  { prompt: SUGGESTION_PROMPT, label: "make it a suggestion" },
];

type ComposerProps = { session: ReviewSession; target: ComposerTarget; draftId?: string; initialText?: string };

function useRewrite(session: ReviewSession, target: ComposerTarget, text: string, setText: (text: string) => void) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoText, setUndoText] = useState<string | null>(null);
  const run = async (rewrite: Rewrite) => {
    const original = text;
    setPending(rewrite.label);
    setError(null);
    try {
      const question = `${rewrite.prompt}\n\nMy comment:\n${original}`;
      const rewritten = await askQuestion(session.route, { ...target, question, keepInHistory: false }, () => undefined);
      setText(rewritten.trim());
      setUndoText(original);
    } catch (rewriteError) {
      setText(original);
      setError(rewriteError instanceof Error ? rewriteError.message : String(rewriteError));
    } finally {
      setPending(null);
    }
  };
  const undo = () => {
    if (undoText !== null) setText(undoText);
    setUndoText(null);
  };
  return { pending, error, canUndo: undoText !== null, run, undo };
}

function CoachLinks({ rewrite, hasText }: { rewrite: ReturnType<typeof useRewrite>; hasText: boolean }) {
  if (rewrite.pending) return <span className="composer-coach">Rewriting…</span>;
  return (
    <span className="composer-coach">
      Coach:{" "}
      {REWRITES.map((option, optionIndex) => (
        <span key={option.label}>
          {optionIndex > 0 ? " · " : ""}
          <button className="text-link" disabled={!hasText} onClick={() => void rewrite.run(option)}>{option.label}</button>
        </span>
      ))}
      {rewrite.canUndo ? <>{" · "}<button className="text-link" onClick={rewrite.undo}>undo</button></> : null}
    </span>
  );
}

function useDraftActions(session: ReviewSession, target: ComposerTarget, draftId: string | undefined) {
  const close = () => session.setComposer(null);
  const save = (text: string) => {
    if (draftId) session.updateLineComment(draftId, text.trim());
    else session.addLineComment(target.file, target, text.trim());
    close();
  };
  const remove = () => {
    if (draftId) session.removeLineComment(draftId);
    close();
  };
  return { close, save, remove };
}

function pastAsksAt(session: ReviewSession, target: ComposerTarget) {
  return session.asks.filter((ask) => ask.file === target.file && ask.line === target.line);
}

/** Opens under a line: one box, either a review comment or a question for Claude. */
export function Composer({ session, target, draftId, initialText = "" }: ComposerProps) {
  const [text, setText] = useState(initialText);
  const rewrite = useRewrite(session, target, text, setText);
  const draft = useDraftActions(session, target, draftId);
  const lineAsk = useLineAsk({ route: session.route, file: target.file, span: target, pastAsks: pastAsksAt(session, target) });
  const isBusy = rewrite.pending !== null || lineAsk.isAsking;
  const hasText = text.trim() !== "";
  const askClaude = () => {
    void lineAsk.ask(text.trim());
    setText("");
  };
  return (
    <div className="composer" onClick={(event) => event.stopPropagation()}>
      {lineAsk.exchanges.map((exchange, exchangeIndex) => <PastExchange key={exchangeIndex} exchange={exchange} />)}
      {lineAsk.error ? <div className="composer-error">Claude could not answer: {lineAsk.error}</div> : null}
      <textarea className="input" autoFocus disabled={rewrite.pending !== null} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={`Line ${spanLabel(target)}: write a review comment, or a question for Claude.`} />
      <div className="composer-actions">
        <button className="btn btn-primary btn-small" disabled={!hasText || isBusy} onClick={() => draft.save(text)}>{draftId ? "Save" : "Add to review"}</button>
        <button className="btn btn-secondary btn-small" disabled={!hasText || isBusy} onClick={askClaude}>{lineAsk.isAsking ? "Claude is thinking…" : "Ask Claude"}</button>
        <button className="btn btn-ghost btn-small btn-quiet" onClick={draft.close}>Cancel</button>
        {draftId ? <button className="btn btn-ghost btn-small btn-quiet" onClick={draft.remove}>Remove</button> : null}
        <CoachLinks rewrite={rewrite} hasText={hasText} />
      </div>
      {rewrite.error ? <div className="composer-error">Could not rewrite: {rewrite.error}</div> : null}
    </div>
  );
}
