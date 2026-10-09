import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const dataDir = process.env.REVIEW_COACH_DATA_DIR ?? path.join(home, ".cache", "review-coach");
const obsidianConceptsDir = path.join(home, "Documents", "Obsidean", "Round 2 POS", "Code Reviews", "Concepts");

/** The Obsidian folder when it exists, else a folder next to the data. */
function defaultConceptsDir(): string {
  return fs.existsSync(obsidianConceptsDir) ? obsidianConceptsDir : path.join(dataDir, "concepts");
}

export const config = {
  port: Number(process.env.REVIEW_COACH_PORT ?? 4477),
  // - 0.0.0.0 inside Docker; the host port mapping keeps it local.
  host: process.env.REVIEW_COACH_HOST ?? "127.0.0.1",
  pollMinutes: 5,
  // - Only these "owner/repo" names, comma-separated; empty means every repo.
  onlyRepos: (process.env.REVIEW_COACH_REPOS ?? "").split(",").map((repo) => repo.trim()).filter(Boolean),
  // - Unset uses the Claude Code default model.
  model: process.env.REVIEW_COACH_MODEL,
  // - Terminal for "Open in Neovim", e.g. ptyxis or kitty; unset picks one.
  terminal: process.env.REVIEW_COACH_TERMINAL,
  // - "link" hands the browser a review-coach:// link instead; Docker sets it.
  neovimMode: process.env.REVIEW_COACH_NEOVIM,
  dataDir,
  dbFile: path.join(dataDir, "review-coach.db"),
  mirrorsDir: path.join(dataDir, "mirrors"),
  worktreesDir: path.join(dataDir, "worktrees"),
  rulesDir: path.join(dataDir, "rules"),
  // - Local clones to borrow git objects from, so first checkouts are fast.
  projectsDir: process.env.REVIEW_COACH_PROJECTS_DIR ?? path.join(home, "ROUND_2_PROJECTS"),
  conceptsDir: process.env.REVIEW_COACH_CONCEPTS_DIR ?? defaultConceptsDir(),
  // - Who the coach is talking to; see README "Make it yours".
  profileFile: process.env.REVIEW_COACH_PROFILE ?? path.join(home, ".config", "review-coach", "profile.md"),
  personalRulesFile: process.env.REVIEW_COACH_RULES_FILE ?? path.join(home, "AGENTS.md"),
  globalRulesFile: process.env.REVIEW_COACH_GLOBAL_RULES_FILE ?? path.join(home, ".claude", "CLAUDE.md"),
  flutterRoot: process.env.FLUTTER_ROOT ?? path.join(home, "flutter"),
  pubCacheDir: process.env.PUB_CACHE ?? path.join(home, ".pub-cache"),
  webDistDir: path.join(import.meta.dirname, "..", "web", "dist"),
};
