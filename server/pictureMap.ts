import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson } from "./claude.ts";
import { getJob, getPr, saveJobData } from "./db.ts";
import { pictureMapPrompt } from "./prompts.ts";
import { pictureMapJsonSchema, pictureMapSchema, type PictureNode } from "./schemas.ts";
import type { WalkthroughData } from "./walkthrough.ts";

const MAX_NODE_LINES = 160;

const pending = new Map<string, Promise<PictureNode[]>>();

function lineCountOf(worktree: string, file: string): number {
  const fullPath = path.resolve(worktree, file);
  const isInside = fullPath.startsWith(`${path.resolve(worktree)}${path.sep}`);
  if (!isInside || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return 0;
  return fs.readFileSync(fullPath, "utf8").split("\n").length;
}

/** Drops paths that do not exist and keeps line ranges inside the file. */
export function checkedNode(node: PictureNode, lineCount: number): PictureNode {
  if (!node.file || lineCount === 0) return { ...node, file: "", startLine: 0, endLine: 0 };
  const startLine = Math.min(Math.max(1, node.startLine), lineCount);
  const endLine = Math.min(Math.max(startLine, node.endLine), lineCount, startLine + MAX_NODE_LINES - 1);
  return { ...node, startLine, endLine };
}

function walkthroughData(prKey: string): WalkthroughData {
  const data = getJob(prKey, "walkthrough")?.data as WalkthroughData | null | undefined;
  if (!data) throw new Error("No walkthrough for this PR yet");
  return data;
}

async function askWhereNodesLive(prKey: string, data: WalkthroughData): Promise<PictureNode[]> {
  const pr = getPr(prKey);
  if (!pr) throw new Error(`Unknown PR ${prKey}`);
  const { worktree } = await ensureCheckout(pr);
  const { picture } = data.walkthrough;
  const prompt = pictureMapPrompt({ caption: picture.caption, diagram: picture.diagram, files: data.files });
  const raw = await runClaudeJson({ cwd: worktree, prompt, jsonSchema: pictureMapJsonSchema, sessionId: randomUUID(), addDirs: [] });
  return pictureMapSchema.parse(raw).nodes.map((node) => checkedNode(node, lineCountOf(worktree, node.file)));
}

function saveNodes(prKey: string, nodes: PictureNode[]): void {
  const latest = walkthroughData(prKey);
  const picture = { ...latest.walkthrough.picture, nodes };
  saveJobData(prKey, "walkthrough", { ...latest, walkthrough: { ...latest.walkthrough, picture } });
}

async function mapAndSave(prKey: string): Promise<PictureNode[]> {
  const nodes = await askWhereNodesLive(prKey, walkthroughData(prKey));
  saveNodes(prKey, nodes);
  return nodes;
}

/** Where each big-picture box lives in the code; asks Claude once per build. */
export function pictureNodes(prKey: string): Promise<PictureNode[]> {
  const known = walkthroughData(prKey).walkthrough.picture.nodes;
  if (known?.length) return Promise.resolve(known);
  if (!pending.has(prKey)) pending.set(prKey, mapAndSave(prKey).finally(() => pending.delete(prKey)));
  return pending.get(prKey)!;
}
