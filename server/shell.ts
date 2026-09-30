import { spawn } from "node:child_process";

export type CommandResult = { stdout: string; stderr: string; exitCode: number };

type CommandOptions = { cwd?: string; input?: string };

/** Runs a command and collects its output, never throwing. */
export function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (error) => resolve({ stdout: "", stderr: error.message, exitCode: -1 }));
    child.on("close", (exitCode) =>
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? -1,
      }),
    );
    child.stdin.end(options.input ?? "");
  });
}

/** Runs a command and returns stdout, throwing on a non-zero exit. */
export async function runOrThrow(command: string, args: string[], options: CommandOptions = {}): Promise<string> {
  const result = await runCommand(command, args, options);
  if (result.exitCode === 0) return result.stdout;
  const summary = `${command} ${args.slice(0, 3).join(" ")}`;
  throw new Error(`${summary} failed: ${result.stderr.trim() || result.stdout.trim()}`);
}
