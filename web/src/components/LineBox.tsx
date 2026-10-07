import { useState } from "react";

import type { AskRecord, PrRoute } from "../api.ts";
import type { LineComment } from "../savedState.ts";
import { AskBox } from "./AskBox.tsx";
import { spanLabel, type LineSpan } from "../../../server/anchors.ts";

type Tab = "ask" | "comment";

type LineBoxProps = {
  route: PrRoute;
  file: string;
  span: LineSpan;
  pastAsks: AskRecord[];
  onAddComment: (body: string) => void;
  onClose: () => void;
};

function CommentEditor({ label, onAdd, onClose }: { label: string; onAdd: (body: string) => void; onClose: () => void }) {
  const [body, setBody] = useState("");
  const addAndClose = () => {
    onAdd(body.trim());
    onClose();
  };
  return (
    <div className="ask">
      <div className="small muted">Comment on <span className="mono">{label}</span>. Goes to the Finish panel; posted with your review, not before.</div>
      <textarea autoFocus placeholder="Your comment for the PR author" value={body} onChange={(event) => setBody(event.target.value)} />
      <div className="button-row">
        <button className="primary" disabled={!body.trim()} onClick={addAndClose}>Add to my review</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function TabButton({ tab, current, label, onSelect }: { tab: Tab; current: Tab; label: string; onSelect: (tab: Tab) => void }) {
  return <button className={tab === current ? "primary" : ""} onClick={() => onSelect(tab)}>{label}</button>;
}

/** Opens under a clicked line: ask Claude, or comment on the PR. */
export function LineBox({ route, file, span, pastAsks, onAddComment, onClose }: LineBoxProps) {
  const [tab, setTab] = useState<Tab>("ask");
  return (
    <div>
      <div className="button-row" style={{ marginTop: 0, marginBottom: 4 }}>
        <TabButton tab="ask" current={tab} label="Ask Claude" onSelect={setTab} />
        <TabButton tab="comment" current={tab} label="Comment on the PR" onSelect={setTab} />
      </div>
      {tab === "ask" ? (
        <AskBox route={route} file={file} span={span} pastAsks={pastAsks} onClose={onClose} />
      ) : (
        <CommentEditor label={`${file.split("/").at(-1)}:${spanLabel(span)}`} onAdd={onAddComment} onClose={onClose} />
      )}
    </div>
  );
}

type LineCommentViewProps = {
  comment: LineComment;
  onChange: (body: string) => void;
  onRemove: () => void;
};

export function LineCommentView({ comment, onChange, onRemove }: LineCommentViewProps) {
  return (
    <div className="question decided-problem">
      <div className="small">
        <strong>Your comment</strong>{comment.startLine !== undefined ? <span className="mono"> on lines {comment.startLine}-{comment.line}</span> : null}
        <span className="muted"> (posts with your review)</span>
      </div>
      <textarea value={comment.body} onChange={(event) => onChange(event.target.value)} />
      <div className="button-row"><button onClick={onRemove}>Remove</button></div>
    </div>
  );
}
