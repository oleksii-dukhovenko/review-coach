import { useState } from "react";

import type { Concept, DiffFile, HardIdea, PrRoute, RemovedSymbol, Walkthrough, WalkthroughChange } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { FlowDiagram } from "../components/FlowDiagram.tsx";
import { Icon } from "../components/Icon.tsx";
import { Mermaid } from "../components/Mermaid.tsx";

type Story = Walkthrough["story"];

type FlowStep = Walkthrough["flow"][number];

type OpenLine = (file: string, line: number, side: "LEFT" | "RIGHT") => void;

/** Walkthroughs built before tldr existed lead with their first sentence. */
function tldrOf(story: Story): string {
  return story.tldr || story.whatItDoes.split(/(?<=\.)\s/)[0];
}

function GlossaryTerm({ entry }: { entry: Story["glossary"][number] }) {
  return (
    <span className="term" tabIndex={0}>
      {entry.term}
      <span className="term-pop" role="tooltip">{entry.meaning}</span>
    </span>
  );
}

function BeforeAfter({ story }: { story: Story }) {
  if (!story.before || !story.after) return null;
  return (
    <div className="before-after">
      <div className="ba-card before"><div className="ba-label">Before</div><Markdown text={story.before} /></div>
      <div className="ba-arrow"><Icon name="arrowRight" size={22} /></div>
      <div className="ba-card after"><div className="ba-label">After</div><Markdown text={story.after} /></div>
    </div>
  );
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function whenText(isoTime: string): string {
  return new Date(isoTime).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** What the last update changed, so you know where to look again. */
export function ChangesBanner({ change, onOpenFile }: { change: WalkthroughChange | undefined; onOpenFile: (file: string) => void }) {
  if (!change) return null;
  return (
    <section className="changes-banner">
      <div className="eyebrow"><Icon name="sparkles" /> Since you last looked · {whenText(change.at)}</div>
      <p>{change.summary}</p>
      {change.files.length > 0 ? (
        <div className="changes-files">
          <span className="small muted">Look again at:</span>
          {change.files.map((file) => (
            <button key={file} className="term" onClick={() => onOpenFile(file)} title={file}>{file.split("/").at(-1)}</button>
          ))}
        </div>
      ) : null}
      <div className="small muted">
        Commits <span className="mono">{shortSha(change.fromSha)}</span> → <span className="mono">{shortSha(change.toSha)}</span>.
        Everything else, and your answers and checkmarks, were kept.
      </div>
    </section>
  );
}

export function AtAGlance({ story }: { story: Story }) {
  return (
    <section id="glance" className="glance">
      <div className="eyebrow"><Icon name="eye" /> At a glance</div>
      <p className="tldr">{tldrOf(story)}</p>
      <BeforeAfter story={story} />
      {story.glossary.length > 0 ? (
        <div className="glossary-row">
          <span className="small muted">Words you'll see (hover):</span>
          {story.glossary.map((entry) => <GlossaryTerm key={entry.term} entry={entry} />)}
        </div>
      ) : null}
      <details className="more">
        <summary>The full story</summary>
        <h3>What it does</h3>
        <Markdown text={story.whatItDoes} />
        <h3>Why it's needed</h3>
        <Markdown text={story.whyNeeded} />
      </details>
    </section>
  );
}

function DiagramLegend() {
  return (
    <div className="legend small muted">
      <span><span className="legend-swatch added" /> added by this PR</span>
      <span><span className="legend-swatch changed" /> changed by this PR</span>
    </div>
  );
}

export function PictureSection({ picture }: { picture: Walkthrough["picture"] | undefined }) {
  if (!picture?.diagram.trim()) return null;
  return (
    <section id="picture">
      <h2><Icon name="map" /> The big picture</h2>
      <div className="card picture-card">
        <div className="small muted">{picture.caption}</div>
        <Mermaid source={picture.diagram} />
        <DiagramLegend />
      </div>
    </section>
  );
}

type HardIdeaProps = {
  idea: HardIdea;
  concept: Concept | undefined;
  onSave: (status: Concept["status"]) => void;
  onOpenLine: OpenLine;
};

function HardIdeaCard({ idea, concept, onSave, onOpenLine }: HardIdeaProps) {
  const isLearned = concept?.status === "learned";
  return (
    <div className={`idea ${isLearned ? "is-learned" : ""}`}>
      <div className="idea-title"><Icon name="bulb" /> {idea.title}</div>
      <p className="idea-one-liner">{idea.oneLiner}</p>
      {idea.analogy ? <p className="idea-analogy"><span>Like:</span> {idea.analogy}</p> : null}
      <Mermaid source={idea.diagram} className="small-diagram" />
      {idea.jsExample ? <pre className="code-block"><span className="code-label">In JS</span>{idea.jsExample}</pre> : null}
      <div className="idea-footer">
        <span className="small muted">Term: <strong>{idea.term}</strong></span>
        <button className="link-button" onClick={() => onOpenLine(idea.file, idea.line, "RIGHT")}>See it in the code <Icon name="arrowRight" size={13} /></button>
      </div>
      <div className="button-row">
        {isLearned ? <span className="chip ready"><Icon name="check" size={12} /> You know this</span> : <button onClick={() => onSave("learned")}>Got it</button>}
        {concept?.status !== "fuzzy" ? <button onClick={() => onSave("fuzzy")}>Still fuzzy</button> : <span className="chip unsure">Still fuzzy</span>}
      </div>
    </div>
  );
}

export function HardIdeasSection({ ideas, conceptsByKey, onSave, onOpenLine }: {
  ideas: HardIdea[] | undefined;
  conceptsByKey: Map<string, Concept>;
  onSave: (idea: HardIdea, status: Concept["status"]) => void;
  onOpenLine: OpenLine;
}) {
  if (!ideas?.length) return null;
  return (
    <section id="ideas">
      <h2><Icon name="sparkles" /> Hard ideas, simply</h2>
      <div className="idea-grid">
        {ideas.map((idea) => (
          <HardIdeaCard key={idea.conceptKey} idea={idea} concept={conceptsByKey.get(idea.conceptKey)}
            onSave={(status) => onSave(idea, status)} onOpenLine={onOpenLine} />
        ))}
      </div>
    </section>
  );
}

export function FlowSection({ route, flow, files, onOpenLine }: { route: PrRoute; flow: FlowStep[]; files: DiffFile[]; onOpenLine: OpenLine }) {
  const [isOpen, setIsOpen] = useState(true);
  if (flow.length === 0) return null;
  return (
    <section id="flow">
      <h2>
        <Icon name="flow" /> How it runs
        <button className="link-button small" onClick={() => setIsOpen(!isOpen)}>{isOpen ? "Hide" : "Show"}</button>
      </h2>
      {isOpen ? (
        <>
          <p className="small muted">Each column is a part of the system. Follow the arrows, or press Next (or ←/→) to walk through it with the code.</p>
          <FlowDiagram route={route} flow={flow} files={files} onOpenLine={onOpenLine} />
        </>
      ) : null}
    </section>
  );
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** Walkthroughs built before counts existed only have the lists. */
function withCounts(symbol: RemovedSymbol): RemovedSymbol {
  return { ...symbol, usedBeforeCount: symbol.usedBeforeCount ?? symbol.usedBefore.length, usedAfterCount: symbol.usedAfterCount ?? symbol.usedAfter.length };
}

function usageSummary(symbol: RemovedSymbol): string {
  if (symbol.usedBeforeCount === 0) return "Nothing else mentioned it before this PR.";
  const before = `Mentioned in ${plural(symbol.usedBeforeCount, "place")} before this PR.`;
  const after = symbol.usedAfterCount > 0 ? `${plural(symbol.usedAfterCount, "mention")} remain after it.` : "No mentions remain after it.";
  return `${before} ${after}`;
}

function RemovedSymbolCard({ symbol }: { symbol: RemovedSymbol }) {
  return (
    <div className="card">
      <strong className="mono">{symbol.name}</strong> <span className="small muted">from {symbol.file}</span>
      <div>{usageSummary(symbol)}</div>
      {symbol.usedAfterCount > 0 ? <div className="chip failed">Still mentioned after removal: check these</div> : null}
      <details>
        <summary className="small">Where it was mentioned, and recent history</summary>
        <div className="small mono">
          {symbol.usedBefore.map((use) => <div key={`b${use.file}${use.line}`}>before: {use.file}:{use.line}  {use.text}</div>)}
          {symbol.usedAfter.map((use) => <div key={`a${use.file}${use.line}`}>after: {use.file}:{use.line}  {use.text}</div>)}
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          {symbol.recentCommits.map((commit) => (
            <div key={commit.sha}><span className="mono">{commit.sha}</span> {commit.date} {commit.author}: {commit.subject}</div>
          ))}
        </div>
      </details>
    </div>
  );
}

export function RemovedCodeSection({ removed }: { removed: RemovedSymbol[] }) {
  if (removed.length === 0) return null;
  return (
    <section id="removed">
      <h2><Icon name="trash" /> What got removed</h2>
      <p className="small muted">Checked with git, not AI. "Before" means the base branch where this PR starts.</p>
      {removed.map((symbol) => <RemovedSymbolCard key={`${symbol.file}:${symbol.name}`} symbol={withCounts(symbol)} />)}
    </section>
  );
}

export function skimFiles(files: DiffFile[]): DiffFile[] {
  return files.filter((file) => file.tag === "skim");
}
