import { z } from "zod";

const side = z.enum(["RIGHT", "LEFT"]).describe("RIGHT = new file line numbers, LEFT = deleted lines in the old file");

const proof = z.object({
  status: z.enum(["proven", "guess"]).describe("proven only if you read the code at file:line and it shows the claim"),
  file: z.string(),
  line: z.number().int(),
  side,
  note: z.string().describe("Empty unless the check downgraded this claim"),
});

const glossaryEntry = z.object({ term: z.string(), meaning: z.string().describe("Max 12 words. Plain words.") });

const MERMAID_RULES = "Mermaid source, 'flowchart LR' or 'flowchart TD'. Max 8 nodes. Node labels max 4 plain words, in double quotes. "
  + "Tag nodes this PR adds with :::added and nodes it changes with :::changed. No styling, no classDef, no click lines. Empty string if a picture would not help.";

const flowStep = z.object({
  actor: z.string().describe("Who does this step: a part of the system, max 3 words, e.g. 'Bridge handler'. Reuse the exact same name for every step that part does. Max 5 different actors."),
  label: z.string().describe("Max 5 words, e.g. 'Settings page draws checkbox'"),
  layer: z.enum(["screen", "logic", "api", "data", "device", "external", "test"]).describe("screen = UI; logic = app code; api = HTTP/GraphQL boundary; data = database or storage; device = hardware or local service; external = third party"),
  file: z.string(),
  line: z.number().int(),
  explanation: z.string().describe("Max 15 words: what happens here"),
  sends: z.string().describe("What this step hands to the next step, max 5 words, e.g. 'job ID', '200 header'. Empty if it hands nothing on, and for the last step."),
});

const hardIdea = z.object({
  conceptKey: z.string().describe("kebab-case id, e.g. go-defer, dart-import-prefix"),
  title: z.string().describe("Plain name, max 6 words"),
  oneLiner: z.string().describe("The whole idea in one plain sentence, max 20 words, no jargon"),
  analogy: z.string().describe("One everyday image, one sentence, max 15 words"),
  diagram: z.string().describe(MERMAID_RULES),
  jsExample: z.string().describe("A JS/Node one-liner that does the same thing, or empty"),
  term: z.string().describe("The technical name, e.g. 'import prefix'"),
  file: z.string().describe("Where it shows up in this PR"),
  line: z.number().int(),
});

const teachingNote = z.object({
  line: z.number().int().describe("The line that shows the idea, e.g. the `return false`, not the start of its function"),
  endLine: z.number().int().describe("Last line the note is about. Same as line unless the idea truly spans lines; max 5 lines."),
  side,
  kind: z.enum(["syntax", "pattern", "design"]),
  conceptKey: z.string().describe("kebab-case id, e.g. go-defer, sql-transaction"),
  title: z.string().describe(
    "A plain sentence with a subject and a verb that names the real thing in this code, max 10 words. "
    + "Good: 'onKey returns false so the key still reaches the widget'. Bad: 'Wrap, then always forward', 'false means not handled'.",
  ),
  oneLiner: z.string().describe(
    "What this code does and why, max 25 words, readable without seeing the code. Name the actual function or variable. "
    + "No unexplained shorthand ('marking', 'the slot', 'the old one'): say which thing. Shown first; the explanation is behind a click.",
  ),
  explanation: z.string().describe("Assume I know nothing. Max 4 short lines or bullets. Name the technical term at the end."),
  jsExample: z.string().describe("JS/Node equivalent, or empty if none"),
});

const coachingQuestion = z.object({
  id: z.string().describe("Unique within this walkthrough, e.g. q1"),
  line: z.number().int(),
  endLine: z.number().int().describe("Last line the question is about. Same as line for one line."),
  side,
  question: z.string().describe("Max 25 words. Starts with 'Did you notice' or asks what I would do. Never states the answer."),
  because: z.string().describe("The answer in max 2 short sentences: what goes wrong and for whom, consequence first"),
  example: z.string().describe("A concrete example in max 3 lines: inputs and what happens, or a short code snippet"),
  severity: z.enum(["problem", "worth-knowing"]),
  source: z.enum(["logic", "style-guide", "readability"]),
  suggestedComment: z.string().describe("GitHub review comment text if I confirm it. Bullets, plain words, no em dashes."),
  proof,
});

const tourStop = z.object({
  file: z.string(),
  whyItMatters: z.string().describe("One plain sentence, max 20 words: this file's role in the change"),
  notes: z.array(teachingNote),
  questions: z.array(coachingQuestion),
});

const story = z.object({
  tldr: z.string().describe("The whole PR in one plain sentence, max 20 words"),
  before: z.string().describe("What a person saw or what happened before this PR. Max 2 short sentences."),
  after: z.string().describe("What a person sees or what happens after this PR. Max 2 short sentences."),
  whatItDoes: z.string().describe("What the PR is trying to do, in plain words, 2-4 short sentences"),
  whyNeeded: z.string().describe("The problem it solves and who feels it, max 2 sentences"),
  glossary: z.array(glossaryEntry).describe("Domain nouns used below, defined first. Max 8."),
});

