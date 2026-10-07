import { useEffect, useId, useRef, useState } from "react";

// - Keep in sync with --added / --changed in styles.css.
const HOUSE_CLASSES = [
  "classDef added fill:#cbeeff,stroke:#0088b0,color:#0a303e,stroke-width:1.5px",
  "classDef changed fill:#ffdee6,stroke:#d6006c,color:#4b1528,stroke-width:1.5px",
];

function isFlowchart(source: string): boolean {
  return /^\s*(flowchart|graph)\b/.test(source);
}

/** Adds the added/changed colors, and drops click and style lines. */
export function withHouseStyle(source: string): string {
  const safeLines = source.split("\n").filter((line) => !/^\s*(click|classDef|style)\b/.test(line));
  const classLines = isFlowchart(source) ? HOUSE_CLASSES : [];
  return [...safeLines, ...classLines].join("\n");
}

let mermaidLoader: Promise<typeof import("mermaid").default> | undefined;

// - Keep in sync with the Broadsheet tokens.
const HOUSE_THEME = {
  primaryColor: "#eae9e9", primaryBorderColor: "#bab6b6", primaryTextColor: "#201e1d", lineColor: "#9b9797",
  edgeLabelBackground: "#f3f2f2", fontFamily: "\"Source Serif 4\", Georgia, serif", fontSize: "14px",
};

/** Waits for the page font, so labels are measured at their real width. */
async function importAfterFonts() {
  await document.fonts.ready;
  return (await import("mermaid")).default;
}

function loadMermaid() {
  mermaidLoader ??= importAfterFonts().then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: HOUSE_THEME,
      flowchart: { curve: "basis", padding: 14, htmlLabels: true },
    });
    return mermaid;
  });
  return mermaidLoader;
}

type RenderState = { svg: string } | { error: string } | undefined;

export type NodeChange = "added" | "changed" | "existing";

export type ClickedNode = { id: string; label: string; change: NodeChange; element: Element };

const NODE_ID = /-flowchart-(.+)-\d+$/;

function changeOf(element: Element): NodeChange {
  if (element.classList.contains("added")) return "added";
  return element.classList.contains("changed") ? "changed" : "existing";
}

function clickedNodeOf(element: Element): ClickedNode | null {
  const id = element.id.match(NODE_ID)?.[1];
  return id ? { id, label: element.textContent?.trim() ?? id, change: changeOf(element), element } : null;
}

/** Lets each flowchart box be clicked once the SVG is on the page. */
function useNodeClicks(container: React.RefObject<HTMLDivElement | null>, svg: string | undefined, onNodeClick?: (node: ClickedNode) => void) {
  useEffect(() => {
    const element = container.current;
    if (!element || !onNodeClick) return;
    const handleClick = (event: MouseEvent) => {
      const nodeElement = (event.target as Element).closest("g.node");
      const clicked = nodeElement ? clickedNodeOf(nodeElement) : null;
      if (clicked) onNodeClick(clicked);
    };
    element.addEventListener("click", handleClick);
    return () => element.removeEventListener("click", handleClick);
  }, [svg, onNodeClick]);
}

type MermaidProps = { source: string; className?: string; onNodeClick?: (node: ClickedNode) => void };

/** Draws a Mermaid diagram; shows nothing if it cannot. */
export function Mermaid({ source, className = "", onNodeClick }: MermaidProps) {
  const diagramId = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RenderState>();
  useEffect(() => {
    if (!source.trim()) return;
    loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, withHouseStyle(source)))
      .then(({ svg }) => setState({ svg }), (error: Error) => setState({ error: error.message }));
  }, [source]);
  useNodeClicks(container, state && "svg" in state ? state.svg : undefined, onNodeClick);
  if (!source.trim() || !state) return null;
  if ("error" in state) return <details className="diagram-error small muted"><summary>The picture could not be drawn</summary><pre>{source}</pre></details>;
  const zoomClass = onNodeClick ? "is-zoomable" : "";
  return <div ref={container} className={`diagram ${zoomClass} ${className}`} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
