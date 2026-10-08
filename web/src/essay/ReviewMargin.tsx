import { useLayoutEffect, useRef, useState } from "react";

import { api, type ReviewEvent, type WalkthroughData } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { StillFuzzyArea, useStillFuzzy } from "../components/ExplainChat.tsx";
import { Icon } from "../components/Icon.tsx";
import { allReviewComments, confirmedProblems, summaryWithOutdated, type ConfirmedProblem } from "../pages/FinishPanel.tsx";
import type { PlacedComment } from "../placeComments.ts";
import { noteRowId } from "./CodeFigure.tsx";
import { rangeLabel, rangeOf, type EssayStep, type Footnote } from "./model.ts";
import type { ReviewSession } from "./session.ts";

const NOTE_GAP_PX = 18;

export function noteChatKey(file: string, footnote: Footnote): string {
  return `note:${file}:${footnote.note.conceptKey}:${footnote.note.line}`;
}

export function footnoteRefId(stepIndex: number, number: number): string {
  return `fnref-${stepIndex}-${number}`;
}

type NoteProps = { session: ReviewSession; file: string; footnote: Footnote; isHovered: boolean; onHover: (number: number | null) => void };

function alreadySaid(footnote: Footnote): string {
  const { note } = footnote;
  return [note.oneLiner, note.explanation, note.jsExample && `In JS: ${note.jsExample}`].filter(Boolean).join("\n\n");
}

function Sidenote({ session, file, footnote, isHovered, onHover }: NoteProps) {
  const { note } = footnote;
  const [isOpen, setIsOpen] = useState(false);
  const chatKey = noteChatKey(file, footnote);
  const chat = session.state.explainChats[chatKey];
  const concept = session.conceptsByKey.get(note.conceptKey);
  const range = rangeOf(note);
  const span = { line: range.lastLine, side: range.side, startLine: range.firstLine, startSide: range.side };
  const fuzzy = useStillFuzzy({
    subject: { route: session.route, file, span, topic: `the idea "${note.title}"` },
    alreadySaid: alreadySaid(footnote), chat, onChatChange: (updated) => session.saveExplainChat(chatKey, updated),
    onMarkFuzzy: () => session.saveConcept(note, "fuzzy"),
  });
  const isLearned = concept?.status === "learned";
  return (
    <div className={`sidenote-card ${isHovered ? "is-hovered" : ""} ${isLearned ? "is-learned" : ""}`} onMouseEnter={() => onHover(footnote.number)} onMouseLeave={() => onHover(null)}>
      <div className="sidenote-head"><span className="sidenote-number">{footnote.number}</span><strong>{note.title}</strong></div>
      <p className="sidenote-body">{note.oneLiner || note.explanation}</p>
      {isOpen ? (
        <div className="sidenote-more">
          <Markdown text={note.explanation} />
          {note.jsExample ? <pre className="code-block"><span className="code-label">In JS</span>{note.jsExample}</pre> : null}
        </div>
      ) : null}
      <button className="line-ref" onClick={() => session.openLine(file, range.firstLine, range.side)}>→ {rangeLabel(range)}</button>
      <div className="sidenote-actions">
        {isLearned ? <span className="small-caps accent-text">You know this</span> : <button className="btn btn-ghost btn-small" onClick={() => session.saveConcept(note, "learned")}>Got it</button>}
        <button className="btn btn-ghost btn-small" onClick={fuzzy.markFuzzy}>Still fuzzy</button>
        <button className="btn btn-ghost btn-small btn-quiet" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Less" : "More"}</button>
      </div>
      <StillFuzzyArea fuzzy={fuzzy} chat={chat} isFuzzy={concept?.status === "fuzzy"} />
    </div>
  );
}

type PlacedNote = { file: string; footnote: Footnote };

