import { useState } from "react";

import { api, type PrRoute, type ReviewCommentInput, type ReviewEvent, type Walkthrough } from "../api.ts";
import type { CoachingQuestionData } from "../components/Coaching.tsx";
import type { ReviewState } from "../savedState.ts";

type ConfirmedProblem = { file: string; question: CoachingQuestionData; draft: string };

type FinishPanelProps = {
  route: PrRoute;
  walkthrough: Walkthrough;
  state: ReviewState;
  setState: (update: (current: ReviewState) => ReviewState) => void;
};

const VERDICT_LABEL: Record<ReviewEvent, string> = {
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
  COMMENT: "Comment only",
};

function confirmedProblems(walkthrough: Walkthrough, state: ReviewState): ConfirmedProblem[] {
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

function toReviewComment(problem: ConfirmedProblem): ReviewCommentInput {
  return { path: problem.file, line: problem.question.line, side: problem.question.side, body: problem.draft };
}

function countDecided(walkthrough: Walkthrough, state: ReviewState): { decided: number; total: number } {
  const questions = walkthrough.tour.flatMap((stop) => stop.questions);
  const decided = questions.filter((question) => state.answers[question.id]?.decision).length;
  return { decided, total: questions.length };
}

export function FinishPanel({ route, walkthrough, state, setState }: FinishPanelProps) {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = confirmedProblems(walkthrough, state);
  const suggestion = suggestVerdict(problems.length);
  const verdict = state.verdict ?? suggestion.verdict;
  const progress = countDecided(walkthrough, state);

  const updateDraft = (questionId: string, draft: string) =>
    setState((current) => ({ ...current, answers: { ...current.answers, [questionId]: { ...current.answers[questionId], draft } } }));

  async function post() {
    const summaryLine = `${VERDICT_LABEL[verdict]} with ${problems.length} comment${problems.length === 1 ? "" : "s"}`;
    if (!window.confirm(`Post this review to GitHub? ${summaryLine}.`)) return;
    setIsPosting(true);
    setError(null);
    try {
      const { url } = await api.submitReview(route, { event: verdict, body: state.summary, comments: problems.map(toReviewComment) });
      setState((current) => ({ ...current, postedUrl: url }));
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError));
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <section>
      <h2>Finish</h2>
      <div className="card finish">
        <div className="small muted">You decided {progress.decided} of {progress.total} questions.</div>
        <h3 style={{ marginTop: 10 }}>Your comments ({problems.length})</h3>
        {problems.length === 0 ? <div className="small muted">Mark a question as "Problem" to add a comment here.</div> : null}
        {problems.map((problem) => (
          <div key={problem.question.id} className="draft">
            <div className="mono small">{problem.file}:{problem.question.line}</div>
            <textarea value={problem.draft} onChange={(event) => updateDraft(problem.question.id, event.target.value)} />
          </div>
        ))}
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
