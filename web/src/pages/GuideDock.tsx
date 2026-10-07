import type { DiffFile, Guide } from "../api.ts";
import { Icon } from "../components/Icon.tsx";
import { jumpToSection } from "../jump.ts";
import type { ReviewedStatus } from "../reviewedFiles.ts";

type Chapter = Guide["chapters"][number];

type GuideDockProps = {
  guide: Guide;
  stepIndex: number;
  files: DiffFile[];
  // - The tour file you are reading now, if any.
  currentFile: string | undefined;
  statusOf: (file: DiffFile) => ReviewedStatus;
  toggleReviewed: (file: DiffFile) => void;
  onOpenFile: (filePath: string) => void;
  onChangeStep: (stepIndex: number | null) => void;
};

function stepFiles(chapter: Chapter, files: DiffFile[]): DiffFile[] {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  return chapter.files.map((entry) => fileByPath.get(entry.file)).filter((file) => file !== undefined);
}

function unreviewedIn(chapter: Chapter, files: DiffFile[], statusOf: GuideDockProps["statusOf"]): DiffFile[] {
  return stepFiles(chapter, files).filter((file) => statusOf(file) !== "reviewed");
}

function nextStepWithWork(guide: Guide, afterIndex: number, files: DiffFile[], statusOf: GuideDockProps["statusOf"]): number {
  return guide.chapters.findIndex((chapter, index) => index > afterIndex && unreviewedIn(chapter, files, statusOf).length > 0);
}

function DockFile({ file, isReviewed, isCurrent, onOpen }: { file: DiffFile; isReviewed: boolean; isCurrent: boolean; onOpen: () => void }) {
  return (
    <button className={`dock-file ${isReviewed ? "is-reviewed" : ""} ${isCurrent ? "is-current" : ""}`} onClick={onOpen} title={file.path}>
      {isReviewed ? <Icon name="check" size={12} /> : <span className="dock-dot" />}
      {file.path.split("/").at(-1)}
    </button>
  );
}

type NextActionProps = GuideDockProps & { chapter: Chapter };

/** "Done, next file" while the step has work; "Next step" once it is done. */
function NextAction(props: NextActionProps) {
  const { chapter, files, statusOf, currentFile } = props;
  const unreviewed = unreviewedIn(chapter, files, statusOf);
  const current = unreviewed.find((file) => file.path === currentFile);
  const nextFile = unreviewed.find((file) => file.path !== currentFile);
  if (current) {
    const finishCurrent = () => {
      props.toggleReviewed(current);
      if (nextFile) props.onOpenFile(nextFile.path);
    };
    return <button className="primary" onClick={finishCurrent}><Icon name="check" size={14} /> Done{nextFile ? ", next file" : " with this step"}</button>;
  }
  if (nextFile) return <button className="primary" onClick={() => props.onOpenFile(nextFile.path)}>Next file <Icon name="arrowRight" size={14} /></button>;
  const nextStep = nextStepWithWork(props.guide, props.stepIndex, files, statusOf);
  if (nextStep === -1) return <span className="dock-done"><Icon name="check" size={14} /> Every step is checked off</span>;
  const startNextStep = () => {
    props.onChangeStep(nextStep);
    const firstFile = unreviewedIn(props.guide.chapters[nextStep], files, statusOf)[0];
    if (firstFile) props.onOpenFile(firstFile.path);
  };
  return <button className="primary" onClick={startNextStep}>Next step: {props.guide.chapters[nextStep].title} <Icon name="arrowRight" size={14} /></button>;
}

/** Stays at the bottom while you work through one guide step. */
export function GuideDock(props: GuideDockProps) {
  const chapter = props.guide.chapters[props.stepIndex];
  if (!chapter) return null;
  const files = stepFiles(chapter, props.files);
  const isStepDone = unreviewedIn(chapter, props.files, props.statusOf).length === 0;
  return (
    <div className="guide-dock" role="region" aria-label="Guide step">
      <div className="dock-step">
        <span className={`dock-number ${isStepDone ? "is-done" : ""}`}>{isStepDone ? <Icon name="check" size={13} /> : props.stepIndex + 1}</span>
        <div className="dock-title">
          <span className="small muted">Step {props.stepIndex + 1} of {props.guide.chapters.length}</span>
          <strong>{chapter.title}</strong>
        </div>
      </div>
      <div className="dock-files">
        {files.map((file) => (
          <DockFile key={file.path} file={file} isReviewed={props.statusOf(file) === "reviewed"}
            isCurrent={file.path === props.currentFile} onOpen={() => props.onOpenFile(file.path)} />
        ))}
      </div>
      <div className="dock-actions">
        <NextAction {...props} chapter={chapter} />
        <button className="ghost" onClick={() => jumpToSection("guide")} title="Back to the guide"><Icon name="arrowUp" size={14} /> Guide</button>
        <button className="ghost" onClick={() => props.onChangeStep(null)} title="Hide this bar" aria-label="Hide"><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}
