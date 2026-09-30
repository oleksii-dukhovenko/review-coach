import { useState } from "react";

import { api, type PrPageData, type PrRoute, type PullRequest, type Triage, type TriageData } from "../api.ts";
import { AskBox } from "../components/AskBox.tsx";
import { CopyButton, Markdown, PatchBlock, ProofBadge } from "../components/basics.tsx";
import { useSavedState, type MyPrState, type ReplyState } from "../savedState.ts";

type Thread = PullRequest["openThreads"][number];
type ThreadVerdict = Triage["threads"][number];

const VERDICT_LABEL = { valid: "Valid", noise: "Noise", unsure: "Unsure" } as const;

const EMPTY_REPLY: ReplyState = { draft: "", postedUrl: null };

function ReviewerComments({ thread }: { thread: Thread }) {
  return (
    <details>
      <summary className="small">What they wrote ({thread.comments.length} comment{thread.comments.length === 1 ? "" : "s"})</summary>
      {thread.comments.map((comment) => (
        <div key={comment.databaseId} className="ask-thread">
          <div className="small"><strong>{comment.author}</strong></div>
          <Markdown text={comment.body} />
        </div>
      ))}
    </details>
  );
}

function ReplyEditor({ route, thread, reply, onChange }: { route: PrRoute; thread: Thread; reply: ReplyState; onChange: (reply: ReplyState) => void }) {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (!window.confirm("Post this reply to GitHub?")) return;
    setIsPosting(true);
    setError(null);
    try {
      const { url } = await api.reply(route, thread.id, reply.draft);
      onChange({ ...reply, postedUrl: url });
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError));
    } finally {
      setIsPosting(false);
    }
  }

  if (reply.postedUrl) return <div className="banner info">Reply posted and confirmed. <a href={reply.postedUrl} target="_blank" rel="noreferrer">Open</a></div>;
  return (
    <div className="draft">
      <h3>Draft reply</h3>
      <textarea value={reply.draft} onChange={(event) => onChange({ ...reply, draft: event.target.value })} />
      <div className="button-row">
        <button className="primary" disabled={isPosting || !reply.draft.trim()} onClick={() => void post()}>{isPosting ? "Posting..." : "Post reply"}</button>
      </div>
      {error ? <div className="banner error" style={{ marginTop: 8 }}>Not posted: {error}. Your draft is saved.</div> : null}
    </div>
  );
}

function ProposedFix({ patch }: { patch: string }) {
  return (
    <div className="draft">
      <h3>Proposed fix</h3>
      <p className="small muted">You apply this yourself. Nothing changes in your code until you do.</p>
      <PatchBlock patch={patch} />
      <div className="button-row"><CopyButton text={patch} label="Copy patch" /></div>
    </div>
  );
}

type ThreadCardProps = {
  route: PrRoute;
  page: PrPageData;
  thread: Thread;
  verdict: ThreadVerdict | undefined;
  reply: ReplyState;
  onReplyChange: (reply: ReplyState) => void;
};

function ThreadCard({ route, page, thread, verdict, reply, onReplyChange }: ThreadCardProps) {
  const [isAskOpen, setIsAskOpen] = useState(false);
  const location = `${thread.path}:${thread.line ?? "outdated"}`;
  const draftReply = reply.draft || verdict?.draftReply || "";
  const pastAsks = page.asks.filter((ask) => ask.file === thread.path && ask.line === thread.line);
  return (
    <div className="card">
      <div className="button-row" style={{ marginTop: 0, alignItems: "center" }}>
        <span className="mono small">{location}</span>
        <span className="small muted">from {thread.comments[0]?.author}</span>
        {verdict ? <span className={`chip ${verdict.verdict}`}>{VERDICT_LABEL[verdict.verdict]}</span> : <span className="chip">New since prepared</span>}
        {verdict ? <ProofBadge proof={verdict.proof} /> : null}
      </div>
      <ReviewerComments thread={thread} />
      {verdict ? (
        <>
          <h3 style={{ marginTop: 10 }}>What they mean</h3>
          <Markdown text={verdict.meaning} />
          <h3>{verdict.verdict === "valid" ? "Why it's valid" : "Why"}</h3>
          <Markdown text={verdict.why} />
          <h3>Example</h3>
          <Markdown text={verdict.example} />
          {verdict.proposedFix ? <ProposedFix patch={verdict.proposedFix} /> : null}
          {verdict.verdict !== "valid" ? <ReplyEditor route={route} thread={thread} reply={{ ...reply, draft: draftReply }} onChange={onReplyChange} /> : null}
        </>
      ) : null}
      <div className="button-row">
        {thread.line ? <button onClick={() => setIsAskOpen(!isAskOpen)}>{isAskOpen ? "Hide questions" : "Ask about this"}</button> : null}
      </div>
      {isAskOpen && thread.line ? (
        <AskBox route={route} file={thread.path} line={thread.line} side={thread.side} pastAsks={pastAsks} onClose={() => setIsAskOpen(false)} />
      ) : null}
    </div>
  );
}

export function MyPrReview({ route, page }: { route: PrRoute; page: PrPageData }) {
  const data = page.job!.data as TriageData;
  const [state, setState] = useSavedState<MyPrState>(route, page.reviewState, { replies: {} });
  const verdictByThread = new Map(data.triage.threads.map((verdict) => [verdict.threadId, verdict]));
  const saveReply = (threadId: string, reply: ReplyState) =>
    setState((current) => ({ ...current, replies: { ...current.replies, [threadId]: reply } }));

  return (
    <>
      <h2>Comments waiting on you ({page.pr.openThreads.length})</h2>
      {page.pr.openThreads.length === 0 ? <div className="empty">No open comments.</div> : null}
      {page.pr.openThreads.map((thread) => (
        <ThreadCard key={thread.id} route={route} page={page} thread={thread} verdict={verdictByThread.get(thread.id)}
          reply={state.replies[thread.id] ?? EMPTY_REPLY} onReplyChange={(reply) => saveReply(thread.id, reply)} />
      ))}
    </>
  );
}
