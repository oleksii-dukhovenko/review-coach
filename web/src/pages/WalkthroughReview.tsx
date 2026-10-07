import { useState, type ReactNode } from "react";

import { api, type AskRecord, type Concept, type DiffFile, type Guide, type HardIdea, type PrPageData, type PrRoute, type Reference, type ReferenceQuery, type WalkthroughData } from "../api.ts";
import { CoachingQuestion, TeachingNote, type CoachingQuestionData, type TeachingNoteData } from "../components/Coaching.tsx";
import type { ExplainChatState } from "../components/ExplainChat.tsx";
import { DiffView, isInDiff, type LineRef } from "../components/DiffView.tsx";
import { setDiffLayout, useDiffLayout } from "../components/diffLayout.ts";
import { FileViewer, useFileViewer } from "../components/FileViewer.tsx";
import { Icon } from "../components/Icon.tsx";
import { LineBox, LineCommentView } from "../components/LineBox.tsx";
import { PeekReferences } from "../components/PeekReferences.tsx";
import { Markdown } from "../components/basics.tsx";
import { lineTextFor, placeLineComments, type PlacedComment } from "../placeComments.ts";
import { spanStart, type LineSpan } from "../../../server/anchors.ts";
import { useSavedState, type LineComment, type QuestionAnswer, type ReviewState } from "../savedState.ts";
import { FinishPanel } from "./FinishPanel.tsx";
import { useActiveAnchor } from "../activeAnchor.ts";
import { jumpToFile, jumpToLine, jumpToSection, tourStopId } from "../jump.ts";
import { diffFingerprint, reviewedStatusOf, type ReviewedStatus } from "../reviewedFiles.ts";
import { GuideDock } from "./GuideDock.tsx";
import { GuideSection } from "./GuideSection.tsx";
import { AtAGlance, ChangesBanner, FlowSection, HardIdeasSection, PictureSection, RemovedCodeSection, skimFiles } from "./WalkthroughSections.tsx";

type TourStop = WalkthroughData["walkthrough"]["tour"][number];

type OpenAsk = { file: string } & LineSpan;

type OpenPeek = ReferenceQuery;

const DEFAULT_REVIEW_STATE: ReviewState = {
  answers: {}, explainChats: {}, lineComments: [], reviewedFiles: {}, summary: "", verdict: null, postedUrl: null,
};

function isAtLine(item: { line: number; side: string }, lineRef: LineRef): boolean {
  return item.line === lineRef.line && item.side === lineRef.side;
}

/** Notes and questions sit under the last line they cover. */
function isAfterBlock(item: { line: number; endLine?: number; side: string }, lineRef: LineRef): boolean {
  const lastLine = Math.max(item.endLine ?? item.line, item.line);
  return lastLine === lineRef.line && item.side === lineRef.side;
}

function blockEnd(item: { line: number; endLine?: number; side: "LEFT" | "RIGHT" }): LineRef {
  return { line: Math.max(item.endLine ?? item.line, item.line), side: item.side };
}

type Coaching = {
  route: PrRoute;
  asks: AskRecord[];
  conceptsByKey: Map<string, Concept>;
  answers: Record<string, QuestionAnswer>;
  openAsk: OpenAsk | null;
  setOpenAsk: (ask: OpenAsk | null) => void;
  openPeek: OpenPeek | null;
  setOpenPeek: (peek: OpenPeek | null) => void;
  saveAnswer: (questionId: string, answer: QuestionAnswer) => void;
  saveConcept: (source: ConceptSource, status: Concept["status"]) => void;
  explainChats: ReviewState["explainChats"];
  saveExplainChat: (chatKey: string, chat: ExplainChatState) => void;
  lineComments: PlacedComment[];
  addLineComment: (file: string, span: LineSpan, body: string) => void;
  updateLineComment: (commentId: string, body: string) => void;
  removeLineComment: (commentId: string) => void;
  statusOf: (file: DiffFile) => ReviewedStatus;
  toggleReviewed: (file: DiffFile) => void;
  jumpToReference: (reference: Reference) => void;
  isRevealed: (filePath: string) => boolean;
  setRevealed: (filePath: string, isRevealed: boolean) => void;
};

