import { spawn } from "node:child_process";
import readline from "node:readline";

import { config } from "./config.ts";
import { runCommand } from "./shell.ts";

export class UsageLimitError extends Error {}

type ClaudeResult = {
  is_error: boolean;
  result?: string;
  session_id: string;
  structured_output?: unknown;
  api_error_status?: number | null;
};

type JsonRunOptions = { cwd: string; prompt: string; jsonSchema: object; sessionId: string; addDirs: string[] };

type StreamRunOptions = { cwd: string; prompt: string; resumeSessionId?: string; forkSession: boolean; addDirs: string[] };

const USAGE_LIMIT_TEXT = /usage limit|rate limit|limit reached|out of extra usage|credit balance/i;

/** Read-only Claude: no MCP servers, hooks, or write tools. */
function lockedDownArgs(addDirs: string[]): string[] {
  const modelArgs = config.model ? ["--model", config.model] : [];
  const dirArgs = addDirs.flatMap((dir) => ["--add-dir", dir]);
  return [
    "-p", "--setting-sources", "", "--strict-mcp-config",
    "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk",
    ...modelArgs, ...dirArgs,
  ];
}

function isUsageLimit(result: ClaudeResult): boolean {
  return result.api_error_status === 429 || USAGE_LIMIT_TEXT.test(result.result ?? "");
}

function failureFor(result: ClaudeResult): Error {
  if (isUsageLimit(result)) return new UsageLimitError(result.result ?? "Claude usage limit reached");
  return new Error(`Claude failed: ${result.result ?? "no message"}`);
}

function parseResultLine(stdout: string, stderr: string): ClaudeResult {
  const resultLine = stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(resultLine) as ClaudeResult;
  } catch {
    const message = stderr.trim() || stdout.trim() || "no output";
    if (USAGE_LIMIT_TEXT.test(message)) throw new UsageLimitError(message);
    throw new Error(`Claude returned no result: ${message.slice(0, 500)}`);
  }
}

/** Runs Claude once and returns output matching the JSON schema. */
export async function runClaudeJson(options: JsonRunOptions): Promise<unknown> {
  const args = [
    ...lockedDownArgs(options.addDirs),
    "--output-format", "json",
    "--json-schema", JSON.stringify(options.jsonSchema),
    "--session-id", options.sessionId,
  ];
  const output = await runCommand("claude", args, { cwd: options.cwd, input: options.prompt });
  const result = parseResultLine(output.stdout, output.stderr);
  if (result.is_error || result.structured_output === undefined) throw failureFor(result);
  return result.structured_output;
}

type StreamEvent = {
  type: string;
  session_id?: string;
  event?: { type: string; delta?: { type: string; text?: string } };
} & Partial<ClaudeResult>;

function textDelta(event: StreamEvent): string | undefined {
  const isTextDelta = event.type === "stream_event" && event.event?.delta?.type === "text_delta";
  return isTextDelta ? event.event?.delta?.text : undefined;
}

function streamArgs(options: StreamRunOptions): string[] {
  const resumeArgs = options.resumeSessionId ? ["--resume", options.resumeSessionId] : [];
  const forkArgs = options.resumeSessionId && options.forkSession ? ["--fork-session"] : [];
  return [
    ...lockedDownArgs(options.addDirs),
    "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    ...resumeArgs, ...forkArgs,
  ];
}

/** Streams a text answer, calling onText as words arrive. */
export function streamClaude(options: StreamRunOptions, onText: (text: string) => void): Promise<{ sessionId: string; text: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", streamArgs(options), { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let sessionId = options.resumeSessionId ?? "";
    let finalResult: ClaudeResult | undefined;
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      const event = safeParse(line);
      if (!event) return;
      sessionId = event.session_id ?? sessionId;
      const delta = textDelta(event);
      if (delta) onText(delta);
      if (event.type === "result") finalResult = event as ClaudeResult;
    });
    child.on("error", reject);
    child.on("close", () => {
      if (!finalResult) return reject(new Error(`Claude stopped early: ${stderr.trim().slice(0, 500)}`));
      if (finalResult.is_error) return reject(failureFor(finalResult));
      resolve({ sessionId, text: finalResult.result ?? "" });
    });
    child.stdin.end(options.prompt);
  });
}

function safeParse(line: string): StreamEvent | undefined {
  try {
    return JSON.parse(line) as StreamEvent;
  } catch {
    return undefined;
  }
}
