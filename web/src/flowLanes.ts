import type { DiffFile, Walkthrough } from "./api.ts";

export type FlowStep = Walkthrough["flow"][number];

export type StepChange = "changed" | "same-file" | "existing";

const LAYER_NAME: Record<FlowStep["layer"], string> = {
  screen: "Screen", logic: "App logic", api: "API", data: "Data", device: "Device", external: "Outside service", test: "Test",
};

/** Walkthroughs built before actors existed use the layer, then the file. */
export function actorOf(step: FlowStep): string {
  return step.actor || (step.layer ? LAYER_NAME[step.layer] : undefined) || (step.file.split("/").at(-1) ?? step.file);
}

/** One lane per actor, in the order they first act. */
export function lanesOf(flow: FlowStep[]): string[] {
  return [...new Set(flow.map(actorOf))];
}

function addedLinesOf(file: DiffFile): Set<number> {
  const added = file.hunks.flatMap((hunk) => hunk.lines).filter((line) => line.kind === "add");
  return new Set(added.map((line) => line.newLine!));
}

/** Whether this PR wrote the step's line, touched its file, or left it alone. */
export function stepChange(step: FlowStep, files: DiffFile[]): StepChange {
  const file = files.find((candidate) => candidate.path === step.file);
  if (!file) return "existing";
  return addedLinesOf(file).has(step.line) ? "changed" : "same-file";
}

const EMPTY_HAND_OFFS = new Set(["", "nothing", "none", "n/a", "-"]);

/** What a step hands on, or empty when Claude wrote a filler word. */
export function handOffOf(step: FlowStep): string {
  const sends = (step.sends ?? "").trim();
  return EMPTY_HAND_OFFS.has(sends.toLowerCase()) ? "" : sends;
}

export function changedLinesIn(files: DiffFile[], filePath: string): Set<number> {
  const file = files.find((candidate) => candidate.path === filePath);
  return file ? addedLinesOf(file) : new Set();
}