/** Each note sits level with its footnote marker, pushed down if the one above runs long. */
function useNotePositions(stepIndex: number, notes: PlacedNote[], layer: React.RefObject<HTMLDivElement | null>) {
  const [tops, setTops] = useState<number[]>([]);
  const measure = () => {
    const container = layer.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;
    const noteElements = [...container.querySelectorAll<HTMLElement>(":scope > .sidenote")];
    let nextFree = 0;
    const next = notes.map((placed, noteIndex) => {
      const anchor = document.getElementById(noteRowId(stepIndex, placed.footnote.number)) ?? document.getElementById(footnoteRefId(stepIndex, placed.footnote.number));
      const wanted = anchor ? anchor.getBoundingClientRect().top - containerTop - 6 : nextFree;
      const top = Math.max(wanted, nextFree);
      nextFree = top + (noteElements[noteIndex]?.offsetHeight ?? 0) + NOTE_GAP_PX;
      return Math.round(top);
    });
    setTops((current) => (current.join() === next.join() ? current : next));
  };
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    const article = document.querySelector(".essay-article");
    if (article) observer.observe(article);
    if (layer.current) observer.observe(layer.current);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });
  return tops;
}

export function Sidenotes({ session, step, hoveredNote, onHoverNote }: { session: ReviewSession; step: EssayStep; hoveredNote: number | null; onHoverNote: (number: number | null) => void }) {
  const layer = useRef<HTMLDivElement>(null);
  const notes: PlacedNote[] = step.files.flatMap((file) => file.footnotes.map((footnote) => ({ file: file.path, footnote })));
  const tops = useNotePositions(step.index, notes, layer);
  const height = tops.length ? Math.max(...tops) + 400 : 0;
  return (
    <div className="sidenote-layer" ref={layer} style={{ minHeight: height }}>
      {notes.map((placed, noteIndex) => (
        <div key={`${placed.file}:${placed.footnote.number}`} className="sidenote" style={{ top: tops[noteIndex] ?? 0 }}>
          <Sidenote session={session} file={placed.file} footnote={placed.footnote} isHovered={hoveredNote === placed.footnote.number} onHover={onHoverNote} />
        </div>
      ))}
    </div>
  );
}

/** The same notes, under their paragraph, for screens too narrow for a margin. */
export function InlineNotes({ session, file, footnotes, hoveredNote, onHoverNote }: {
  session: ReviewSession; file: string; footnotes: Footnote[]; hoveredNote: number | null; onHoverNote: (number: number | null) => void;
}) {
  if (footnotes.length === 0) return null;
  return (
    <div className="inline-notes">
      {footnotes.map((footnote) => (
        <Sidenote key={footnote.number} session={session} file={file} footnote={footnote} isHovered={hoveredNote === footnote.number} onHover={onHoverNote} />
      ))}
    </div>
  );
}

export function StepFiles({ session, step }: { session: ReviewSession; step: EssayStep }) {
  const files = step.files.filter((file) => file.diff);
  if (files.length === 0) return null;
  return (
    <div className="step-files-check">
      <div className="small-caps">Files in this step</div>
      {files.map((file) => (
        <label key={file.path} className="file-check" title={file.path}>
          <input type="checkbox" checked={session.statusOf(file.diff!) === "reviewed"} onChange={() => session.toggleReviewed(file.diff!)} />
          <span className="mono">{file.path.split("/").at(-1)}</span>
          {session.statusOf(file.diff!) === "changed" ? <span className="tag tag-accent-2">changed</span> : null}
        </label>
      ))}
    </div>
  );
}

type Draft = { key: string; location: string; text: string; status: string; isFromQuestion: boolean; open: () => void };

function lineCommentDraft(comment: PlacedComment, session: ReviewSession): Draft {
  const isEditing = session.composer?.file === comment.file && session.composer.line === comment.line;
  const status = comment.isOutdated ? "Its code changed: goes in the summary" : isEditing ? "Editing" : "Draft";
  const open = () => {
    session.openLine(comment.file, comment.line, comment.side);
    session.setComposer({ file: comment.file, line: comment.line, side: comment.side, startLine: comment.startLine, startSide: comment.startSide });
  };
  return { key: comment.id, location: `${comment.file.split("/").at(-1)}:${comment.line}`, text: comment.body, status, isFromQuestion: false, open };
}

function problemDraft(problem: ConfirmedProblem, session: ReviewSession): Draft {
  const open = () => session.openLine(problem.file, problem.question.line, problem.question.side);
  return { key: problem.question.id, location: `${problem.file.split("/").at(-1)}:${problem.question.line}`, text: problem.draft, status: "From your answer to Q.", isFromQuestion: true, open };
}

