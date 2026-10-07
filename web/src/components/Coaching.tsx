import type { Walkthrough } from "../api.ts";

type TourStop = Walkthrough["tour"][number];
export type CoachingQuestionData = TourStop["questions"][number];
export type TeachingNoteData = TourStop["notes"][number];

export function checkAnswerPrompt(question: CoachingQuestionData, typed: string): string {
  return [
    `Coaching question: "${question.question}"`,
    `My answer: "${typed}"`,
    `The expected answer: ${question.because}`,
    "First line, exactly one of: `Verdict: Right`, `Verdict: Half right`, `Verdict: Not quite`.",
    "Then 3-5 short lines: what I got right, what I missed, and why it matters. Do not repeat the whole answer.",
  ].join("\n");
}

const VERDICT_LINE = /^\W*verdict:\s*([^\n*`]+?)[\s*`]*$/im;

/** The coach's verdict and the reply without it; older replies have no verdict. */
export function splitVerdict(feedback: string): { verdict: string | null; reply: string } {
  const match = feedback.match(VERDICT_LINE);
  if (!match || feedback.indexOf(match[0]) > 0) return { verdict: null, reply: feedback };
  return { verdict: match[1].trim(), reply: feedback.slice(match[0].length).trim() };
}
