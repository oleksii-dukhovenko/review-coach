import fs from "node:fs";
import path from "node:path";

import { askClaudeWithRetry } from "./anatomy.ts";
import { config } from "./config.ts";
import { deleteSetting, getJob, getSetting, prTrainSettingKey, saveSetting, trainSettingKey } from "./db.ts";
import { trainAnatomyPrompt, type TrainMemberNote } from "./prompts.ts";
import { checkedTrainScene, type TrainSceneData } from "./sceneCheck.ts";
import { trainSceneJsonSchema, trainSceneSchema, type Train, type TrainView } from "./sceneSchema.ts";
import { prKeyOf, type PullRequest } from "./types.ts";
import type { BuiltJob, WalkthroughData } from "./walkthrough.ts";

export type { TrainSceneData };

/** Remembers which train a PR is in, and that train's members. */
export function rememberTrain(prKey: string, train: Train): void {
  saveSetting(prTrainSettingKey(prKey), train.key);
  saveSetting(trainSettingKey(train.key), JSON.stringify(train));
}

export function forgetTrain(prKey: string): void {
  deleteSetting(prTrainSettingKey(prKey));
}

export function savedTrain(trainKey: string): Train | undefined {
  const saved = getSetting(trainSettingKey(trainKey));
  return saved ? (JSON.parse(saved) as Train) : undefined;
}

/** The train this PR is in, for the PR page; null when it is in none. */
export function trainViewFor(pr: PullRequest): TrainView | null {
  const trainKey = getSetting(prTrainSettingKey(pr.key));
  const train = trainKey ? savedTrain(trainKey) : undefined;
  if (!train) return null;
  const job = getJob(train.key, "train");
  const scene = (job?.data as TrainSceneData | null | undefined)?.scene ?? null;
  return { train, currentNumber: pr.number, scene, status: job?.status ?? "none" };
}

function walkthroughTldr(prKey: string): string | null {
  const data = getJob(prKey, "walkthrough")?.data as WalkthroughData | null | undefined;
  return data?.walkthrough.story.tldr || null;
}

/** What the train prompt says about each PR, with its summary when one exists. */
function memberNotes(train: Train): TrainMemberNote[] {
  return train.members.map((member) => ({
    number: member.number,
    title: member.title,
    state: member.state,
    tldr: walkthroughTldr(prKeyOf(train.owner, train.repo, member.number)),
  }));
}

/** An empty folder to run in: the train picture reads no code. */
function emptyWorkFolder(): string {
  const folder = path.join(config.dataDir, "train-scenes");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

/** One machine for a whole train, each part a group of its PRs. */
export async function buildTrainScene(train: Train): Promise<BuiltJob<TrainSceneData>> {
  const built = await askClaudeWithRetry({
    cwd: emptyWorkFolder(),
    prompt: trainAnatomyPrompt(train, memberNotes(train)),
    jsonSchema: trainSceneJsonSchema,
    parse: (raw) => trainSceneSchema.parse(raw),
    addDirs: [],
  });
  return { data: { scene: checkedTrainScene(built.data, train) }, sessionId: built.sessionId };
}
