import fs from "node:fs";
import path from "node:path";

import { config } from "./config.ts";

export type ConceptStatus = "learned" | "fuzzy";

export type Concept = {
  conceptKey: string;
  title: string;
  status: ConceptStatus;
  explanation: string;
  jsExample: string;
  seenIn: string[];
};

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;

/** Obsidian breaks on slashes and other path characters. */
export function noteFileName(title: string): string {
  return `${title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim()}.md`;
}

function readFrontmatterField(frontmatter: string, field: string): string {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*(.*)$`, "m"));
  return match ? match[1].trim().replace(/^"|"$/g, "") : "";
}

function readSeenIn(body: string): string[] {
  const seenSection = body.split("## Seen in")[1] ?? "";
  return seenSection.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim());
}

function readSection(body: string, heading: string): string {
  const afterHeading = body.split(`## ${heading}\n`)[1] ?? "";
  return afterHeading.split("\n## ")[0].trim();
}

function parseConceptNote(markdown: string): Concept | undefined {
  const frontmatter = markdown.match(FRONTMATTER)?.[1];
  if (!frontmatter) return undefined;
  const body = markdown.replace(FRONTMATTER, "");
  const conceptKey = readFrontmatterField(frontmatter, "concept");
  if (!conceptKey) return undefined;
  return {
    conceptKey,
    title: readFrontmatterField(frontmatter, "title"),
    status: readFrontmatterField(frontmatter, "status") === "fuzzy" ? "fuzzy" : "learned",
    explanation: readSection(body, "What it is"),
    jsExample: readSection(body, "JS equivalent").replace(/^```\w*\n|\n```$/g, ""),
    seenIn: readSeenIn(body),
  };
}

function conceptNoteFiles(): string[] {
  try {
    return fs.readdirSync(config.conceptsDir).filter((name) => name.endsWith(".md"));
  } catch {
    return [];
  }
}

export function listConcepts(): Concept[] {
  const notes = conceptNoteFiles().map((name) => fs.readFileSync(path.join(config.conceptsDir, name), "utf8"));
  return notes.map(parseConceptNote).filter((concept): concept is Concept => concept !== undefined);
}

function renderConceptNote(concept: Concept): string {
  const jsBlock = concept.jsExample ? `\n## JS equivalent\n\n\`\`\`js\n${concept.jsExample}\n\`\`\`\n` : "";
  return [
    "---",
    `concept: ${concept.conceptKey}`,
    `title: "${concept.title.replace(/"/g, "'")}"`,
    `status: ${concept.status}`,
    "tags: [code-review-concept]",
    "---",
    `# ${concept.title}`,
    "",
    "## What it is",
    "",
    concept.explanation,
    jsBlock,
    "## Seen in",
    "",
    ...concept.seenIn.map((prKey) => `- ${prKey}`),
    "",
  ].join("\n");
}

function mergeWithExisting(incoming: Concept): Concept {
  const existing = listConcepts().find((concept) => concept.conceptKey === incoming.conceptKey);
  if (!existing) return incoming;
  const seenIn = [...new Set([...existing.seenIn, ...incoming.seenIn])];
  return { ...existing, status: incoming.status, seenIn };
}

export function saveConcept(incoming: Concept): Concept {
  fs.mkdirSync(config.conceptsDir, { recursive: true });
  const concept = mergeWithExisting(incoming);
  fs.writeFileSync(path.join(config.conceptsDir, noteFileName(concept.title)), renderConceptNote(concept));
  return concept;
}

export function conceptsForPrompt(): string {
  const concepts = listConcepts();
  const keysWithStatus = (status: ConceptStatus) =>
    concepts.filter((concept) => concept.status === status).map((concept) => concept.conceptKey).join(", ") || "none yet";
  return [
    `Concepts I have learned (one-line reminder only, no full explanation): ${keysWithStatus("learned")}`,
    `Concepts I am still fuzzy on (explain these in more depth, with an example): ${keysWithStatus("fuzzy")}`,
  ].join("\n");
}
