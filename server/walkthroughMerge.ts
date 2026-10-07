import { hasSameChanges, moveAnchored } from "./anchors.ts";
import type { HardIdea, TourStop, Walkthrough, WalkthroughUpdate } from "./schemas.ts";
import type { DiffFile, RemovedSymbol } from "./types.ts";

type FlowStep = Walkthrough["flow"][number];

export type WalkthroughChange = { fromSha: string; toSha: string; at: string; summary: string; files: string[] };

export type MergeableData = { walkthrough: Walkthrough; files: DiffFile[]; removed: RemovedSymbol[]; changes?: WalkthroughChange[] };

export type UpdatePlan = {
  // - Stops whose notes and questions only moved lines.
  kept: Map<string, TourStop>;
  // - Reviewable files Claude must look at again.
  redo: string[];
};

function isReviewable(file: DiffFile): boolean {
  return file.tag !== "skim";
}

function filesByPath(files: DiffFile[]): Map<string, DiffFile> {
  return new Map(files.map((file) => [file.path, file]));
}

function movedItems<T extends { line: number; endLine?: number; side: "LEFT" | "RIGHT" }>(items: T[], oldFile: DiffFile, newFile: DiffFile) {
  const moved = items.map((item) => moveAnchored(item, oldFile, newFile));
  return moved.every((item) => item !== undefined) ? (moved as T[]) : undefined;
}

function isIdenticalDiff(oldFile: DiffFile, newFile: DiffFile): boolean {
  return JSON.stringify(oldFile.hunks) === JSON.stringify(newFile.hunks);
}

/** The old stop with every anchor moved, or undefined if any anchor's code changed. */
export function moveStop(stop: TourStop, oldFile: DiffFile, newFile: DiffFile): TourStop | undefined {
  if (isIdenticalDiff(oldFile, newFile)) return stop;
  if (!hasSameChanges(oldFile, newFile)) return undefined;
  const notes = movedItems(stop.notes, oldFile, newFile);
  const questions = movedItems(stop.questions, oldFile, newFile);
  return notes && questions ? { ...stop, notes, questions } : undefined;
}

type FileVerdict = { action: "keep"; stop: TourStop } | { action: "redo" } | { action: "leave" };

/** Keep a stop that only moved, leave files the tour skipped, redo the rest. */
function verdictFor(oldStop: TourStop | undefined, oldFile: DiffFile | undefined, newFile: DiffFile): FileVerdict {
  const isUnchanged = oldFile !== undefined && hasSameChanges(oldFile, newFile);
  if (!oldStop) return isUnchanged ? { action: "leave" } : { action: "redo" };
  const moved = oldFile ? moveStop(oldStop, oldFile, newFile) : undefined;
  return moved ? { action: "keep", stop: moved } : { action: "redo" };
}

/** Splits the new diff into stops that can be kept and files to look at again. */
export function planUpdate(previous: MergeableData, newFiles: DiffFile[]): UpdatePlan {
  const oldFiles = filesByPath(previous.files);
  const oldStops = new Map(previous.walkthrough.tour.map((stop) => [stop.file, stop]));
  const kept = new Map<string, TourStop>();
  const redo: string[] = [];
  for (const newFile of newFiles.filter(isReviewable)) {
    const verdict = verdictFor(oldStops.get(newFile.path), oldFiles.get(newFile.path), newFile);
    if (verdict.action === "keep") kept.set(newFile.path, verdict.stop);
    if (verdict.action === "redo") redo.push(newFile.path);
  }
  return { kept, redo };
}

function questionIdsOf(stops: TourStop[]): Set<string> {
  return new Set(stops.flatMap((stop) => stop.questions.map((question) => question.id)));
}

/** Gives new questions ids that cannot clash with kept ones. */
export function withUniqueIds(redoneStops: TourStop[], keptStops: TourStop[], idPrefix: string): TourStop[] {
  const taken = questionIdsOf(keptStops);
  let counter = 0;
  const freshId = () => {
    let candidate = `${idPrefix}${++counter}`;
    while (taken.has(candidate)) candidate = `${idPrefix}${++counter}`;
    return candidate;
  };
  return redoneStops.map((stop) => ({
    ...stop,
    questions: stop.questions.map((question) => {
      const id = taken.has(question.id) ? freshId() : question.id;
      taken.add(id);
      return { ...question, id };
    }),
  }));
}

/** Old tour order first, then files new to the tour. */
function orderStops(previousTour: TourStop[], stopsByFile: Map<string, TourStop>): TourStop[] {
  const oldOrder = previousTour.map((stop) => stop.file).filter((file) => stopsByFile.has(file));
  const newOnes = [...stopsByFile.keys()].filter((file) => !oldOrder.includes(file));
  return [...oldOrder, ...newOnes].map((file) => stopsByFile.get(file)!);
}

function moveFlowStep(step: FlowStep, oldFiles: Map<string, DiffFile>, newFiles: Map<string, DiffFile>): FlowStep {
  const oldFile = oldFiles.get(step.file);
  const newFile = newFiles.get(step.file);
  const moved = oldFile && newFile ? moveAnchored({ ...step, side: "RIGHT" as const }, oldFile, newFile) : undefined;
  return moved ? { ...step, line: moved.line } : step;
}

function mergedHardIdeas(previous: HardIdea[] | undefined, added: HardIdea[]): HardIdea[] {
  const known = new Set((previous ?? []).map((idea) => idea.conceptKey));
  return [...(previous ?? []), ...added.filter((idea) => !known.has(idea.conceptKey))];
}

export type MergeInput = {
  previous: MergeableData;
  plan: UpdatePlan;
  update: WalkthroughUpdate | undefined;
  newFiles: DiffFile[];
  removed: RemovedSymbol[];
  change: Omit<WalkthroughChange, "summary" | "files">;
  idPrefix: string;
};

function redoneStops(input: MergeInput): TourStop[] {
  const answered = new Set(input.update?.stops.map((stop) => stop.file) ?? []);
  const fromClaude = (input.update?.stops ?? []).filter((stop) => input.plan.redo.includes(stop.file));
  const missing = input.plan.redo.filter((file) => !answered.has(file));
  const placeholders = missing.map((file) => ({ file, whyItMatters: "", notes: [], questions: [] }));
  return [...fromClaude, ...placeholders];
}

/** The new walkthrough: kept stops, redone stops, and old parts Claude left alone. */
export function mergeUpdate(input: MergeInput): MergeableData {
  const { previous, plan, update } = input;
  const keptStops = [...plan.kept.values()];
  const redone = withUniqueIds(redoneStops(input), keptStops, input.idPrefix);
  const stopsByFile = new Map([...keptStops, ...redone].map((stop) => [stop.file, stop]));
  const oldFiles = filesByPath(previous.files);
  const newFiles = filesByPath(input.newFiles);
  const old = previous.walkthrough;
  const walkthrough: Walkthrough = {
    story: update?.story ?? old.story,
    picture: update?.picture ?? old.picture,
    hardIdeas: mergedHardIdeas(old.hardIdeas, update?.newHardIdeas ?? []),
    flow: update?.flow ?? old.flow.map((step) => moveFlowStep(step, oldFiles, newFiles)),
    tour: orderStops(old.tour, stopsByFile),
  };
  const summary = update?.sinceLastTime ?? "The new commits only moved lines or changed files you skim.";
  const change = { ...input.change, summary, files: plan.redo };
  return { walkthrough, files: input.newFiles, removed: input.removed, changes: [...(previous.changes ?? []), change] };
}
