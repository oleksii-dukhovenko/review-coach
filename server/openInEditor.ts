import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ensureCheckout } from "./checkout.ts";
import { config } from "./config.ts";
import type { PullRequest } from "./types.ts";

// - How each terminal takes a folder and a command to run.
const TERMINALS: Record<string, (folder: string, command: string[]) => string[]> = {
  ptyxis: (folder, command) => ["--new-window", "-d", folder, "--", ...command],
  "gnome-terminal": (folder, command) => ["--working-directory", folder, "--", ...command],
  kitty: (folder, command) => ["--directory", folder, ...command],
  alacritty: (folder, command) => ["--working-directory", folder, "-e", ...command],
  wezterm: (folder, command) => ["start", "--cwd", folder, "--", ...command],
  foot: (folder, command) => ["-D", folder, ...command],
  ghostty: (folder, command) => [`--working-directory=${folder}`, "-e", ...command],
};

function isOnPath(program: string): boolean {
  const folders = (process.env.PATH ?? "").split(path.delimiter);
  return folders.some((folder) => fs.existsSync(path.join(folder, program)));
}

/** The terminal from the setting, else the first one installed. */
export function pickTerminal(): string | undefined {
  if (config.terminal) return config.terminal;
  return Object.keys(TERMINALS).find(isOnPath);
}

/** Inside a Vim single-quoted string only the quote itself needs doubling. */
function vimString(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/** The diffview command for the whole PR, or for one file of it. */
export function diffviewCommand(mergeBase: string, file?: string): string {
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error("Unexpected merge base");
  if (!file) return `DiffviewOpen ${mergeBase}`;
  return `execute 'DiffviewOpen ${mergeBase} -- ' . fnameescape(${vimString(file)})`;
}

function isInsideCheckout(worktree: string, file: string | undefined): boolean {
  if (!file) return true;
  const fullPath = path.resolve(worktree, file);
  return fullPath.startsWith(`${path.resolve(worktree)}${path.sep}`);
}

/** Opens the PR's diff in Neovim, in a new terminal window on this machine. */
export async function openInEditor(pr: PullRequest, file?: string): Promise<void> {
  const terminal = pickTerminal();
  if (!terminal || !TERMINALS[terminal]) throw new Error("No terminal found. Opening Neovim only works when the app runs on your own machine, not in Docker.");
  const { worktree, mergeBase } = await ensureCheckout(pr);
  if (!isInsideCheckout(worktree, file)) throw new Error("That file is outside this PR's checkout");
  // - A login shell finds nvim wherever it is installed.
  const command = ["bash", "-lc", 'exec nvim -c "$1"', "nvim", diffviewCommand(mergeBase, file)];
  spawn(terminal, TERMINALS[terminal](worktree, command), { detached: true, stdio: "ignore" }).unref();
}
