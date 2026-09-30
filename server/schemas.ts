import { z } from "zod";

const side = z.enum(["RIGHT", "LEFT"]).describe("RIGHT = new file line numbers, LEFT = deleted lines in the old file");

const proof = z.object({
  status: z.enum(["proven", "guess"]).describe("proven only if you read the code at file:line and it shows the claim"),
  file: z.string(),
  line: z.number().int(),
  side,
  note: z.string().describe("Empty unless the check downgraded this claim"),
});

const glossaryEntry = z.object({ term: z.string(), meaning: z.string().describe("One plain sentence") });

const flowStep = z.object({
  label: z.string().describe("Function or step name, e.g. PlaceOrder handler"),
  file: z.string(),
  line: z.number().int(),
  explanation: z.string().describe("One plain sentence: what happens here"),
});

const teachingNote = z.object({
  line: z.number().int(),
  endLine: z.number().int().describe("Last line the note is about. Same as line for one line."),
  side,
  kind: z.enum(["syntax", "pattern", "design"]),
  conceptKey: z.string().describe("kebab-case id, e.g. go-defer, sql-transaction"),
  title: z.string().describe("Plain name, e.g. defer runs when the function ends"),
  explanation: z.string().describe("Assume I know nothing. One-sentence answer first. Max ~6 short lines. Name the technical term at the end."),
  jsExample: z.string().describe("JS/Node equivalent, or empty if none"),
});

const coachingQuestion = z.object({
  id: z.string().describe("Unique within this walkthrough, e.g. q1"),
  line: z.number().int(),
  endLine: z.number().int().describe("Last line the question is about. Same as line for one line."),
  side,
  question: z.string().describe("Starts with 'Did you notice' or asks what I would do. Never states the answer."),
  because: z.string().describe("The answer: what goes wrong and for whom, consequence first"),
  example: z.string().describe("A concrete example: inputs, what happens, or a short code snippet"),
  severity: z.enum(["problem", "worth-knowing"]),
  source: z.enum(["logic", "style-guide", "readability"]),
  suggestedComment: z.string().describe("GitHub review comment text if I confirm it. Bullets, plain words, no em dashes."),
  proof,
});

const tourStop = z.object({
  file: z.string(),
  whyItMatters: z.string().describe("One or two plain sentences: this file's role in the change"),
  notes: z.array(teachingNote),
  questions: z.array(coachingQuestion),
});

export const walkthroughSchema = z.object({
  story: z.object({
    whatItDoes: z.string().describe("What the PR is trying to do, in plain words, 2-4 sentences"),
    whyNeeded: z.string().describe("The problem it solves and who feels it"),
    glossary: z.array(glossaryEntry).describe("Domain nouns used below, defined first"),
  }),
  flow: z.array(flowStep).describe("Call chain in run order, entry point first"),
  tour: z.array(tourStop).describe("Non-skim files, in the order the code runs"),
});

export type Walkthrough = z.infer<typeof walkthroughSchema>;
export type Proof = z.infer<typeof proof>;

const guideFile = z.object({
  file: z.string(),
  whatChanged: z.string().describe("One plain line: what changed in this file for this chapter"),
});

const guideChapter = z.object({
  title: z.string().describe("Short plain title, e.g. Checkout reprices the cart on a 409"),
  role: z.enum(["core", "follow-on", "supporting"]).describe("core = the heart of the change; follow-on = what it forces elsewhere; supporting = glue, types, tests, config"),
  summary: z.string().describe("2-4 short sentences: what this chapter changes and why, in the order the code runs"),
  files: z.array(guideFile),
});

export const guideSchema = z.object({
  overview: z.string().describe("One or two sentences: the path through the chapters"),
  chapters: z.array(guideChapter).describe("Core first, then follow-on, then supporting. Every changed file appears in exactly one chapter."),
});

export type Guide = z.infer<typeof guideSchema>;

const threadVerdict = z.object({
  threadId: z.string(),
  meaning: z.string().describe("What the reviewer is saying, in plain words"),
  verdict: z.enum(["valid", "noise", "unsure"]),
  why: z.string().describe("Why it is valid or noise, consequence first"),
  example: z.string().describe("A concrete example of the problem, or of why it cannot happen"),
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
export const triageJsonSchema = toClaudeJsonSchema(triageSchema);
export const guideJsonSchema = toClaudeJsonSchema(guideSchema);