export function draftsOf(session: ReviewSession, data: WalkthroughData): Draft[] {
  const problems = confirmedProblems(data.walkthrough, session.state).map((problem) => problemDraft(problem, session));
  return [...problems, ...session.lineComments.map((comment) => lineCommentDraft(comment, session))];
}

const VERDICTS: { event: ReviewEvent; label: string }[] = [
  { event: "COMMENT", label: "Comment" },
  { event: "APPROVE", label: "Approve" },
  { event: "REQUEST_CHANGES", label: "Changes" },
];

function useSubmit(session: ReviewSession, data: WalkthroughData) {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const event = session.state.verdict ?? "COMMENT";
    const comments = allReviewComments(confirmedProblems(data.walkthrough, session.state), session.lineComments);
    if (!window.confirm(`Post your review to GitHub? ${VERDICTS.find((verdict) => verdict.event === event)?.label} with ${comments.length} comment${comments.length === 1 ? "" : "s"}.`)) return;
    setIsPosting(true);
    setError(null);
    try {
      const { url } = await api.submitReview(session.route, { event, body: summaryWithOutdated(session.state.summary, session.lineComments), comments });
      session.setState((current) => ({ ...current, postedUrl: url }));
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError));
    } finally {
      setIsPosting(false);
    }
  };
  return { isPosting, error, submit };
}

function DraftItem({ draft }: { draft: Draft }) {
  return (
    <button className="draft-item" onClick={draft.open}>
      <span className="mono accent-text">{draft.location}</span>
      <span className="draft-text">{draft.text || "(empty)"}</span>
      <span className={`draft-status ${draft.isFromQuestion ? "magenta-text" : ""}`}>{draft.status}</span>
    </button>
  );
}

function DraftCount({ count, canPost }: { count: number; canPost: boolean }) {
  return <>{count} draft{count === 1 ? "" : "s"} · {canPost ? "not yet sent" : "your own PR, nothing is posted"}</>;
}

/** Docked at the bottom of the margin, the draft list folds away so it never hides the notes. */
function DraftList({ drafts, canPost, isDocked }: { drafts: Draft[]; canPost: boolean; isDocked: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const isFoldable = isDocked && drafts.length > 0;
  const showsDrafts = isOpen || !isFoldable;
  return (
    <>
      <div className="small muted">
        <DraftCount count={drafts.length} canPost={canPost} />
        {isFoldable ? <> · <button className="text-link" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "hide" : "show"}</button></> : null}
      </div>
      {showsDrafts ? <div className="draft-list">{drafts.map((draft) => <DraftItem key={draft.key} draft={draft} />)}</div> : null}
    </>
  );
}

type YourReviewProps = { session: ReviewSession; data: WalkthroughData; canPost: boolean; isDocked?: boolean };

/** Your drafts so far, the verdict, and one button to post them all. */
export function YourReview({ session, data, canPost, isDocked = true }: YourReviewProps) {
  const drafts = draftsOf(session, data);
  const posting = useSubmit(session, data);
  const verdict = session.state.verdict ?? "COMMENT";
  const isSticky = isDocked && drafts.length > 0;
  return (
    <div className={`your-review ${isSticky ? "is-sticky" : ""}`} id="your-review">
      <div>
        <div className="your-review-title">{canPost ? "Your review" : "Your notes"}</div>
        <DraftList drafts={drafts} canPost={canPost} isDocked={isDocked} />
      </div>
      {canPost ? (
        <>
          <div className="seg" role="radiogroup" aria-label="Verdict">
            {VERDICTS.map((option) => (
              <label key={option.event} className="seg-opt">
                <input type="radio" name="verdict" checked={verdict === option.event}
                  onChange={() => session.setState((current) => ({ ...current, verdict: option.event }))} />
                {option.label}
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-block" disabled={posting.isPosting} onClick={() => void posting.submit()}>
            <Icon name="github" /> {posting.isPosting ? "Posting…" : "Submit review"}
          </button>
          {posting.error ? <div className="composer-error">Not posted: {posting.error}. Your drafts are saved.</div> : null}
          {session.state.postedUrl ? <div className="small">Posted and confirmed. <a href={session.state.postedUrl} target="_blank" rel="noreferrer">Open on GitHub</a></div> : null}
        </>
      ) : null}
    </div>
  );
}
