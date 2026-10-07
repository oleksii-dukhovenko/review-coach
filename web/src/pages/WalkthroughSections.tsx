import { useState } from "react";

import type { DiffFile, PrRoute, RemovedSymbol, Walkthrough, WalkthroughChange } from "../api.ts";
import { Markdown } from "../components/basics.tsx";
import { FlowDiagram } from "../components/FlowDiagram.tsx";
import { Icon } from "../components/Icon.tsx";

type Story = Walkthrough["story"];

type FlowStep = Walkthrough["flow"][number];

type OpenLine = (file: string, line: number, side: "LEFT" | "RIGHT") => void;

export function GlossaryTerm({ entry }: { entry: Story["glossary"][number] }) {
  return (
    <span className="term" tabIndex={0}>
      {entry.term}
      <span className="term-pop" role="tooltip">{entry.meaning}</span>
    </span>
  );
}

export function BeforeAfter({ story }: { story: Story }) {
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
