import { randomUUID } from "node:crypto";

import { ensureCheckout } from "./checkout.ts";
import { runClaudeJson, UsageLimitError } from "./claude.ts";
import { lineCountOf } from "./pictureMap.ts";
import { anatomyPrompt } from "./prompts.ts";
import { anatomyJsonSchema, anatomySchema } from "./sceneSchema.ts";
import { checkedScene, storyFingerprint, type AnatomyData } from "./sceneCheck.ts";
import type { PullRequest } from "./types.ts";
import type { BuiltJob, WalkthroughData } from "./walkthrough.ts";

export type { AnatomyData };

type ClaudeCall<T> = { cwd: string; prompt: string; jsonSchema: object; parse: (raw: unknown) => T; addDirs: string[] };

/** Asks Claude, retrying once if the answer has the wrong shape. */
export async function askClaudeWithRetry<T>(call: ClaudeCall<T>): Promise<BuiltJob<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sessionId = randomUUID();
    try {
      const raw = await runClaudeJson({ ...call, sessionId });
      return { data: call.parse(raw), sessionId };
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

type SceneInput = { pr: PullRequest; worktree: string; walkthroughData: WalkthroughData };

/** Asks Claude for a scene in a checkout and keeps only what holds up. */
export async function composeScene(input: SceneInput): Promise<BuiltJob<AnatomyData>> {
  const { walkthrough, files } = input.walkthroughData;
  const built = await askClaudeWithRetry({
    cwd: input.worktree,
    prompt: anatomyPrompt({ pr: input.pr, files, walkthrough }),
    jsonSchema: anatomyJsonSchema,
    parse: (raw) => anatomySchema.parse(raw),
    addDirs: [],
  });
  const askedScene = built.data.scene;
  const scene = askedScene ? checkedScene(askedScene, (file) => lineCountOf(input.worktree, file)) : null;
  return { data: { scene, basedOn: storyFingerprint(walkthrough) }, sessionId: built.sessionId };
}

/** The playing picture for one PR, made from its walkthrough. */
export async function buildAnatomy(pr: PullRequest, walkthroughData: WalkthroughData): Promise<BuiltJob<AnatomyData>> {
  const checkout = await ensureCheckout(pr);
  return composeScene({ pr, worktree: checkout.worktree, walkthroughData });
}