function openSpanIn(coaching: Coaching, file: string): LineSpan | undefined {
  return coaching.openAsk?.file === file ? coaching.openAsk : undefined;
}

function noteChatKey(file: string, note: TeachingNoteData): string {
  return `note:${file}:${note.conceptKey}:${note.line}`;
}

/** A teaching note whose "Still fuzzy" chat is saved with the review. */
function NoteWithChat({ note, file, coaching }: { note: TeachingNoteData; file: string; coaching: Coaching }) {
  const chatKey = noteChatKey(file, note);
  const lastLine = Math.max(note.endLine ?? note.line, note.line);
  const span = lastLine > note.line ? { line: lastLine, side: note.side, startLine: note.line, startSide: note.side } : { line: note.line, side: note.side };
  return (
    <TeachingNote note={note} concept={coaching.conceptsByKey.get(note.conceptKey)} onSave={(status) => coaching.saveConcept(note, status)}
      subject={{ route: coaching.route, file, span }} chat={coaching.explainChats[chatKey]} onChatChange={(chat) => coaching.saveExplainChat(chatKey, chat)} />
  );
}

function commentsAt(coaching: Coaching, file: string, lineRef: LineRef): PlacedComment[] {
  return coaching.lineComments.filter((comment) => !comment.isOutdated && comment.file === file && isAtLine(comment, lineRef));
}

function LineAnnotations({ file, notes, questions, lineRef, coaching }: {
  file: string; notes: TeachingNoteData[]; questions: CoachingQuestionData[]; lineRef: LineRef; coaching: Coaching;
}) {
  const isAskOpen = coaching.openAsk?.file === file && isAtLine(coaching.openAsk, lineRef);
  const openStart = coaching.openAsk?.startLine ?? null;
  const pastAsks = coaching.asks.filter((ask) => ask.file === file && ask.line === lineRef.line && (ask.startLine ?? null) === openStart);
  const comments = commentsAt(coaching, file, lineRef);
  const peek = coaching.openPeek?.file === file && isAtLine(coaching.openPeek, lineRef) ? coaching.openPeek : null;
  return (
    <>
      {peek ? (
        <PeekReferences key={`${peek.word}:${peek.column}`} route={coaching.route} query={peek}
          onClose={() => coaching.setOpenPeek(null)} onJump={coaching.jumpToReference} />
      ) : null}
      {notes.map((note, noteIndex) => <NoteWithChat key={noteIndex} note={note} file={file} coaching={coaching} />)}
      {questions.map((question) => (
        <CoachingQuestion key={question.id} route={coaching.route} file={file} question={question}
          answer={coaching.answers[question.id]} onChange={(answer) => coaching.saveAnswer(question.id, answer)} />
      ))}
      {comments.map((comment) => (
        <LineCommentView key={comment.id} comment={comment}
          onChange={(body) => coaching.updateLineComment(comment.id, body)} onRemove={() => coaching.removeLineComment(comment.id)} />
      ))}
      {isAskOpen ? (
        <LineBox route={coaching.route} file={file} span={coaching.openAsk!} pastAsks={pastAsks}
          onAddComment={(body) => coaching.addLineComment(file, coaching.openAsk!, body)} onClose={() => coaching.setOpenAsk(null)} />
      ) : null}
    </>
  );
}

function annotationsAt(stop: TourStop, coaching: Coaching, lineRef: LineRef): ReactNode {
  const notes = stop.notes.filter((note) => isAfterBlock(note, lineRef));
  const questions = stop.questions.filter((question) => isAfterBlock(question, lineRef));
  const isAskOpen = coaching.openAsk?.file === stop.file && isAtLine(coaching.openAsk, lineRef);
  const hasComments = commentsAt(coaching, stop.file, lineRef).length > 0;
  const isPeekOpen = coaching.openPeek?.file === stop.file && isAtLine(coaching.openPeek, lineRef);
  const hasAnything = notes.length > 0 || questions.length > 0 || isAskOpen || hasComments || isPeekOpen;
  if (!hasAnything) return null;
  return <LineAnnotations file={stop.file} notes={notes} questions={questions} lineRef={lineRef} coaching={coaching} />;
}

