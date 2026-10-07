import { useState } from "react";

import { api, type PrRoute, type ReviewCommentInput, type ReviewEvent, type Walkthrough } from "../api.ts";
import type { CoachingQuestionData } from "../components/Coaching.tsx";
import type { PlacedComment } from "../placeComments.ts";
import type { ReviewState } from "../savedState.ts";

export type ConfirmedProblem = { file: string; question: CoachingQuestionData; draft: string };

type FinishPanelProps = {
  route: PrRoute;
  walkthrough: Walkthrough;
  state: ReviewState;
  setState: (update: (current: ReviewState) => ReviewState) => void;
  // - Your line comments, moved to where their code is now.
  lineComments: PlacedComment[];
};

export const VERDICT_LABEL: Record<ReviewEvent, string> = {
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
  COMMENT: "Comment only",
};

export function confirmedProblems(walkthrough: Walkthrough, state: ReviewState): ConfirmedProblem[] {
  return walkthrough.tour.flatMap((stop) =>
    stop.questions
      .filter((question) => state.answers[question.id]?.decision === "problem")
      .map((question) => ({ file: stop.file, question, draft: state.answers[question.id].draft })),
  );
}

function suggestVerdict(problemCount: number): { verdict: ReviewEvent; reason: string } {
  if (problemCount === 0) return { verdict: "APPROVE", reason: "You did not confirm any problems." };
  const plural = problemCount === 1 ? "problem" : "problems";
  return { verdict: "REQUEST_CHANGES", reason: `You confirmed ${problemCount} ${plural}.` };
}

function rangeStart(startLine: number | undefined, line: number, side: "LEFT" | "RIGHT"): Partial<ReviewCommentInput> {
  const isRange = startLine !== undefined && startLine < line;
  return isRange ? { start_line: startLine, start_side: side } : {};
}

/** A question about several lines becomes a comment on those lines. */
function toReviewComment(problem: ConfirmedProblem): ReviewCommentInput {
  const { question } = problem;
  const lastLine = Math.max(question.endLine ?? question.line, question.line);
  return { path: problem.file, line: lastLine, side: question.side, body: problem.draft, ...rangeStart(question.line, lastLine, question.side) };
}

function lineCommentToReviewComment(comment: PlacedComment): ReviewCommentInput {
  const start = comment.startLine === undefined ? {} : { start_line: comment.startLine, start_side: comment.startSide ?? comment.side };
  return { path: comment.file, line: comment.line, side: comment.side, body: comment.body, ...start };
}

function isWritten(comment: PlacedComment): boolean {
  return comment.body.trim() !== "";
}

export function allReviewComments(problems: ConfirmedProblem[], lineComments: PlacedComment[]): ReviewCommentInput[] {
  const anchoredComments = lineComments.filter((comment) => isWritten(comment) && !comment.isOutdated);
  return [...problems.map(toReviewComment), ...anchoredComments.map(lineCommentToReviewComment)];
}

/** Comments whose code changed go in the summary, since their line is gone. */
export function summaryWithOutdated(summary: string, lineComments: PlacedComment[]): string {
  const outdated = lineComments.filter((comment) => isWritten(comment) && comment.isOutdated);
  const bullets = outdated.map((comment) => `- \`${comment.file}\`: ${comment.body.replace(/\n/g, " ")}`);
  return [summary, ...bullets].join("\n").trim();
}

function OwnLineComment({ comment, setState }: { comment: PlacedComment; setState: FinishPanelProps["setState"] }) {
  const updateBody = (body: string) => setState((current) => ({
    ...current,
    lineComments: current.lineComments.map((existing) => (existing.id === comment.id ? { ...existing, body } : existing)),
  }));
  const remove = () => setState((current) => ({
    ...current,
    lineComments: current.lineComments.filter((existing) => existing.id !== comment.id),
  }));
  return (
    <div className="draft">
      <div className="mono small">
        {comment.file}{comment.isOutdated ? "" : `:${comment.startLine !== undefined ? `${comment.startLine}-` : ""}${comment.line}`} <span className="muted">(your comment)</span>
        {comment.isOutdated ? <span className="chip unsure" style={{ marginLeft: 6 }}>Its code changed: goes in the summary</span> : null}
      </div>
      <textarea value={comment.body} onChange={(event) => updateBody(event.target.value)} />
      <div className="button-row"><button onClick={remove}>Remove</button></div>
    </div>
  );
}

