import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";

import { api, type DiffFile, type PrRoute, type Snippet } from "../api.ts";
import { actorOf, changedLinesIn, handOffOf, lanesOf, stepChange, type FlowStep, type StepChange } from "../flowLanes.ts";
import { useWidgetKeys } from "../keys.ts";
import { commentFlags } from "./commentLines.ts";
import { languageForFile, renderCodeLine } from "./highlight.ts";
import { Icon } from "./Icon.tsx";

type OpenLine = (file: string, line: number, side: "LEFT" | "RIGHT") => void;

type Point = { x: number; y: number };

type Link = { from: Point; to: Point; label: string };

const CHANGE_LABEL: Record<StepChange, string> = {
  changed: "Changed by this PR",
  "same-file": "In a changed file",
  existing: "Existing code",
};

function bottomCenter(rect: DOMRect, origin: DOMRect): Point {
  return { x: rect.left - origin.left + rect.width / 2, y: rect.bottom - origin.top };
}

function topCenter(rect: DOMRect, origin: DOMRect): Point {
  return { x: rect.left - origin.left + rect.width / 2, y: rect.top - origin.top };
}

/** Arrows from each step to the next, measured from the drawn boxes. */
function useLinks(container: RefObject<HTMLDivElement | null>, nodes: RefObject<(HTMLButtonElement | null)[]>, flow: FlowStep[]): Link[] {
  const [links, setLinks] = useState<Link[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      const origin = container.current?.getBoundingClientRect();
      const boxes = nodes.current.map((node) => node?.getBoundingClientRect());
      if (!origin || boxes.some((box) => !box)) return;
      const linkBetween = (stepIndex: number) =>
        ({ from: bottomCenter(boxes[stepIndex]!, origin), to: topCenter(boxes[stepIndex + 1]!, origin), label: handOffOf(flow[stepIndex]) });
      setLinks(flow.slice(0, -1).map((_step, stepIndex) => linkBetween(stepIndex)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [flow]);
  return links;
}

function curveBetween(link: Link): string {
  const middleY = (link.from.y + link.to.y) / 2;
  return `M ${link.from.x} ${link.from.y} C ${link.from.x} ${middleY}, ${link.to.x} ${middleY}, ${link.to.x} ${link.to.y - 6}`;
}

function LinkLayer({ links, selectedIndex }: { links: Link[]; selectedIndex: number }) {
  return (
    <svg className="flow-links" aria-hidden="true">
      <defs>
        <marker id="flow-arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      {links.map((link, linkIndex) => (
        <g key={linkIndex} className={linkIndex === selectedIndex || linkIndex === selectedIndex - 1 ? "is-near" : ""}>
          <path d={curveBetween(link)} markerEnd="url(#flow-arrow)" />
          {link.label ? (
            <text x={(link.from.x + link.to.x) / 2} y={(link.from.y + link.to.y) / 2 + 4} textAnchor="middle">{link.label}</text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

type StepButtons = RefObject<(HTMLButtonElement | null)[]>;

type DiagramProps = { flow: FlowStep[]; files: DiffFile[]; selectedIndex: number; onSelect: (stepIndex: number) => void; nodes: StepButtons };

/**
 * Swimlanes: one column per actor, one row per step, arrows for each hand-off.
 * - Only the selected step is a Tab stop.
 */
function SwimlaneDiagram({ flow, files, selectedIndex, onSelect, nodes }: DiagramProps) {
  const container = useRef<HTMLDivElement>(null);
  const links = useLinks(container, nodes, flow);
  const lanes = lanesOf(flow);
  return (
    <div className="swimlanes" ref={container} style={{ gridTemplateColumns: `repeat(${lanes.length}, minmax(140px, 1fr))` }}>
      {lanes.map((lane, laneIndex) => (
        <div key={lane} className="lane-head" style={{ gridColumn: laneIndex + 1 }}>{lane}</div>
      ))}
      {lanes.map((lane, laneIndex) => (
        <div key={`line-${lane}`} className="lane-line" style={{ gridColumn: laneIndex + 1, gridRow: `2 / span ${flow.length}` }} />
      ))}
      <LinkLayer links={links} selectedIndex={selectedIndex} />
      {flow.map((step, stepIndex) => (
        <button key={stepIndex} ref={(node) => { nodes.current[stepIndex] = node; }}
          className={`lane-step change-${stepChange(step, files)} ${stepIndex === selectedIndex ? "is-selected" : ""}`}
          style={{ gridColumn: lanes.indexOf(actorOf(step)) + 1, gridRow: stepIndex + 2 }} tabIndex={stepIndex === selectedIndex ? 0 : -1}
          onClick={() => onSelect(stepIndex)}>
          <span className="lane-step-number">{stepIndex + 1}</span>
          <span className="lane-step-label">{step.label}</span>
        </button>
      ))}
    </div>
  );
}

function useSnippet(route: PrRoute, step: FlowStep): Snippet | undefined {
  const [snippet, setSnippet] = useState<Snippet>();
  useEffect(() => {
    setSnippet(undefined);
    api.snippet(route, step.file, step.line).then(setSnippet, () => setSnippet(undefined));
  }, [step.file, step.line]);
  return snippet;
}

function StepCode({ snippet, step, files }: { snippet: Snippet | undefined; step: FlowStep; files: DiffFile[] }) {
  if (!snippet) return <div className="step-code muted small">Loading the code...</div>;
  const language = languageForFile(snippet.file);
  const isCommentLine = commentFlags(snippet.lines, snippet.file);
  const changedLines = changedLinesIn(files, snippet.file);
  const rowClass = (lineNumber: number) => [lineNumber === step.line ? "is-target" : "", changedLines.has(lineNumber) ? "is-changed" : ""].join(" ");
  return (
    <table className="step-code">
      <tbody>
        {snippet.lines.map((lineText, lineIndex) => {
          const lineNumber = snippet.startLine + lineIndex;
          return (
            <tr key={lineNumber} className={rowClass(lineNumber)}>
              <td className="step-code-number">{lineNumber}</td>
              <td dangerouslySetInnerHTML={{ __html: renderCodeLine(lineText, language, isCommentLine[lineIndex]) || " " }} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type PlayerProps = {
  route: PrRoute;
  flow: FlowStep[];
  files: DiffFile[];
  selectedIndex: number;
  onSelect: (stepIndex: number) => void;
  onOpenLine: OpenLine;
};

type StepBarProps = { selectedIndex: number; count: number; onSelect: (stepIndex: number) => void };

/**
 * Previous and Next.
 * - At either end the button stays focusable and does nothing.
 */
function StepBar({ selectedIndex, count, onSelect }: StepBarProps) {
  const isFirst = selectedIndex === 0;
  const isLast = selectedIndex === count - 1;
  const goBack = () => {
    if (!isFirst) onSelect(selectedIndex - 1);
  };
  const goOn = () => {
    if (!isLast) onSelect(selectedIndex + 1);
  };
  return (
    <div className="step-player-bar">
      <button onClick={goBack} aria-disabled={isFirst} aria-label="Previous step" title="Previous step (←)"><Icon name="arrowLeft" /></button>
      <span className="small muted">Step {selectedIndex + 1} of {count}</span>
      <button className="primary" onClick={goOn} aria-disabled={isLast} title="Next step (→)">
        Next <Icon name="arrowRight" size={14} />
      </button>
    </div>
  );
}

/** One step at a time: what happens, what it hands on, and the code that does it. */
function StepPlayer({ route, flow, files, selectedIndex, onSelect, onOpenLine }: PlayerProps) {
  const step = flow[selectedIndex];
  const snippet = useSnippet(route, step);
  const change = stepChange(step, files);
  return (
    <div className="step-player" tabIndex={0}>
      <StepBar selectedIndex={selectedIndex} count={flow.length} onSelect={onSelect} />
      <div className="step-actor small">{actorOf(step)}</div>
      <h3 className="step-title">{step.label}</h3>
      <p className="step-explain">{step.explanation}</p>
      <div className="step-chips">
        <span className={`chip step-change change-${change}`}>{CHANGE_LABEL[change]}</span>
        {handOffOf(step) ? <span className="chip">Hands on: {handOffOf(step)}</span> : null}
      </div>
      <StepCode snippet={snippet} step={step} files={files} />
      <div className="step-footer">
        <span className="mono small muted" title={step.file}>{step.file.split("/").at(-1)}:{step.line}</span>
        <button className="link-button" onClick={() => onOpenLine(step.file, step.line, "RIGHT")}>Go to it <Icon name="arrowRight" size={13} /></button>
      </div>
    </div>
  );
}

function FlowLegend() {
  return (
    <div className="legend small muted">
      <span><span className="legend-swatch flow-changed" /> changed by this PR</span>
      <span><span className="legend-swatch flow-same-file" /> in a changed file</span>
      <span><span className="legend-swatch flow-existing" /> existing code</span>
    </div>
  );
}

const FORWARD_KEYS = new Set(["ArrowRight", "ArrowDown", "j"]);
const BACK_KEYS = new Set(["ArrowLeft", "ArrowUp", "k"]);

function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
}

/** The step a key moves to, clamped to the ends; undefined for other keys. */
function stepForKey(key: string, selectedIndex: number, count: number): number | undefined {
  if (FORWARD_KEYS.has(key)) return Math.min(selectedIndex + 1, count - 1);
  if (BACK_KEYS.has(key)) return Math.max(selectedIndex - 1, 0);
  if (key === "Home") return 0;
  return key === "End" ? count - 1 : undefined;
}

/**
 * Arrows, j/k, Home and End move between steps.
 * - Focus on a lane step follows the selection.
 */
function stepKeyHandler(count: number, selectedIndex: number, onSelect: (stepIndex: number) => void, nodes: StepButtons) {
  return (event: KeyboardEvent) => {
    const next = hasModifier(event) ? undefined : stepForKey(event.key, selectedIndex, count);
    const isNewStep = next !== undefined && next !== selectedIndex;
    if (isNewStep) {
      event.preventDefault();
      const isOnLaneStep = nodes.current.includes(event.target as HTMLButtonElement);
      onSelect(next);
      if (isOnLaneStep) nodes.current[next]?.focus();
    }
  };
}

/** The run as a picture you can step through. */
export function FlowDiagram({ route, flow, files, onOpenLine }: { route: PrRoute; flow: FlowStep[]; files: DiffFile[]; onOpenLine: OpenLine }) {
  useWidgetKeys("flow");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKey = stepKeyHandler(flow.length, selectedIndex, setSelectedIndex, nodes);
  return (
    <div className="flow-diagram" onKeyDown={handleKey}>
      <div className="flow-picture">
        <SwimlaneDiagram flow={flow} files={files} selectedIndex={selectedIndex} onSelect={setSelectedIndex} nodes={nodes} />
        <FlowLegend />
      </div>
      <StepPlayer route={route} flow={flow} files={files} selectedIndex={selectedIndex} onSelect={setSelectedIndex} onOpenLine={onOpenLine} />
    </div>
  );
}
