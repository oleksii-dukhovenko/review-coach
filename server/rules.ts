import fs from "node:fs";
import path from "node:path";

import { config } from "./config.ts";
import { fetchRepoFile } from "./github.ts";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const SHARED_GUIDES = [
  { fileName: "universal-STYLEGUIDE.md", repoPath: "docs/universal/STYLEGUIDE.md" },
  { fileName: "universal-agents-STYLEGUIDE.md", repoPath: "docs/universal/agents/STYLEGUIDE.md" },
];

const PERSONAL_SECTIONS = [
  { file: config.personalRulesFile, heading: "# Every function must be easy to read" },
  { file: config.personalRulesFile, heading: "# Code comments" },
  { file: config.globalRulesFile, heading: "# Round2POS style guides" },
];

/** Returns one "# Heading" section of a markdown file. */
export function extractSection(markdown: string, headingPrefix: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (start === -1) return "";
  const nextHeading = lines.findIndex((line, index) => index > start && line.startsWith("# "));
  return lines.slice(start, nextHeading === -1 ? undefined : nextHeading).join("\n").trim();
}

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function isFresh(filePath: string): boolean {
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs < ONE_DAY_MS;
  } catch {
    return false;
  }
}

async function refreshSharedGuide(guide: (typeof SHARED_GUIDES)[number]): Promise<string | undefined> {
  const target = path.join(config.rulesDir, guide.fileName);
  if (!isFresh(target)) {
    try {
      fs.writeFileSync(target, await fetchRepoFile("Round2POS", "r2pos-common-skills", guide.repoPath));
    } catch {
      // - Offline: keep the last copy if any.
    }
  }
  return fs.existsSync(target) ? target : undefined;
}

function writePersonalRules(): string {
  const target = path.join(config.rulesDir, "personal-readability-rules.md");
  const sections = PERSONAL_SECTIONS.map((section) => extractSection(readFileOrEmpty(section.file), section.heading));
  fs.writeFileSync(target, sections.filter(Boolean).join("\n\n"));
  return target;
}

/** Style guide files Claude should read, the repo's own guide first. */
export async function collectRuleFiles(worktree: string): Promise<string[]> {
  fs.mkdirSync(config.rulesDir, { recursive: true });
  const repoGuide = path.join(worktree, "docs", "STYLEGUIDE.md");
  const sharedGuides = await Promise.all(SHARED_GUIDES.map(refreshSharedGuide));
  const ruleFiles = [fs.existsSync(repoGuide) ? repoGuide : undefined, ...sharedGuides, writePersonalRules()];
  return ruleFiles.filter((file): file is string => file !== undefined);
}

export function teachingRules(): string {
  const personalRules = readFileOrEmpty(config.personalRulesFile);
  const globalRules = readFileOrEmpty(config.globalRulesFile);
  return [
    extractSection(personalRules, "# Teaching me something"),
    extractSection(personalRules, "# Never state an inference as fact"),
    extractSection(globalRules, "# No mannered prose"),
  ].filter(Boolean).join("\n\n");
}

export function publicWritingRules(): string {
  return extractSection(readFileOrEmpty(config.personalRulesFile), "# What gets posted publicly");
}