const pictureNode = z.object({
  id: z.string().describe("The Mermaid node id, exactly as written in the diagram source"),
  file: z.string().describe("Repo path of the code this box stands for, at the PR head. Empty if the box is not code in this repo."),
  startLine: z.number().int().describe("First line of that function or block, new-file line numbers. 0 if file is empty."),
  endLine: z.number().int().describe("Last line of that function or block. Cover the whole function, max 120 lines."),
});

const picture = z.object({
  caption: z.string().describe("Max 12 words: what the picture shows"),
  diagram: z.string().describe(MERMAID_RULES),
  nodes: z.array(pictureNode).describe("Where each box lives in the code: one entry per node in the diagram"),
});

export const pictureMapSchema = z.object({ nodes: z.array(pictureNode).describe("One entry per node in the diagram") });

export const walkthroughSchema = z.object({
  story,
  picture: picture.describe("The big picture: the parts this PR touches and how they connect"),
  hardIdeas: z.array(hardIdea).describe("The 1-4 ideas in this PR hardest for the reader to grasp, explained simply. Skip ones listed as already known."),
  flow: z.array(flowStep).describe("Call chain in run order, entry point first. Max 8 steps."),
  tour: z.array(tourStop).describe("Non-skim files, in the order the code runs"),
});

export const walkthroughUpdateSchema = z.object({
  sinceLastTime: z.string().describe("What the new commits changed, in max 2 short plain sentences"),
  stops: z.array(tourStop).describe("Exactly one stop per file under 'Files to redo', in the order the code runs"),
  story: story.nullable().describe("A corrected story only if the old one is now wrong; otherwise null"),
  picture: picture.nullable().describe("A corrected picture only if the parts or links changed; otherwise null"),
  flow: z.array(flowStep).nullable().describe("A corrected flow only if the steps changed; otherwise null"),
  newHardIdeas: z.array(hardIdea).describe("Hard ideas the new code adds. Usually empty."),
});

export type Walkthrough = z.infer<typeof walkthroughSchema>;
export type WalkthroughUpdate = z.infer<typeof walkthroughUpdateSchema>;
export type TourStop = z.infer<typeof tourStop>;
export type HardIdea = z.infer<typeof hardIdea>;
export type Proof = z.infer<typeof proof>;
export type PictureNode = z.infer<typeof pictureNode>;

const guideFile = z.object({
  file: z.string(),
  whatChanged: z.string().describe("Max 10 words: what changed in this file"),
});

const guideChapter = z.object({
  title: z.string().describe("Max 6 plain words, e.g. Checkout reprices on a 409"),
  oneLiner: z.string().describe("Max 12 words: what this step does, the one thing to keep in mind"),
  role: z.enum(["core", "follow-on", "supporting"]).describe("core = the heart of the change; follow-on = what it forces elsewhere; supporting = glue, types, tests, config"),
  summary: z.string().describe("1-2 short sentences, max 35 words: what this chapter changes and why"),
  files: z.array(guideFile),
});

export const guideSchema = z.object({
  overview: z.string().describe("Max 20 words: the path through the steps"),
  chapters: z.array(guideChapter).describe("Core first, then follow-on, then supporting. Every changed file appears in exactly one chapter."),
});

export type Guide = z.infer<typeof guideSchema>;

const threadVerdict = z.object({
  threadId: z.string(),
  meaning: z.string().describe("What the reviewer is saying, one plain sentence, max 20 words"),
  verdict: z.enum(["valid", "noise", "unsure"]),
  why: z.string().describe("Why it is valid or noise, max 2 short sentences, consequence first"),
  example: z.string().describe("A concrete example of the problem, or of why it cannot happen, max 3 lines"),
  draftReply: z.string().describe("For noise or unsure: reply text in bullets, plain words, no em dashes. Empty for valid."),
  proposedFix: z.string().describe("For valid: a unified diff against the current files. Empty otherwise."),
  proof,
});

export const triageSchema = z.object({ threads: z.array(threadVerdict) });

export type Triage = z.infer<typeof triageSchema>;

/** Claude's schema check rejects the "$schema" key zod adds. */
function toClaudeJsonSchema(schema: z.ZodType): object {
  const { $schema: _unused, ...jsonSchema } = z.toJSONSchema(schema);
  return jsonSchema;
}

export const walkthroughJsonSchema = toClaudeJsonSchema(walkthroughSchema);
export const walkthroughUpdateJsonSchema = toClaudeJsonSchema(walkthroughUpdateSchema);
export const triageJsonSchema = toClaudeJsonSchema(triageSchema);
export const guideJsonSchema = toClaudeJsonSchema(guideSchema);
export const pictureMapJsonSchema = toClaudeJsonSchema(pictureMapSchema);