function countDecided(walkthrough: Walkthrough, state: ReviewState): { decided: number; total: number } {
  const questions = walkthrough.tour.flatMap((stop) => stop.questions);
  const decided = questions.filter((question) => state.answers[question.id]?.decision).length;
  return { decided, total: questions.length };
}

export function FinishPanel({ route, walkthrough, state, setState, lineComments }: FinishPanelProps) {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = confirmedProblems(walkthrough, state);
  const comments = allReviewComments(problems, lineComments);
  const suggestion = suggestVerdict(problems.length);
  const verdict = state.verdict ?? suggestion.verdict;
  const progress = countDecided(walkthrough, state);

  const updateDraft = (questionId: string, draft: string) =>
    setState((current) => ({ ...current, answers: { ...current.answers, [questionId]: { ...current.answers[questionId], draft } } }));

  async function post() {
    const summaryLine = `${VERDICT_LABEL[verdict]} with ${comments.length} comment${comments.length === 1 ? "" : "s"}`;
    if (!window.confirm(`Post this review to GitHub? ${summaryLine}.`)) return;
    setIsPosting(true);
    setError(null);
    try {
      const { url } = await api.submitReview(route, { event: verdict, body: summaryWithOutdated(state.summary, lineComments), comments });
      setState((current) => ({ ...current, postedUrl: url }));
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError));
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <section id="finish">
      <h2>Finish</h2>
      <div className="card finish">
        <div className="small muted">You decided {progress.decided} of {progress.total} questions.</div>
        <h3 style={{ marginTop: 10 }}>Your comments ({problems.length + lineComments.length})</h3>
        {comments.length === 0 ? <div className="small muted">Mark a question as "Problem", or click a line number and pick "Comment on the PR".</div> : null}
        {problems.map((problem) => (
          <div key={problem.question.id} className="draft">
            <div className="mono small">{problem.file}:{problem.question.line}{problem.question.endLine > problem.question.line ? `-${problem.question.endLine}` : ""}</div>
            <textarea value={problem.draft} onChange={(event) => updateDraft(problem.question.id, event.target.value)} />
          </div>
        ))}
        {lineComments.map((comment) => <OwnLineComment key={comment.id} comment={comment} setState={setState} />)}
        <h3 style={{ marginTop: 14 }}>Summary (optional)</h3>
        <textarea value={state.summary} onChange={(event) => setState((current) => ({ ...current, summary: event.target.value }))} />
        <h3 style={{ marginTop: 14 }}>Verdict</h3>
        <div className="small muted">Suggested: {VERDICT_LABEL[suggestion.verdict]}. {suggestion.reason}</div>
        <div className="button-row">
          <select value={verdict} onChange={(event) => setState((current) => ({ ...current, verdict: event.target.value as ReviewEvent }))}>
            {Object.entries(VERDICT_LABEL).map(([event, label]) => <option key={event} value={event}>{label}</option>)}
          </select>
          <button className="primary" disabled={isPosting} onClick={() => void post()}>{isPosting ? "Posting..." : "Post review to GitHub"}</button>
        </div>
        {error ? <div className="banner error" style={{ marginTop: 10 }}>Not posted: {error}. Your drafts are saved.</div> : null}
        {state.postedUrl ? <div className="banner info" style={{ marginTop: 10 }}>Posted and confirmed on GitHub. <a href={state.postedUrl} target="_blank" rel="noreferrer">Open review</a></div> : null}
      </div>
    </section>
  );
}
