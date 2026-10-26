import { useRef, useState, type RefObject } from "react";

import { api, type PrPageData, type PrRoute, type PullRequest, type Triage, type TriageData } from "../api.ts";
import { AskBox } from "../components/AskBox.tsx";
import { CopyButton, Markdown, PatchBlock, ProofBadge } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
import { afterRender } from "../essay/session.ts";
import { comboOf, focusQuietly, isFocusLost, useWidgetKeys } from "../keys.ts";
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

function replyLabelOf(thread: Thread): string {
  return `Draft reply to ${thread.comments[0]?.author ?? "the reviewer"} on ${thread.path}`;
}

/** Focuses the element once React has drawn it, unless focus is elsewhere. */
function focusIfLostAfterRender(elementRef: RefObject<HTMLElement | null>): void {
  afterRender(() => {
    if (isFocusLost()) focusQuietly(elementRef.current);
  });
}

type ReplyEditorProps = { route: PrRoute; thread: Thread; reply: ReplyState; onChange: (reply: ReplyState) => void };

/** Posts a reply after asking, and keeps focus on the result. */
function useReplyPosting({ route, thread, reply, onChange }: ReplyEditorProps) {
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const postedBannerRef = useRef<HTMLDivElement>(null);
  const postButtonRef = useRef<HTMLButtonElement>(null);
  const canPost = !isPosting && reply.draft.trim() !== "";

  async function post() {
    if (!window.confirm("Post this reply to GitHub?")) return;
    setIsPosting(true);
    setError(null);
    try {
      const { url } = await api.reply(route, thread.id, reply.draft);
      onChange({ ...reply, postedUrl: url });
      focusIfLostAfterRender(postedBannerRef);
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : String(postError));
      focusIfLostAfterRender(postButtonRef);
    } finally {
      setIsPosting(false);
    }
  }

  return { isPosting, error, canPost, post, postedBannerRef, postButtonRef };
}

