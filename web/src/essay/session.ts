import { useEffect, useRef, useState } from "react";

import { api, type Concept, type DiffFile, type PrPageData, type PrRoute, type Reference, type ReferenceQuery } from "../api.ts";
import { spanStart, type LineSpan } from "../../../server/anchors.ts";
import type { ExplainChatState } from "../components/ExplainChat.tsx";
import { useFileViewer } from "../components/FileViewer.tsx";
import { jumpToLine } from "../jump.ts";
import { lineTextFor, placeLineComments } from "../placeComments.ts";
import { diffFingerprint, reviewedStatusOf } from "../reviewedFiles.ts";
import { useSavedState, type LineComment, type QuestionAnswer, type ReviewState } from "../savedState.ts";
import { addHistoryStep } from "../scrollHistory.ts";
import { stepOfFile, type EssayStep } from "./model.ts";

export type EssayView = { kind: "lede" } | { kind: "step"; index: number } | { kind: "finish" } | { kind: "files" };

export const DEFAULT_REVIEW_STATE: ReviewState = {
  answers: {}, explainChats: {}, lineComments: [], reviewedFiles: {}, summary: "", verdict: null, postedUrl: null,
};

type ReviewStateSetter = (update: (current: ReviewState) => ReviewState) => void;

export type ConceptSource = { conceptKey: string; title: string; explanation: string; jsExample: string };

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

function useConcepts(page: PrPageData) {
  const [concepts, setConcepts] = useState(page.concepts);
  const replaceConcept = (saved: Concept) =>
    setConcepts((current) => [...current.filter((existing) => existing.conceptKey !== saved.conceptKey), saved]);
  const saveConcept = (source: ConceptSource, status: Concept["status"]) =>
    void api.saveConcept({ ...source, status, seenIn: [page.pr.key] }).then(replaceConcept);
  return { conceptsByKey: new Map(concepts.map((concept) => [concept.conceptKey, concept])), saveConcept };
}

/** Runs after React has drawn the latest state. */
export function afterRender(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

export function fileAnchorId(path: string): string {
  return `file-${path.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

type PendingJump = { file: string; line?: number; side?: "LEFT" | "RIGHT" };

function scrollToFileSection(file: string): boolean {
  const section = document.getElementById(fileAnchorId(file));
  if (!section) return false;
  addHistoryStep();
  section.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

/** Goes to the step that holds a file, then to the file or its line. */
function useEssayNavigation(steps: EssayStep[], view: EssayView, goTo: (view: EssayView) => void, viewer: ReturnType<typeof useFileViewer>) {
  const pending = useRef<PendingJump | null>(null);
  const land = (jump: PendingJump) => {
    const landed = jump.line === undefined ? scrollToFileSection(jump.file) : jumpToLine(jump.file, jump.line, jump.side ?? "RIGHT");
    if (!landed && jump.line !== undefined && jump.side !== "LEFT") viewer.open({ file: jump.file, line: jump.line });
  };
  useEffect(() => {
    const jump = pending.current;
    if (!jump) return;
    pending.current = null;
    afterRender(() => land(jump));
  }, [view]);
  const go = (jump: PendingJump) => {
    const stepIndex = stepOfFile(steps, jump.file);
    const isHere = view.kind === "step" && view.index === stepIndex;
    if (stepIndex === -1 || isHere) return afterRender(() => land(jump));
    pending.current = jump;
    goTo({ kind: "step", index: stepIndex });
  };
  return {
    openFile: (file: string) => go({ file }),
    openLine: (file: string, line: number, side: "LEFT" | "RIGHT") => go({ file, line, side }),
  };
}

export type ComposerTarget = { file: string } & LineSpan;

/** Everything the essay screens share: saved progress, drafts, concepts, navigation. */
export function useReviewSession(route: PrRoute, page: PrPageData, files: DiffFile[], steps: EssayStep[], view: EssayView, goTo: (view: EssayView) => void) {
  const [state, setState] = useSavedState<ReviewState>(route, page.reviewState, DEFAULT_REVIEW_STATE);
  const viewer = useFileViewer();
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [peek, setPeek] = useState<ReferenceQuery | null>(null);
  const { conceptsByKey, saveConcept } = useConcepts(page);
  const navigation = useEssayNavigation(steps, view, goTo, viewer);
  const jumpToReference = (reference: Reference) => {
    setPeek(null);
    if (reference.isInPage) navigation.openLine(reference.file, reference.line, "RIGHT");
    else viewer.open({ file: reference.file, line: reference.line });
  };
  return {
    route, page, state, setState, viewer, composer, setComposer, peek, setPeek, jumpToReference, conceptsByKey, saveConcept,
    asks: page.asks,
    saveAnswer: (questionId: string, answer: QuestionAnswer) =>
      setState((current) => ({ ...current, answers: { ...current.answers, [questionId]: answer } })),
    saveExplainChat: (chatKey: string, chat: ExplainChatState) =>
      setState((current) => ({ ...current, explainChats: { ...current.explainChats, [chatKey]: chat } })),
    lineComments: placeLineComments(state.lineComments, files),
    ...lineCommentActions(setState, files),
    ...reviewedFileActions(state, setState),
    ...navigation,
  };
}

export type ReviewSession = ReturnType<typeof useReviewSession>;
