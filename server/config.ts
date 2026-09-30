import os from "node:os";
import path from "node:path";

const home = os.homedir();
const dataDir = path.join(home, ".cache", "review-coach");

export const config = {
  port: Number(process.env.REVIEW_COACH_PORT ?? 4477),
  pollMinutes: 5,
  // - Unset uses the Claude Code default model.
  model: process.env.REVIEW_COACH_MODEL,
  dataDir,
  dbFile: path.join(dataDir, "review-coach.db"),
  mirrorsDir: path.join(dataDir, "mirrors"),
  worktreesDir: path.join(dataDir, "worktrees"),
  rulesDir: path.join(dataDir, "rules"),
  projectsDir: path.join(home, "ROUND_2_PROJECTS"),
  conceptsDir: path.join(home, "Documents", "Obsidean", "Round 2 POS", "Code Reviews", "Concepts"),
  personalRulesFile: path.join(home, "AGENTS.md"),
  globalRulesFile: path.join(home, ".claude", "CLAUDE.md"),
  webDistDir: path.join(import.meta.dirname, "..", "web", "dist"),
};
