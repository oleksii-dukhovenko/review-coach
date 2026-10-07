import { useState } from "react";

import type { DiffFile, Guide, JobRecord } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { Icon } from "../components/Icon.tsx";
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

const CHANGED_LINES_PER_MINUTE = 25;

type Chapter = Guide["chapters"][number];

type ChapterFile = Chapter["files"][number];

// - minutes is 0 when every file is a skim file (generated, lockfile, rename).
type ChapterStats = { added: number; removed: number; minutes: number; reviewed: number; total: number };

function changedLineCounts(file: DiffFile | undefined): { added: number; removed: number } {
  const lines = file?.hunks.flatMap((hunk) => hunk.lines) ?? [];
  return { added: lines.filter((line) => line.kind === "add").length, removed: lines.filter((line) => line.kind === "del").length };
}

/** Skim files are left out: nobody reads a lockfile line by line. */
function readingMinutes(files: (DiffFile | undefined)[]): number {
  const counts = files.map(changedLineCounts);
  const changedLines = counts.reduce((sum, count) => sum + count.added + count.removed, 0);
  return changedLines === 0 ? 0 : Math.max(1, Math.round(changedLines / CHANGED_LINES_PER_MINUTE));
}

function statsOf(chapter: Chapter, fileByPath: Map<string, DiffFile>, statusOf: GuideSectionProps["statusOf"]): ChapterStats {
  const files = chapter.files.map((entry) => fileByPath.get(entry.file));
  const counts = files.map(changedLineCounts);
  const added = counts.reduce((sum, count) => sum + count.added, 0);
  const removed = counts.reduce((sum, count) => sum + count.removed, 0);
  const reviewed = files.filter((file) => file && statusOf(file) === "reviewed").length;
  const minutes = readingMinutes(files.filter((file) => file?.tag !== "skim"));
  return { added, removed, minutes, reviewed, total: chapter.files.length };
}

function isChapterDone(stats: ChapterStats): boolean {
  return stats.total > 0 && stats.reviewed === stats.total;
}

/** Guides written before oneLiner existed show their summary's first sentence. */
function oneLinerOf(chapter: Chapter): string {
  return chapter.oneLiner || chapter.summary.split(/(?<=\.)\s/)[0];
}

export function ReviewProgress({ files, statusOf }: Pick<GuideSectionProps, "files" | "statusOf">) {
  const reviewedCount = files.filter((file) => statusOf(file) === "reviewed").length;
  const percent = files.length === 0 ? 0 : Math.round((reviewedCount / files.length) * 100);
  return (
    <div className="guide-progress">
      <div className="progress"><div style={{ width: `${percent}%` }} /></div>
      <span className="small muted">{reviewedCount}/{files.length} files</span>
    </div>
  );
}

function FileChip({ entry, file, props }: { entry: ChapterFile; file: DiffFile | undefined; props: GuideSectionProps }) {
  const status = file ? props.statusOf(file) : "unreviewed";
  return (
    <span className={`file-chip status-${status}`} title={`${entry.file}\n${entry.whatChanged}`}>
      <input type="checkbox" disabled={!file} checked={status === "reviewed"} onChange={() => file && props.toggleReviewed(file)} aria-label={`Reviewed ${entry.file}`} />
      <button onClick={() => props.onOpenFile(entry.file)}>{entry.file.split("/").at(-1)}</button>
      {status === "changed" ? <span className="file-chip-flag" title="Changed since you reviewed">changed</span> : null}
    </span>
  );
}

function ChapterMore({ chapter }: { chapter: Chapter }) {
  return (
    <div className="step-more">
      <Markdown text={chapter.summary} />
      <ul className="step-file-notes">
        {chapter.files.map((entry) => <li key={entry.file}><span className="mono">{entry.file.split("/").at(-1)}</span>: {entry.whatChanged}</li>)}
      </ul>
    </div>
  );
}

type StepProps = { chapter: Chapter; stepNumber: number; stats: ChapterStats; isNext: boolean; props: GuideSectionProps; fileByPath: Map<string, DiffFile> };