function ReplyEditor(props: ReplyEditorProps) {
  const { thread, reply, onChange } = props;
  const posting = useReplyPosting(props);
  useWidgetKeys("replyBox");

  const postOnModEnter = (event: React.KeyboardEvent) => {
    const isPostKey = comboOf(event) === "Mod+Enter";
    if (isPostKey && posting.canPost) {
      event.preventDefault();
      void posting.post();
    }
  };

  if (reply.postedUrl) {
    return <div ref={posting.postedBannerRef} tabIndex={-1} className="banner info">Reply posted and confirmed. <a href={reply.postedUrl} target="_blank" rel="noreferrer">Open</a></div>;
  }
  return (
    <div className="draft">
      <h3>Draft reply</h3>
      <textarea
        aria-label={replyLabelOf(thread)}
        value={reply.draft}
        onChange={(event) => onChange({ ...reply, draft: event.target.value })}
        onKeyDown={postOnModEnter}
      />
      <div className="button-row">
        <button ref={posting.postButtonRef} className="primary" disabled={!posting.canPost} onClick={() => void posting.post()}>{posting.isPosting ? "Posting..." : "Post reply"}</button>
      </div>
      {posting.error ? <div className="banner error" style={{ marginTop: 8 }}>Not posted: {posting.error}. Your draft is saved.</div> : null}
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

type AskAboutThreadProps = { route: PrRoute; file: string; line: number; side: Thread["side"]; pastAsks: PrPageData["asks"] };

function AskAboutThread({ route, file, line, side, pastAsks }: AskAboutThreadProps) {
  useWidgetKeys("askBox");
  const [isAskOpen, setIsAskOpen] = useState(false);
  const askButtonRef = useRef<HTMLButtonElement>(null);
  const closeAsk = () => {
    setIsAskOpen(false);
    focusQuietly(askButtonRef.current);
  };
  return (
    <>
      <div className="button-row">
        <button ref={askButtonRef} aria-expanded={isAskOpen} onClick={() => setIsAskOpen(!isAskOpen)}>{isAskOpen ? "Hide questions" : "Ask about this"}</button>
      </div>
      {isAskOpen ? <AskBox route={route} file={file} span={{ line, side }} pastAsks={pastAsks} onClose={closeAsk} /> : null}
    </>
  );
}

function ThreadCard({ route, page, thread, verdict, reply, onReplyChange }: ThreadCardProps) {
  const location = `${thread.path}:${thread.line ?? "outdated"}`;
  const draftReply = reply.draft || verdict?.draftReply || "";
  const pastAsks = page.asks.filter((ask) => ask.file === thread.path && ask.line === thread.line);
  return (
    <div className={`card thread-card ${verdict ? `verdict-${verdict.verdict}` : ""}`}>
      <div className="thread-top">
        {verdict ? <span className={`chip ${verdict.verdict}`}>{VERDICT_LABEL[verdict.verdict]}</span> : <span className="chip">New since prepared</span>}
        <span className="mono small" title={location}>{location.split("/").at(-1)}</span>
        <span className="small muted">from {thread.comments[0]?.author}</span>
        {verdict ? <ProofBadge proof={verdict.proof} /> : null}
      </div>
      {verdict ? null : <ReviewerComments thread={thread} />}
      {verdict ? (
        <>
          <div className="thread-meaning"><Markdown text={verdict.meaning} /></div>
          <div className="thread-why"><span className="small muted">{verdict.verdict === "valid" ? "Why it's valid:" : "Why:"}</span> <Markdown text={verdict.why} /></div>
          <details className="more">
            <summary>Example</summary>
            <Markdown text={verdict.example} />
          </details>
          <ReviewerComments thread={thread} />
          {verdict.proposedFix ? <ProposedFix patch={verdict.proposedFix} /> : null}
          {verdict.verdict !== "valid" ? <ReplyEditor route={route} thread={thread} reply={{ ...reply, draft: draftReply }} onChange={onReplyChange} /> : null}
        </>
      ) : null}
      {thread.line ? <AskAboutThread route={route} file={thread.path} line={thread.line} side={thread.side} pastAsks={pastAsks} /> : null}
    </div>
  );
}

const VERDICT_ORDER = { valid: 0, unsure: 1, noise: 2 } as const;

function verdictRank(verdict: ThreadVerdict | undefined): number {
  return verdict ? VERDICT_ORDER[verdict.verdict] : -1;
}

function VerdictSummary({ verdicts }: { verdicts: (ThreadVerdict | undefined)[] }) {
  const countOf = (kind: ThreadVerdict["verdict"]) => verdicts.filter((verdict) => verdict?.verdict === kind).length;
  return (
    <div className="verdict-summary">
      <span className="chip valid">{countOf("valid")} valid</span>
      <span className="chip unsure">{countOf("unsure")} unsure</span>
      <span className="chip noise">{countOf("noise")} noise</span>
    </div>
  );
}

export function MyPrReview({ route, page }: { route: PrRoute; page: PrPageData }) {
  const data = page.triage!.data as TriageData;
  const [state, setState] = useSavedState<MyPrState>(route, page.reviewState, { replies: {} });
  const verdictByThread = new Map(data.triage.threads.map((verdict) => [verdict.threadId, verdict]));
  const saveReply = (threadId: string, reply: ReplyState) =>
    setState((current) => ({ ...current, replies: { ...current.replies, [threadId]: reply } }));
  const threads = [...page.pr.openThreads].sort((left, right) => verdictRank(verdictByThread.get(left.id)) - verdictRank(verdictByThread.get(right.id)));
  const isNoise = (thread: Thread) => verdictByThread.get(thread.id)?.verdict === "noise";
  const renderCard = (thread: Thread) => (
    <ThreadCard key={thread.id} route={route} page={page} thread={thread} verdict={verdictByThread.get(thread.id)}
      reply={state.replies[thread.id] ?? EMPTY_REPLY} onReplyChange={(reply) => saveReply(thread.id, reply)} />
  );
  const noiseThreads = threads.filter(isNoise);

  return (
    <section id="comments">
      <h2><Icon name="message" /> Comments waiting on you ({threads.length})</h2>
      <VerdictSummary verdicts={threads.map((thread) => verdictByThread.get(thread.id))} />
      {threads.length === 0 ? <div className="empty">No open comments.</div> : null}
      {threads.filter((thread) => !isNoise(thread)).map(renderCard)}
      {noiseThreads.length > 0 ? (
        <details className="noise-group">
          <summary>Probably noise ({noiseThreads.length}). Each has a draft reply.</summary>
          {noiseThreads.map(renderCard)}
        </details>
      ) : null}
    </section>
  );
}
