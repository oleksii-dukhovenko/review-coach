import type { DiffFile, DiffLine, Guide, HardIdea, WalkthroughData } from "../api.ts";
import { commentFlags } from "../components/commentLines.ts";

type TourStop = WalkthroughData["walkthrough"]["tour"][number];
export type NoteData = TourStop["notes"][number];
export type QuestionData = TourStop["questions"][number];
type Side = "LEFT" | "RIGHT";

export type Footnote = { number: number; note: NoteData };

export type Figure = {
  id: string;
  number: string;
  file: string;
  lines: DiffLine[];
  firstLine: number;
  lastLine: number;
  questionsAfter: QuestionData[];
};

export type EssayFile = {
  path: string;
  diff: DiffFile | undefined;
  why: string;
  footnotes: Footnote[];
  figures: Figure[];
  // - Questions about lines that no figure shows.
  looseQuestions: QuestionData[];
  isSkim: boolean;
};

export type EssayStep = {
  index: number;
  title: string;
  oneLiner: string;
  summary: string;
  role: "core" | "follow-on" | "supporting";
  files: EssayFile[];
  minutes: number;
  questionCount: number;
  problemCount: number;
};

const CHANGED_LINES_PER_MINUTE = 40;

type Anchored = { line: number; endLine?: number; side: Side };

/** Notes and questions belong to the last line they cover. */
export function anchorLine(item: Anchored): { line: number; side: Side } {
  return { line: Math.max(item.endLine ?? item.line, item.line), side: item.side };
}

export function isLineAt(line: DiffLine, point: { line: number; side: Side }): boolean {
  return point.side === "LEFT" ? line.kind === "del" && line.oldLine === point.line : line.kind !== "del" && line.newLine === point.line;
}

export type LineRange = { firstLine: number; lastLine: number; side: Side };

/** Every line a note or question covers. */
export function rangeOf(item: Anchored): LineRange {
  const endLine = item.endLine ?? item.line;
  return { firstLine: Math.min(item.line, endLine), lastLine: Math.max(item.line, endLine), side: item.side };
}

function numberOnSide(line: DiffLine, side: Side): number | null {
  if (side === "LEFT") return line.kind === "del" ? line.oldLine : null;
  return line.kind === "del" ? null : line.newLine;
}

export function isLineInRange(line: DiffLine, range: LineRange): boolean {
  const number = numberOnSide(line, range.side);
  return number !== null && number >= range.firstLine && number <= range.lastLine;
}

/** The first line of the range that a figure shows, where its note lines up. */
export function firstShownLine(lines: DiffLine[], range: LineRange): DiffLine | undefined {
  return lines.find((line) => isLineInRange(line, range));
}

export function rangeLabel(range: LineRange): string {
  return range.firstLine === range.lastLine ? `line ${range.firstLine}` : `lines ${range.firstLine}–${range.lastLine}`;
}

function newSideRange(lines: DiffLine[]): { firstLine: number; lastLine: number } {
  const numbers = lines.map((line) => line.newLine ?? line.oldLine ?? 0).filter((number) => number > 0);
  return { firstLine: Math.min(...numbers), lastLine: Math.max(...numbers) };
}

function figureFor(file: DiffFile, hunkIndex: number, label: string): Figure {
  const lines = file.hunks[hunkIndex].lines;
  return { id: `fig-${label}`, number: label, file: file.path, lines, ...newSideRange(lines), questionsAfter: [] };
}

function figuresOf(file: DiffFile | undefined, stepNumber: number, startCount: number): Figure[] {
  if (!file || file.isBinary) return [];
  return file.hunks.map((_hunk, hunkIndex) => figureFor(file, hunkIndex, `${stepNumber}.${startCount + hunkIndex + 1}`));
}

function figureShowing(figures: Figure[], point: { line: number; side: Side }): Figure | undefined {
  return figures.find((figure) => figure.lines.some((line) => isLineAt(line, point)));
}

/** Each question goes after the figure that shows its line, or stays loose. */
function placeQuestions(figures: Figure[], questions: QuestionData[]): QuestionData[] {
  const loose: QuestionData[] = [];
  for (const question of questions) {
    const figure = figureShowing(figures, anchorLine(question));
    if (figure) figure.questionsAfter.push(question);
    else loose.push(question);
  }
  return loose;
}

type FileInput = { path: string; diff: DiffFile | undefined; stop: TourStop | undefined };