function OutsideDiffItems({ stop, file, coaching }: { stop: TourStop; file: DiffFile | undefined; coaching: Coaching }) {
  const isOutside = (item: TeachingNoteData | CoachingQuestionData) => !file || !isInDiff(file, blockEnd(item));
  const notes = stop.notes.filter(isOutside);
  const questions = stop.questions.filter(isOutside);
  if (notes.length === 0 && questions.length === 0) return null;
  return (
    <div className="tour-outside">
      <div className="small muted">About lines outside the diff:</div>
      {notes.map((note, noteIndex) => <NoteWithChat key={noteIndex} note={note} file={stop.file} coaching={coaching} />)}
      {questions.map((question) => (
        <CoachingQuestion key={question.id} route={coaching.route} file={stop.file} question={question}
          answer={coaching.answers[question.id]} onChange={(answer) => coaching.saveAnswer(question.id, answer)} />
      ))}
    </div>
  );
}

function ReviewedToggle({ file, coaching }: { file: DiffFile; coaching: Coaching }) {
  const status = coaching.statusOf(file);
  return (
    <label className="reviewed-toggle" onClick={(event) => event.stopPropagation()}>
      {status === "changed" ? <span className="chip unsure">Changed since you reviewed</span> : null}
      <input type="checkbox" checked={status === "reviewed"} onChange={() => coaching.toggleReviewed(file)} />
      Reviewed
    </label>
  );
}

