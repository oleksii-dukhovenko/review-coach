import type { DiffFile, WalkthroughData } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { CodeFigure } from "./CodeFigure.tsx";
import type { EssayFile, EssayStep } from "./model.ts";
import { fileAnchorId, type EssayView, type ReviewSession } from "./session.ts";
import { Rail } from "./StepPage.tsx";

type FilesPageProps = { session: ReviewSession; data: WalkthroughData; steps: EssayStep[]; goTo: (view: EssayView) => void };

type ListedFile = { file: EssayFile; diff: DiffFile; stepIndex: number };

function listedFiles(steps: EssayStep[]): ListedFile[] {
  const listed = steps.flatMap((step) => step.files.filter((file) => file.diff).map((file) => ({ file, diff: file.diff!, stepIndex: step.index })));
  return listed.sort((left, right) => left.file.path.localeCompare(right.file.path));
}

function countLines(diff: DiffFile) {
  const lines = diff.hunks.flatMap((hunk) => hunk.lines);
  return { adds: lines.filter((line) => line.kind === "add").length, dels: lines.filter((line) => line.kind === "del").length };
}

function scrollToFile(path: string) {
  document.getElementById(fileAnchorId(path))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function folderOf(path: string): string {
  return path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
}

function FileIndexRow({ listed, session, goTo }: { listed: ListedFile; session: ReviewSession; goTo: (view: EssayView) => void }) {
  const { file, diff } = listed;
  const counts = countLines(diff);
  return (
    <li className="file-index-row">
      <input type="checkbox" aria-label="Reviewed" checked={session.statusOf(diff) === "reviewed"} onChange={() => session.toggleReviewed(diff)} />
      <button className="file-index-path" onClick={() => scrollToFile(file.path)} title={file.path}>
        <span className="muted">{folderOf(file.path)}</span>{file.path.split("/").at(-1)}
      </button>
      {diff.status === "modified" ? <span /> : <span className="tag tag-neutral">{diff.status}</span>}
      <span className="mono"><span className="accent-text">+{counts.adds}</span> <span className="magenta-text">−{counts.dels}</span></span>
      <button className="step-ref" onClick={() => goTo({ kind: "step", index: listed.stepIndex })}>step {listed.stepIndex + 1}</button>
    </li>
  );
}

function FileChanges({ listed, session }: { listed: ListedFile; session: ReviewSession }) {
  const { file, diff } = listed;
  return (
    <section className="essay-file all-files-file" id={fileAnchorId(file.path)}>
      <label className="file-check">
        <input type="checkbox" checked={session.statusOf(diff) === "reviewed"} onChange={() => session.toggleReviewed(diff)} />
        <span className="mono">{file.path}</span>
      </label>
      {diff.isBinary ? <p className="small muted">Binary file, no text diff.</p> : null}
      {file.figures.map((figure) => (
        <CodeFigure key={figure.id} figure={figure} diff={diff} session={session} footnoteAt={() => undefined} hoveredNote={null} onHoverNote={() => undefined} />
      ))}
    </section>
  );
}

/** Every file the PR touches: an index to jump from, then each file's changes. */
export function FilesPage({ session, data, steps, goTo }: FilesPageProps) {
  const files = listedFiles(steps);
  const totals = files.map((listed) => countLines(listed.diff)).reduce((sum, counts) => ({ adds: sum.adds + counts.adds, dels: sum.dels + counts.dels }), { adds: 0, dels: 0 });
  return (
    <div className="essay-step">
      <Rail session={session} steps={steps} place={{ isFiles: true }} goTo={goTo} />
      <article className="essay-article">
        <div className="small-caps"><Icon name="files" /> All files &amp; changes</div>
        <h1 className="essay-title">{data.files.length} files</h1>
        <p className="essay-p">
          <span className="accent-text">+{totals.adds}</span> <span className="magenta-text">−{totals.dels}</span> lines.
          Old code on the left, new on the right. Click a file to jump to it.
        </p>
        <ol className="file-index">{files.map((listed) => <FileIndexRow key={listed.file.path} listed={listed} session={session} goTo={goTo} />)}</ol>
        {files.map((listed) => <FileChanges key={listed.file.path} listed={listed} session={session} />)}
      </article>
    </div>
  );
}