function essayFile(input: FileInput, stepNumber: number, counters: { figures: number; footnotes: number }): EssayFile {
  const figures = figuresOf(input.diff, stepNumber, counters.figures);
  counters.figures += figures.length;
  const footnotes = (input.stop?.notes ?? []).map((note) => ({ number: ++counters.footnotes, note }));
  const looseQuestions = placeQuestions(figures, input.stop?.questions ?? []);
  const isSkim = input.diff?.tag === "skim";
  return { path: input.path, diff: input.diff, why: input.stop?.whyItMatters ?? "", footnotes, figures, looseQuestions, isSkim };
}

function changedLineCount(file: EssayFile): number {
  if (file.isSkim || !file.diff) return 0;
  return file.diff.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind !== "ctx").length;
}

function questionsIn(files: EssayFile[]): QuestionData[] {
  return files.flatMap((file) => [...file.figures.flatMap((figure) => figure.questionsAfter), ...file.looseQuestions]);
}

/** About a minute per 40 changed lines, plus a minute per question. */
export function minutesFor(files: EssayFile[]): number {
  const changedLines = files.reduce((sum, file) => sum + changedLineCount(file), 0);
  return Math.max(1, Math.round(changedLines / CHANGED_LINES_PER_MINUTE + questionsIn(files).length));
}

type StepInput = { title: string; oneLiner: string; summary: string; role: EssayStep["role"]; paths: string[] };

function chaptersOf(guide: Guide): StepInput[] {
  return guide.chapters.map((chapter) => ({
    title: chapter.title,
    oneLiner: chapter.oneLiner || chapter.summary.split(/(?<=\.)\s/)[0],
    summary: chapter.summary,
    role: chapter.role,
    paths: chapter.files.map((entry) => entry.file),
  }));
}

/** Without a guide, each tour stop is its own step. */
function stopsAsSteps(tour: TourStop[]): StepInput[] {
  return tour.map((stop) => ({ title: stop.file.split("/").at(-1) ?? stop.file, oneLiner: stop.whyItMatters, summary: "", role: "core", paths: [stop.file] }));
}

function filesNoStepCovers(steps: StepInput[], files: DiffFile[]): string[] {
  const covered = new Set(steps.flatMap((step) => step.paths));
  return files.map((file) => file.path).filter((path) => !covered.has(path));
}

function withLeftovers(steps: StepInput[], files: DiffFile[]): StepInput[] {
  const leftovers = filesNoStepCovers(steps, files);
  if (leftovers.length === 0) return steps;
  return [...steps, { title: "Everything else", oneLiner: "Files no step covers.", summary: "", role: "supporting", paths: leftovers }];
}

/** The walkthrough as steps of an essay: text, figures, footnoted notes, inline questions. */
export function buildSteps(data: WalkthroughData, guide: Guide | null): EssayStep[] {
  const diffByPath = new Map(data.files.map((file) => [file.path, file]));
  const stopByPath = new Map(data.walkthrough.tour.map((stop) => [stop.file, stop]));
  const inputs = withLeftovers(guide ? chaptersOf(guide) : stopsAsSteps(data.walkthrough.tour), data.files);
  return inputs.map((input, index) => {
    const counters = { figures: 0, footnotes: 0 };
    const files = input.paths.map((path) => essayFile({ path, diff: diffByPath.get(path), stop: stopByPath.get(path) }, index + 1, counters));
    const questions = questionsIn(files);
    return {
      index, title: input.title, oneLiner: input.oneLiner, summary: input.summary, role: input.role, files,
      minutes: minutesFor(files), questionCount: questions.length,
      problemCount: questions.filter((question) => question.severity === "problem").length,
    };
  });
}

export function stepOfFile(steps: EssayStep[], path: string): number {
  return steps.findIndex((step) => step.files.some((file) => file.path === path));
}

export type FoldedRun = { kind: "fold"; id: string; lines: DiffLine[]; reason: "unchanged" | "comment" | "far" };

export type ShownRow = { kind: "line"; line: DiffLine } | FoldedRun;

const LONG_UNCHANGED_RUN = 6;
const KEPT_CONTEXT = 2;
const LONG_COMMENT_RUN = 3;
const LONG_FIGURE = 40;
const KEPT_AROUND_PIN = 6;
const LONG_FAR_RUN = 8;

type Run = { start: number; end: number };

function runsWhere(lines: DiffLine[], matches: (lineIndex: number) => boolean): Run[] {
  const runs: Run[] = [];
  let start = -1;
  lines.forEach((_line, lineIndex) => {
    if (matches(lineIndex) && start === -1) start = lineIndex;
    if (!matches(lineIndex) && start !== -1) {
      runs.push({ start, end: lineIndex - 1 });
      start = -1;
    }
  });
  if (start !== -1) runs.push({ start, end: lines.length - 1 });
  return runs;
}