function StepView({ chapter, stepNumber, stats, isNext, props, fileByPath }: StepProps) {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const isDone = isChapterDone(stats);
  return (
    <li className={`step role-${chapter.role} ${isDone ? "is-done" : ""} ${isNext ? "is-next" : ""}`}>
      <span className="step-number">{isDone ? <Icon name="check" size={14} /> : stepNumber}</span>
      <div className="step-body">
        <div className="step-head">
          <strong>{chapter.title}</strong>
          <span className={`chip ${chapter.role}`}>{ROLE_LABEL[chapter.role]}</span>
          <span className="step-size small muted">
            <span className="added-count">+{stats.added}</span> <span className="deleted-count">-{stats.removed}</span> · {stats.minutes > 0 ? `~${stats.minutes} min` : "skim"}
          </span>
        </div>
        {isDone ? null : (
          <>
            <div className="step-one-liner">{oneLinerOf(chapter)}</div>
            <div className="step-files">
              {chapter.files.map((entry) => <FileChip key={entry.file} entry={entry} file={fileByPath.get(entry.file)} props={props} />)}
              <button className="link-button" onClick={() => setIsMoreOpen(!isMoreOpen)}>{isMoreOpen ? "Less" : "More"}</button>
            </div>
            {isMoreOpen ? <ChapterMore chapter={chapter} /> : null}
          </>
        )}
      </div>
    </li>
  );
}

function firstUnreviewedFile(chapter: Chapter, fileByPath: Map<string, DiffFile>, statusOf: GuideSectionProps["statusOf"]): string | undefined {
  return chapter.files.find((entry) => {
    const file = fileByPath.get(entry.file);
    return file !== undefined && statusOf(file) !== "reviewed";
  })?.file;
}

function NextUp({ chapter, stepNumber, onStart }: { chapter: Chapter | undefined; stepNumber: number; onStart: () => void }) {
  if (!chapter) return <div className="next-up is-done"><Icon name="check" size={16} /> Every step is checked off.</div>;
  return (
    <div className="next-up">
      <span className="small muted">Next up</span>
      <strong>{stepNumber}. {chapter.title}</strong>
      <button className="primary" onClick={onStart}>Start <Icon name="arrowRight" size={14} /></button>
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

function GuideSteps({ guide, props }: { guide: Guide; props: GuideSectionProps }) {
  const fileByPath = new Map(props.files.map((file) => [file.path, file]));
  const stats = guide.chapters.map((chapter) => statsOf(chapter, fileByPath, props.statusOf));
  const nextIndex = stats.findIndex((chapterStats) => !isChapterDone(chapterStats));
  const nextChapter = nextIndex === -1 ? undefined : guide.chapters[nextIndex];
  const startNext = () => {
    const file = nextChapter && firstUnreviewedFile(nextChapter, fileByPath, props.statusOf);
    if (file) props.onOpenFile(file);
  };
  return (
    <>
      <div className="guide-top">
        <div className="small muted">{guide.overview}</div>
        <NextUp chapter={nextChapter} stepNumber={nextIndex + 1} onStart={startNext} />
      </div>
      <ol className="steps">
        {guide.chapters.map((chapter, chapterIndex) => (
          <StepView key={chapterIndex} chapter={chapter} stepNumber={chapterIndex + 1} stats={stats[chapterIndex]}
            isNext={chapterIndex === nextIndex} props={props} fileByPath={fileByPath} />
        ))}
      </ol>
    </>
  );
}

/** Steps in the order the work was reasoned through, built to be skimmed. */
export function GuideSection(props: GuideSectionProps) {
  const guide = props.guideJob?.builtAt ? (props.guideJob.data as Guide | null) : null;
  const isRefreshing = props.guideJob?.status === "queued" || props.guideJob?.status === "building";
  return (
    <section id="guide">
      <div className="section-bar">
        <h2><Icon name="book" /> Guide</h2>
        <ReviewProgress files={props.files} statusOf={props.statusOf} />
      </div>
      <div className="card">
        {isRefreshing && guide ? <div className="small muted">Updating the guide for the new commits...</div> : null}
        {guide ? <GuideSteps guide={guide} props={props} /> : <GuideStatus guideJob={props.guideJob} onPrepare={props.onPrepare} />}
      </div>
    </section>
  );
}