function StopTitle({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  return (
    <span className="stop-title" title={path}>
      <strong className="mono">{path.slice(slash + 1)}</strong>
      <span className="stop-folder mono">{path.slice(0, Math.max(slash, 0))}</span>
    </span>
  );
}

function StopCounts({ stop }: { stop: TourStop }) {
  const questionCount = stop.questions.length;
  const noteCount = stop.notes.length;
  return (
    <span className="stop-counts small muted">
      {questionCount > 0 ? <span title="Questions"><Icon name="question" size={13} /> {questionCount}</span> : null}
      {noteCount > 0 ? <span title="Things to learn"><Icon name="bulb" size={13} /> {noteCount}</span> : null}
    </span>
  );
}

type TourStopProps = { stop: TourStop; stopNumber: number; file: DiffFile | undefined; coaching: Coaching; isUpdated: boolean };

function TourStopView({ stop, stopNumber, file, coaching, isUpdated }: TourStopProps) {
  const isReviewed = file !== undefined && coaching.statusOf(file) === "reviewed";
  const isRevealed = coaching.isRevealed(stop.file);
  const isCollapsed = isReviewed && !isRevealed;
  return (
    <div className={`tour-stop ${isReviewed ? "is-reviewed" : ""}`} id={tourStopId(stop.file)}>
      <div className="tour-header">
        <span className="stop-number">{stopNumber}</span>
        <StopTitle path={stop.file} />
        <StopCounts stop={stop} />
        {isUpdated ? <span className="chip updated" title="Redone for the new commits">Updated</span> : null}
        {file?.tag === "important" ? <span className="chip important" title={file.tagReason}>Important</span> : null}
        {file ? <ReviewedToggle file={file} coaching={coaching} /> : null}
        {isReviewed && isRevealed ? <button onClick={() => coaching.setRevealed(stop.file, false)}>Hide</button> : null}
      </div>
      {isCollapsed ? (
        <div className="tour-collapsed">
          <span className="small muted">Reviewed. Hidden to save space.</span>
          <button onClick={() => coaching.setRevealed(stop.file, true)}>Show again</button>
        </div>
      ) : (
        <TourStopBody stop={stop} file={file} coaching={coaching} />
      )}
    </div>
  );
}

function TourStopBody({ stop, file, coaching }: { stop: TourStop; file: DiffFile | undefined; coaching: Coaching }) {
  return (
    <>
      {stop.whyItMatters ? <div className="tour-why"><Icon name="target" size={14} /><Markdown text={stop.whyItMatters} /></div> : null}
      <OutsideDiffItems stop={stop} file={file} coaching={coaching} />
      {file ? (
        <DiffView file={file} annotationsFor={(lineRef) => annotationsAt(stop, coaching, lineRef)}
          onLineClick={(span) => coaching.setOpenAsk({ file: stop.file, ...span })} selected={openSpanIn(coaching, stop.file)}
          onWordClick={(lineRef, clicked) => coaching.setOpenPeek({ file: stop.file, ...clicked, ...lineRef })} />
      ) : (
        <div className="card muted small">This file is not in the diff.</div>
      )}
    </>
  );
}

function SkimSection({ files, coaching }: { files: DiffFile[]; coaching: Coaching }) {
  if (files.length === 0) return null;
  const emptyStop = (file: DiffFile): TourStop => ({ file: file.path, whyItMatters: "", notes: [], questions: [] });
  return (
    <section id="skim">
      <h2><Icon name="eye" /> Skim <span className="muted">({files.length})</span></h2>
      <p className="small muted">Tests, generated code, lockfiles, and renames. Open one only if you want to.</p>
      {files.map((file) => (
        <details key={file.path} className="card" id={tourStopId(file.path)}>
          <summary style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono">{file.path}</span> <span className="chip">{file.tagReason}</span>
            <ReviewedToggle file={file} coaching={coaching} />
          </summary>
          <DiffView file={file} annotationsFor={(lineRef) => annotationsAt(emptyStop(file), coaching, lineRef)}
            onLineClick={(span) => coaching.setOpenAsk({ file: file.path, ...span })} selected={openSpanIn(coaching, file.path)}
            onWordClick={(lineRef, clicked) => coaching.setOpenPeek({ file: file.path, ...clicked, ...lineRef })} />
        </details>
      ))}
    </section>
  );
}

/** Files the tour skipped that are not skim files still get shown. */
function filesMissingFromTour(files: DiffFile[], tour: TourStop[]): DiffFile[] {
  const touredPaths = new Set(tour.map((stop) => stop.file));
  return files.filter((file) => file.tag !== "skim" && !touredPaths.has(file.path));
}

type ReviewStateSetter = (update: (current: ReviewState) => ReviewState) => void;

/** Where a multi-line comment starts, with that line's code so it can follow it. */
function rangeStartOf(files: DiffFile[], file: string, span: LineSpan): Partial<LineComment> {
  if (span.startLine === undefined) return {};
  const start = spanStart(span);
  return { startLine: start.line, startSide: start.side, startLineText: lineTextFor(files, file, start.side, start.line) };
}

function lineCommentActions(setState: ReviewStateSetter, files: DiffFile[]) {
  const setComments = (update: (comments: LineComment[]) => LineComment[]) =>
    setState((current) => ({ ...current, lineComments: update(current.lineComments) }));
  const newComment = (file: string, span: LineSpan, body: string): LineComment => ({
    id: crypto.randomUUID(), file, line: span.line, side: span.side, body,
    lineText: lineTextFor(files, file, span.side, span.line),
    ...rangeStartOf(files, file, span),
  });
  return {
    addLineComment: (file: string, span: LineSpan, body: string) =>
      setComments((comments) => [...comments, newComment(file, span, body)]),
    updateLineComment: (commentId: string, body: string) =>
      setComments((comments) => comments.map((comment) => (comment.id === commentId ? { ...comment, body } : comment))),
    removeLineComment: (commentId: string) =>
      setComments((comments) => comments.filter((comment) => comment.id !== commentId)),
  };
}

function reviewedFileActions(state: ReviewState, setState: ReviewStateSetter) {
  const statusOf = (file: DiffFile) => reviewedStatusOf(file, state.reviewedFiles);
  const toggleReviewed = (file: DiffFile) =>
    setState((current) => {
      const { [file.path]: _previous, ...others } = current.reviewedFiles;
      const isNowReviewed = reviewedStatusOf(file, current.reviewedFiles) !== "reviewed";
      return { ...current, reviewedFiles: isNowReviewed ? { ...others, [file.path]: diffFingerprint(file) } : others };
    });
  return { statusOf, toggleReviewed };
}

/** Runs after React has drawn the latest state. */
function afterRender(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

type FileViewerControls = ReturnType<typeof useFileViewer>;

/** Jumps open reviewed files first, since their code is hidden. */
function useFileNavigation(viewer: FileViewerControls, closePeek: () => void) {
  const [revealedFiles, setRevealedFiles] = useState<Set<string>>(new Set());
  const setRevealed = (filePath: string, isRevealed: boolean) =>
    setRevealedFiles((current) => {
      const next = new Set(current);
      if (isRevealed) next.add(filePath);
      else next.delete(filePath);
      return next;
    });
  const openLine = (file: string, line: number, side: "LEFT" | "RIGHT") => {
    setRevealed(file, true);
    afterRender(() => {
      const landed = jumpToLine(file, line, side);
      if (landed !== "line" && side === "RIGHT") viewer.open({ file, line });
    });
  };
  const openFile = (file: string) => {
    setRevealed(file, true);
    afterRender(() => jumpToFile(file));
  };
  const jumpToReference = (reference: Reference) => {
    closePeek();
    if (reference.isInPage) openLine(reference.file, reference.line, "RIGHT");
    else viewer.open({ file: reference.file, line: reference.line });
  };
  return { isRevealed: (filePath: string) => revealedFiles.has(filePath), setRevealed, openLine, openFile, jumpToReference };
}

type ConceptSource = { conceptKey: string; title: string; explanation: string; jsExample: string };

function hardIdeaAsConcept(idea: HardIdea): ConceptSource {
  const explanation = [idea.oneLiner, idea.analogy && `Like: ${idea.analogy}`, `Term: ${idea.term}`].filter(Boolean).join("\n\n");
  return { conceptKey: idea.conceptKey, title: idea.title, explanation, jsExample: idea.jsExample };
}

function useConcepts(page: PrPageData) {
  const [concepts, setConcepts] = useState(page.concepts);
  const replaceConcept = (saved: Concept) =>
    setConcepts((current) => [...current.filter((existing) => existing.conceptKey !== saved.conceptKey), saved]);
  const saveConcept = (source: ConceptSource, status: Concept["status"]) =>
    void api.saveConcept({ ...source, status, seenIn: [page.pr.key] }).then(replaceConcept);
  return { conceptsByKey: new Map(concepts.map((concept) => [concept.conceptKey, concept])), saveConcept };
}

function useCoaching(route: PrRoute, page: PrPageData, state: ReviewState, setState: ReviewStateSetter, viewer: FileViewerControls, files: DiffFile[]) {
  const [openAsk, setOpenAsk] = useState<OpenAsk | null>(null);
  const [openPeek, setOpenPeek] = useState<OpenPeek | null>(null);
  const { conceptsByKey, saveConcept } = useConcepts(page);
  const saveAnswer = (questionId: string, answer: QuestionAnswer) =>
    setState((current) => ({ ...current, answers: { ...current.answers, [questionId]: answer } }));
  const navigation = useFileNavigation(viewer, () => setOpenPeek(null));
  return {
    route, asks: page.asks, conceptsByKey, answers: state.answers, openAsk, setOpenAsk, openPeek, setOpenPeek, saveAnswer, saveConcept,
    explainChats: state.explainChats, saveExplainChat: (chatKey: string, chat: ExplainChatState) =>
      setState((current) => ({ ...current, explainChats: { ...current.explainChats, [chatKey]: chat } })),
    lineComments: placeLineComments(state.lineComments, files), ...lineCommentActions(setState, files), ...reviewedFileActions(state, setState), ...navigation,
  } satisfies Coaching & typeof navigation;
}

function LayoutToggle() {
  const layout = useDiffLayout();
  return (
    <div className="segmented" role="group" aria-label="Diff layout">
      <button className={layout === "split" ? "active" : ""} onClick={() => setDiffLayout("split")}>Side by side</button>
      <button className={layout === "unified" ? "active" : ""} onClick={() => setDiffLayout("unified")}>Unified</button>
    </div>
  );
}

function stopsOf(data: WalkthroughData): TourStop[] {
  const notCovered = (file: DiffFile): TourStop => ({ file: file.path, whyItMatters: "Not covered by the walkthrough.", notes: [], questions: [] });
  return [...data.walkthrough.tour, ...filesMissingFromTour(data.files, data.walkthrough.tour).map(notCovered)];
}

type PageMapProps = { data: WalkthroughData; stops: TourStop[]; coaching: Coaching & { openFile: (file: string) => void }; hasFinish: boolean };

function MapLink({ target, label, activeId }: { target: string; label: string; activeId: string | undefined }) {
  const jump = (event: React.MouseEvent) => {
    event.preventDefault();
    jumpToSection(target);
  };
  return <a href={`#${target}`} onClick={jump} className={target === activeId ? "is-active" : ""}>{label}</a>;
}

function baseName(filePath: string): string {
  return filePath.split("/").at(-1) ?? filePath;
}

/** Adds the parent folder when two stops share a file name. */
function shortNames(paths: string[]): Map<string, string> {
  const isShared = (name: string) => paths.filter((other) => baseName(other) === name).length > 1;
  const withParent = (filePath: string) => filePath.split("/").slice(-2).join("/");
  return new Map(paths.map((filePath) => [filePath, isShared(baseName(filePath)) ? withParent(filePath) : baseName(filePath)]));
}

function openQuestionCount(stop: TourStop, answers: ReviewState["answers"]): number {
  return stop.questions.filter((question) => !answers[question.id]?.decision).length;
}

function MapStop({ stop, stopNumber, name, file, coaching, isActive }: {
  stop: TourStop; stopNumber: number; name: string; file: DiffFile | undefined; coaching: PageMapProps["coaching"]; isActive: boolean;
}) {
  const isReviewed = file !== undefined && coaching.statusOf(file) === "reviewed";
  const openQuestions = openQuestionCount(stop, coaching.answers);
  return (
    <button className={`map-stop ${isReviewed ? "is-reviewed" : ""} ${isActive ? "is-active" : ""}`} onClick={() => coaching.openFile(stop.file)} title={stop.file}>
      <span className="map-stop-number">{isReviewed ? <Icon name="check" size={12} /> : stopNumber}</span>
      <span className="map-stop-name">{name}</span>
      {openQuestions > 0 ? <span className="map-badge" title="Questions left">{openQuestions}</span> : null}
    </button>
  );
}

/** The tour file at the top of the screen right now. */
function useCurrentTourFile(stops: TourStop[]): string | undefined {
  const activeId = useActiveAnchor(stops.map((stop) => tourStopId(stop.file)));
  return stops.find((stop) => tourStopId(stop.file) === activeId)?.file;
}

function readyGuide(page: PrPageData): Guide | null {
  return page.guide?.builtAt ? (page.guide.data as Guide | null) : null;
}

const SECTION_IDS = ["glance", "picture", "ideas", "guide", "flow", "removed"];

/** The sticky map on the left: sections, then every tour stop. */
function PageMap({ data, stops, coaching, hasFinish }: PageMapProps) {
  const fileByPath = new Map(data.files.map((file) => [file.path, file]));
  const walkthrough = data.walkthrough;
  const nameOf = shortNames(stops.map((stop) => stop.file));
  const activeId = useActiveAnchor([...SECTION_IDS, ...stops.map((stop) => tourStopId(stop.file)), "skim", "finish"]);
  return (
    <nav className="page-map" aria-label="On this page">
      <div className="map-heading">On this page</div>
      <MapLink target="glance" label="At a glance" activeId={activeId} />
      {walkthrough.picture?.diagram ? <MapLink target="picture" label="The big picture" activeId={activeId} /> : null}
      {walkthrough.hardIdeas?.length ? <MapLink target="ideas" label="Hard ideas" activeId={activeId} /> : null}
      <MapLink target="guide" label="Guide" activeId={activeId} />
      {walkthrough.flow.length ? <MapLink target="flow" label="How it runs" activeId={activeId} /> : null}
      {data.removed.length ? <MapLink target="removed" label="What got removed" activeId={activeId} /> : null}
      <div className="map-heading">Tour</div>
      {stops.map((stop, stopIndex) => (
        <MapStop key={stop.file} stop={stop} stopNumber={stopIndex + 1} name={nameOf.get(stop.file) ?? stop.file}
          file={fileByPath.get(stop.file)} coaching={coaching} isActive={activeId === tourStopId(stop.file)} />
      ))}
      {skimFiles(data.files).length ? <MapLink target="skim" label="Skim files" activeId={activeId} /> : null}
      {hasFinish ? <MapLink target="finish" label="Finish" activeId={activeId} /> : null}
    </nav>
  );
}

export function WalkthroughReview({ route, page, onReload }: { route: PrRoute; page: PrPageData; onReload: () => void }) {
  const data = page.walkthrough!.data as WalkthroughData;
  const isSomeoneElsesPr = page.pr.kind === "review";
  const [state, setState] = useSavedState<ReviewState>(route, page.reviewState, DEFAULT_REVIEW_STATE);
  const viewer = useFileViewer();
  const coaching = useCoaching(route, page, state, setState, viewer, data.files);
  const fileByPath = new Map(data.files.map((file) => [file.path, file]));
  const stops = stopsOf(data);
  const saveHardIdea = (idea: HardIdea, status: Concept["status"]) => coaching.saveConcept(hardIdeaAsConcept(idea), status);
  const latestChange = data.changes?.at(-1);
  const updatedFiles = new Set(latestChange?.files ?? []);
  const [guideStep, setGuideStep] = useState<number | null>(null);
  const currentFile = useCurrentTourFile(stops);
  const guide = readyGuide(page);

  return (
    <div className="review-layout">
      <PageMap data={data} stops={stops} coaching={coaching} hasFinish={isSomeoneElsesPr} />
      <div className="review-main">
        <ChangesBanner change={latestChange} onOpenFile={coaching.openFile} />
        <AtAGlance story={data.walkthrough.story} />
        <PictureSection picture={data.walkthrough.picture} />
        <HardIdeasSection ideas={data.walkthrough.hardIdeas} conceptsByKey={coaching.conceptsByKey} onSave={saveHardIdea} onOpenLine={coaching.openLine}
          ideaChats={{ route, chats: coaching.explainChats, onChatChange: coaching.saveExplainChat }} />
        <GuideSection guideJob={page.guide} files={data.files} statusOf={coaching.statusOf} toggleReviewed={coaching.toggleReviewed}
          onOpenFile={coaching.openFile} onPrepare={() => void api.prepareGuide(route).then(onReload)} onStartStep={setGuideStep} />
        <FlowSection route={route} flow={data.walkthrough.flow} files={data.files} onOpenLine={coaching.openLine} />
        <RemovedCodeSection removed={data.removed} />
        <section id="tour">
          <div className="section-bar">
            <h2><Icon name="code" /> Guided tour</h2>
            <LayoutToggle />
          </div>
          <p className="hint small"><Icon name="target" size={13} /> Click a line number to ask or comment. Ctrl+click a name to see where that exact thing is used.</p>
          {stops.map((stop, stopIndex) => (
            <TourStopView key={stop.file} stop={stop} stopNumber={stopIndex + 1} file={fileByPath.get(stop.file)} coaching={coaching}
              isUpdated={updatedFiles.has(stop.file)} />
          ))}
        </section>
        <SkimSection files={skimFiles(data.files)} coaching={coaching} />
        {isSomeoneElsesPr ? <FinishPanel route={route} walkthrough={data.walkthrough} state={state} setState={setState} lineComments={coaching.lineComments} /> : null}
      </div>
      <FileViewer route={route} viewer={viewer} />
      {guide && guideStep !== null ? (
        <GuideDock guide={guide} stepIndex={guideStep} files={data.files} currentFile={currentFile} statusOf={coaching.statusOf}
          toggleReviewed={coaching.toggleReviewed} onOpenFile={coaching.openFile} onChangeStep={setGuideStep} />
      ) : null}
    </div>
  );
}