/** In a long figure, lines far from every pinned line, so the eye lands on what the notes discuss. */
function farFromPins(figure: Figure, isPinned: (line: DiffLine) => boolean): Run[] {
  const pinned = figure.lines.map((line, lineIndex) => (isPinned(line) ? lineIndex : -1)).filter((lineIndex) => lineIndex !== -1);
  if (figure.lines.length <= LONG_FIGURE || pinned.length === 0) return [];
  const isFar = (lineIndex: number) => pinned.every((pin) => Math.abs(pin - lineIndex) > KEPT_AROUND_PIN);
  return runsWhere(figure.lines, isFar).filter((run) => run.end - run.start + 1 > LONG_FAR_RUN);
}

/** Long stretches of unchanged, comment-only, or far-off lines fold to one row; pinned lines never fold. */
export function foldRows(figure: Figure, isPinned: (line: DiffLine) => boolean): ShownRow[] {
  const isComment = commentFlags(figure.lines.map((line) => line.text), figure.file);
  const isFoldable = (lineIndex: number) => !isPinned(figure.lines[lineIndex]);
  const unchanged = runsWhere(figure.lines, (lineIndex) => figure.lines[lineIndex].kind === "ctx" && isFoldable(lineIndex))
    .filter((run) => run.end - run.start + 1 > LONG_UNCHANGED_RUN)
    .map((run) => ({ start: run.start + KEPT_CONTEXT, end: run.end - KEPT_CONTEXT, reason: "unchanged" as const }));
  const comments = runsWhere(figure.lines, (lineIndex) => isComment[lineIndex] && isFoldable(lineIndex))
    .filter((run) => run.end - run.start + 1 >= LONG_COMMENT_RUN)
    .map((run) => ({ ...run, reason: "comment" as const }));
  const far = farFromPins(figure, isPinned).map((run) => ({ ...run, reason: "far" as const }));
  const folds = [...far, ...unchanged, ...comments].sort((left, right) => left.start - right.start || right.end - left.end);
  const rows: ShownRow[] = [];
  let lineIndex = 0;
  for (const fold of folds) {
    if (fold.start < lineIndex) continue;
    figure.lines.slice(lineIndex, fold.start).forEach((line) => rows.push({ kind: "line", line }));
    rows.push({ kind: "fold", id: `${figure.id}:${fold.start}`, lines: figure.lines.slice(fold.start, fold.end + 1), reason: fold.reason });
    lineIndex = fold.end + 1;
  }
  figure.lines.slice(lineIndex).forEach((line) => rows.push({ kind: "line", line }));
  return rows;
}

export type AttentionItem = { title: string; body: string; stepRef: string; stepIndex: number; isLowRisk: boolean };

const MAX_ATTENTION = 4;

function stepRef(indexes: number[]): string {
  const numbers = [...new Set(indexes)].sort((left, right) => left - right).map((index) => index + 1);
  if (numbers.length === 0) return "";
  return numbers.length === 1 ? `step ${numbers[0]}` : `step ${numbers[0]}–${numbers.at(-1)}`;
}

function problemItems(steps: EssayStep[]): AttentionItem[] {
  return steps.filter((step) => step.problemCount > 0).map((step) => ({
    title: step.title,
    body: `${step.problemCount} question${step.problemCount === 1 ? "" : "s"} here point at a real problem.`,
    stepRef: stepRef([step.index]), stepIndex: step.index, isLowRisk: false,
  }));
}

function ideaItems(ideas: HardIdea[], steps: EssayStep[]): AttentionItem[] {
  return ideas.map((idea) => {
    const index = Math.max(0, stepOfFile(steps, idea.file));
    return { title: idea.title, body: idea.oneLiner, stepRef: stepRef([index]), stepIndex: index, isLowRisk: false };
  });
}

function lowRiskItem(steps: EssayStep[]): AttentionItem[] {
  const quiet = steps.filter((step) => step.role === "supporting" && step.questionCount === 0);
  if (quiet.length === 0) return [];
  return [{ title: quiet.length === 1 ? `${quiet[0].title} is low-risk` : "Supporting steps are low-risk", body: "No questions there. Skim it.", stepRef: stepRef(quiet.map((step) => step.index)), stepIndex: quiet[0].index, isLowRisk: true }];
}

/** Ranked: steps with real problems, then hard ideas, then the quiet part to skim. */
export function attentionItems(steps: EssayStep[], ideas: HardIdea[] | undefined): AttentionItem[] {
  const ranked = [...problemItems(steps), ...ideaItems(ideas ?? [], steps)].slice(0, MAX_ATTENTION - 1);
  return [...ranked, ...lowRiskItem(steps)];
}
