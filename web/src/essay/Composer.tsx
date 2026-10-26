import { useRef, useState } from "react";

import { askQuestion } from "../api.ts";
import { spanLabel } from "../../../server/anchors.ts";
import { PastExchange, useLineAsk } from "../components/AskBox.tsx";
import { modKeyName } from "../components/KeyHelp.tsx";
import { comboOf, isFocusLost } from "../keys.ts";
import { focusLine } from "./lineCursor.ts";
import { afterRender, type ComposerTarget, type ReviewSession } from "./session.ts";

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

type TextBox = { text: string; setText: (text: string) => void; refocus: () => void };

function useRewrite(session: ReviewSession, target: ComposerTarget, box: TextBox) {
  const { text, setText } = box;
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
      box.refocus();
    }
  };
  const undo = () => {
    if (undoText !== null) setText(undoText);
    setUndoText(null);
    box.refocus();
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
  const close = () => {
    session.setComposer(null);
    afterRender(() => focusLine(target.file, target.line, target.side));
  };
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

type BoxKeyActions = { save: () => void; askClaude: () => void; cancel: () => void };

function placeholderFor(target: ComposerTarget): string {
  const modKey = modKeyName();
  return `Line ${spanLabel(target)}: write a review comment, or a question for Claude. ${modKey}+Enter adds it, ${modKey}+Shift+Enter asks Claude, Esc cancels.`;
}

function actionForCombo(combo: string, actions: BoxKeyActions): (() => void) | undefined {
  const actionOfCombo: Record<string, () => void> = { Escape: actions.cancel, "Mod+Enter": actions.save, "Mod+Shift+Enter": actions.askClaude };
  return actionOfCombo[combo];
}

/** Escape cancels, Mod+Enter saves, Mod+Shift+Enter asks Claude. */
function boxKeyHandler(actions: BoxKeyActions) {
  return (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const action = actionForCombo(comboOf(event.nativeEvent), actions);
    if (!action) return;
    event.preventDefault();
    action();
  };
}

/** True when focus is lost or still inside this comment box. */
function isFocusFreeFor(box: HTMLTextAreaElement): boolean {
  return isFocusLost() || (box.closest(".composer")?.contains(document.activeElement) ?? false);
}

function focusBoxIfFree(box: HTMLTextAreaElement | null): void {
  if (box && isFocusFreeFor(box)) box.focus();
}

function pastAsksAt(session: ReviewSession, target: ComposerTarget) {
  return session.asks.filter((ask) => ask.file === target.file && ask.line === target.line);
}

/** Opens under a line: one box, either a review comment or a question for Claude. */
export function Composer({ session, target, draftId, initialText = "" }: ComposerProps) {
  const [text, setText] = useState(initialText);
  const textBox = useRef<HTMLTextAreaElement>(null);
  // - The clicked coach link or Ask button goes away; focus stays in the box.
  const refocus = () => afterRender(() => focusBoxIfFree(textBox.current));
  const rewrite = useRewrite(session, target, { text, setText, refocus });
  const draft = useDraftActions(session, target, draftId);
  const lineAsk = useLineAsk({ route: session.route, file: target.file, span: target, pastAsks: pastAsksAt(session, target) });
  const isBusy = rewrite.pending !== null || lineAsk.isAsking;
  const hasText = text.trim() !== "";
  const canSend = hasText && !isBusy;
  const askClaude = () => {
    void lineAsk.ask(text.trim());
    setText("");
    refocus();
  };
  const handleKey = boxKeyHandler({
    save: () => {
      if (canSend) draft.save(text);
    },
    askClaude: () => {
      if (canSend) askClaude();
    },
    cancel: draft.close,
  });
  return (
    <div className="composer" onClick={(event) => event.stopPropagation()}>
      {lineAsk.exchanges.map((exchange, exchangeIndex) => <PastExchange key={exchangeIndex} exchange={exchange} />)}
      {lineAsk.error ? <div className="composer-error">Claude could not answer: {lineAsk.error}</div> : null}
      <textarea ref={textBox} className="input" autoFocus disabled={rewrite.pending !== null} value={text} onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKey} placeholder={placeholderFor(target)} />
      <div className="composer-actions">
        <button className="btn btn-primary btn-small" disabled={!canSend} onClick={() => draft.save(text)}>{draftId ? "Save" : "Add to review"}</button>
        <button className="btn btn-secondary btn-small" disabled={!canSend} onClick={askClaude}>{lineAsk.isAsking ? "Claude is thinking…" : "Ask Claude"}</button>
        <button className="btn btn-ghost btn-small btn-quiet" onClick={draft.close}>Cancel</button>
        {draftId ? <button className="btn btn-ghost btn-small btn-quiet" onClick={draft.remove}>Remove</button> : null}
        <CoachLinks rewrite={rewrite} hasText={hasText} />
      </div>
      {rewrite.error ? <div className="composer-error">Could not rewrite: {rewrite.error}</div> : null}
    </div>
  );
}
