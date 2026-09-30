import type { DiffFile, Guide, JobRecord } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import type { ReviewedStatus } from "../reviewedFiles.ts";

type GuideSectionProps = {
  guideJob: JobRecord | null;
  files: DiffFile[];
  statusOf: (file: DiffFile) => ReviewedStatus;
  toggleReviewed: (file: DiffFile) => void;
  onOpenFile: (filePath: string) => void;
  onPrepare: () => void;
};

const ROLE_LABEL = { core: "Core", "follow-on": "Follow-on", supporting: "Supporting" } as const;

type Chapter = Guide["chapters"][number];

export function ReviewProgress({ files, statusOf }: Pick<GuideSectionProps, "files" | "statusOf">) {
  const reviewedCount = files.filter((file) => statusOf(file) === "reviewed").length;
  const percent = files.length === 0 ? 0 : Math.round((reviewedCount / files.length) * 100);
  return (
    <div>
      <div className="small muted">{reviewedCount} of {files.length} files reviewed</div>
      <div className="progress"><div style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function GuideFileRow({ entry, file, props }: { entry: Chapter["files"][number]; file: DiffFile | undefined; props: GuideSectionProps }) {
  const status = file ? props.statusOf(file) : "unreviewed";
  return (
    <div className={`guide-file ${status === "reviewed" ? "is-reviewed" : ""}`}>
      <input type="checkbox" disabled={!file} checked={status === "reviewed"} onChange={() => file && props.toggleReviewed(file)} title="Mark reviewed" />
      <div>
        <button onClick={() => props.onOpenFile(entry.file)}>{entry.file}</button>
        {status === "changed" ? <span className="chip unsure" style={{ marginLeft: 6 }}>Changed since you reviewed</span> : null}
        <div className="small">{entry.whatChanged}</div>
      </div>
    </div>
  );
}

function ChapterView({ chapter, chapterNumber, isLast, props }: { chapter: Chapter; chapterNumber: number; isLast: boolean; props: GuideSectionProps }) {
  const fileByPath = new Map(props.files.map((file) => [file.path, file]));
  return (
    <div className={`guide-chapter role-${chapter.role}`}>
      <div className="guide-number">{chapterNumber}</div>
      <div className="button-row" style={{ marginTop: 2, alignItems: "center" }}>
        <strong>{chapter.title}</strong>
        <span className={`chip ${chapter.role}`}>{ROLE_LABEL[chapter.role]}</span>
      </div>
      {isLast ? <div /> : <div className="guide-rail" />}
      <div className="guide-body">
        <Markdown text={chapter.summary} />
        <div className="guide-files">
          {chapter.files.map((entry) => <GuideFileRow key={entry.file} entry={entry} file={fileByPath.get(entry.file)} props={props} />)}
        </div>
      </div>
    </div>
  );
}

function GuideStatus({ guideJob, onPrepare }: Pick<GuideSectionProps, "guideJob" | "onPrepare">) {
  const status = guideJob?.status ?? "none";
  if (status === "queued" || status === "building") return <div className="small muted">Writing the guide. It appears here when ready.</div>;
  const label = status === "failed" ? `The guide failed: ${guideJob?.error}` : "No guide yet.";
  return (
    <div className="button-row" style={{ alignItems: "center" }}>
      <span className="small muted">{label}</span>
      <button onClick={onPrepare}>{status === "failed" ? "Retry" : "Write the guide"}</button>
    </div>
  );
}

/** Chapters in the order the work was reasoned through. */
export function GuideSection(props: GuideSectionProps) {
  const guide = props.guideJob?.status === "ready" ? (props.guideJob.data as Guide) : null;
  return (
    <section>
      <h2>Guide</h2>
      <div className="card">
        <ReviewProgress files={props.files} statusOf={props.statusOf} />
        {guide ? (
          <>
            <div style={{ margin: "10px 0 14px" }}><Markdown text={guide.overview} /></div>
            {guide.chapters.map((chapter, chapterIndex) => (
              <ChapterView key={chapterIndex} chapter={chapter} chapterNumber={chapterIndex + 1} isLast={chapterIndex === guide.chapters.length - 1} props={props} />
            ))}
          </>
        ) : (
          <GuideStatus guideJob={props.guideJob} onPrepare={props.onPrepare} />
        )}
      </div>
    </section>
  );
}
