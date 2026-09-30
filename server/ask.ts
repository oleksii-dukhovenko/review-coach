import { ensureCheckout } from "./checkout.ts";
import { streamClaude } from "./claude.ts";
import { config } from "./config.ts";
import { getAskSession, getJob, getPr, saveAsk, saveAskSession } from "./db.ts";
import { askPrompt } from "./prompts.ts";
import type { DiffFile } from "./types.ts";

export type Question = { file: string; line: number; side: "LEFT" | "RIGHT"; question: string };

function jobFiles(prKey: string): DiffFile[] {
  const job = getJob(prKey, "walkthrough") ?? getJob(prKey, "triage");
  return (job?.data as { files?: DiffFile[] } | null)?.files ?? [];
}

function codeAtLine(prKey: string, question: Question): string {
  const file = jobFiles(prKey).find((diffFile) => diffFile.path === question.file);
  const lines = file?.hunks.flatMap((hunk) => hunk.lines) ?? [];
  const match = lines.find((line) => (question.side === "RIGHT" ? line.newLine : line.oldLine) === question.line);
  return match?.text ?? "(line not in the diff)";
}

function buildSessionFor(prKey: string): string | undefined {
  return getJob(prKey, "walkthrough")?.sessionId ?? getJob(prKey, "triage")?.sessionId ?? undefined;
}

type SessionPlan = { resumeSessionId?: string; forkSession: boolean; isFirstAsk: boolean };

/** Follow-ups continue the ask session; the first ask forks the build session. */
function planSession(prKey: string): SessionPlan {
  const askSession = getAskSession(prKey);
  if (askSession) return { resumeSessionId: askSession, forkSession: false, isFirstAsk: false };
  const buildSession = buildSessionFor(prKey);
  if (buildSession) return { resumeSessionId: buildSession, forkSession: true, isFirstAsk: false };
  return { forkSession: false, isFirstAsk: true };
}

export async function answerQuestion(prKey: string, question: Question, onText: (text: string) => void): Promise<void> {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`Unknown PR ${prKey}`);
  const { worktree } = await ensureCheckout(pr);
  const session = planSession(prKey);
  const prompt = askPrompt({ ...question, codeLine: codeAtLine(prKey, question), isFirstAsk: session.isFirstAsk });
  const answer = await streamClaude({ cwd: worktree, prompt, ...session, addDirs: [config.conceptsDir] }, onText);
  saveAskSession(prKey, answer.sessionId);
  saveAsk({ prKey, file: question.file, line: question.line, question: question.question, answer: answer.text });
}
