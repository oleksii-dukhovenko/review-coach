import type { DiffFile, RemovedSymbol, Walkthrough } from "../api.ts";
import { Markdown } from "../components/basics.tsx";


export function StorySection({ story }: { story: Walkthrough["story"] }) {
  return (
    <section>
      <h2>The story</h2>
      <div className="card">
        {story.glossary.length > 0 ? (
          <>
            <h3>Words you'll see</h3>
            <dl className="glossary">
              {story.glossary.map((entry) => (
                <div key={entry.term}><dt>{entry.term}</dt><dd>{entry.meaning}</dd></div>
              ))}
            </dl>
          </>
        ) : null}
        <h3>What it does</h3>
        <Markdown text={story.whatItDoes} />
        <h3 style={{ marginTop: 10 }}>Why it's needed</h3>
        <Markdown text={story.whyNeeded} />
      </div>
    </section>
  );
}

type OpenLine = (file: string, line: number, side: "LEFT" | "RIGHT") => void;

export function FlowSection({ flow, onOpenLine }: { flow: Walkthrough["flow"]; onOpenLine: OpenLine }) {
  if (flow.length === 0) return null;
  return (
    <section>
      <h2>The flow</h2>
      <p className="small muted">The order the code runs. Click a step to jump to it.</p>
      <div className="flow">
        {flow.map((step, stepIndex) => (
          <div key={stepIndex}>
            {stepIndex > 0 ? <div className="flow-arrow">↓</div> : null}
            <button className="flow-step" style={{ width: "100%" }} onClick={() => onOpenLine(step.file, step.line, "RIGHT")}>
              <strong>{step.label}</strong> <span className="mono muted">{step.file}:{step.line}</span>
              <div className="small">{step.explanation}</div>
            </button>
          </div>
        ))}
      </div>
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
    <section>
      <h2>What got removed</h2>
      <p className="small muted">Checked with git, not AI. "Before" means the base branch where this PR starts.</p>
      {removed.map((symbol) => <RemovedSymbolCard key={`${symbol.file}:${symbol.name}`} symbol={withCounts(symbol)} />)}
    </section>
  );
}

export function skimFiles(files: DiffFile[]): DiffFile[] {
  return files.filter((file) => file.tag === "skim");
}
