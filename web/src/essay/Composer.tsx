import { useState } from "react";

import { askQuestion } from "../api.ts";
import { spanLabel } from "../../../server/anchors.ts";
import { AskBox } from "../components/AskBox.tsx";
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

function CoachLinks({ rewrite, hasText, onAsk }: { rewrite: ReturnType<typeof useRewrite>; hasText: boolean; onAsk: () => void }) {
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
      {" · "}<button className="text-link" onClick={onAsk}>ask about this line</button>
      {rewrite.canUndo ? <>{" · "}<button className="text-link" onClick={rewrite.undo}>undo</button></> : null}
    </span>
  );
}

/** Opens under a line: write a review comment, let the coach rewrite it, or ask about the line. */
export function Composer({ session, target, draftId, initialText = "" }: ComposerProps) {
  const [text, setText] = useState(initialText);
  const [isAsking, setIsAsking] = useState(false);
  const rewrite = useRewrite(session, target, text, setText);
  const close = () => session.setComposer(null);
  const save = () => {
    if (draftId) session.updateLineComment(draftId, text.trim());
    else session.addLineComment(target.file, target, text.trim());
    close();
  };
  const remove = () => {
    if (draftId) session.removeLineComment(draftId);
    close();
  };
  if (isAsking) {
    const pastAsks = session.asks.filter((ask) => ask.file === target.file && ask.line === target.line);
    return <div className="composer"><AskBox route={session.route} file={target.file} span={target} pastAsks={pastAsks} onClose={() => setIsAsking(false)} /></div>;
  }
  return (
    <div className="composer" onClick={(event) => event.stopPropagation()}>
      <textarea className="input" autoFocus disabled={rewrite.pending !== null} value={text} onChange={(event) => setText(event.target.value)}
        placeholder={`Your comment on line ${spanLabel(target)}. It goes in your review; nothing is posted yet.`} />
      <div className="composer-actions">
        <button className="btn btn-primary btn-small" disabled={!text.trim() || rewrite.pending !== null} onClick={save}>{draftId ? "Save" : "Add to review"}</button>
        <button className="btn btn-ghost btn-small btn-quiet" onClick={close}>Cancel</button>
        {draftId ? <button className="btn btn-ghost btn-small btn-quiet" onClick={remove}>Remove</button> : null}
        <CoachLinks rewrite={rewrite} hasText={text.trim() !== ""} onAsk={() => setIsAsking(true)} />
      </div>
      {rewrite.error ? <div className="composer-error">Could not rewrite: {rewrite.error}</div> : null}
    </div>
  );
}
