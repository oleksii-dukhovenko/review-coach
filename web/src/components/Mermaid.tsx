import { useEffect, useId, useRef, useState } from "react";

import { useTheme } from "../theme.ts";
import { withHouseStyle } from "./mermaidStyle.ts";

let mermaidLoader: Promise<typeof import("mermaid").default> | undefined;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Diagram colors read from the page's tokens, so they follow the theme. */
function themeVariables() {
  return {
    primaryColor: token("--color-surface"), primaryBorderColor: token("--color-neutral-400"), primaryTextColor: token("--color-text"),
    lineColor: token("--color-neutral-500"), edgeLabelBackground: token("--color-bg"),
    fontFamily: "\"Source Serif 4\", Georgia, serif", fontSize: "14px",
  };
}

function themeClasses(): string[] {
  const added = `fill:${token("--color-accent-200")},stroke:${token("--color-accent")},color:${token("--color-accent-900")}`;
  const changed = `fill:${token("--color-accent-2-200")},stroke:${token("--color-accent-2")},color:${token("--color-accent-2-900")}`;
  return [`classDef added ${added},stroke-width:1.5px`, `classDef changed ${changed},stroke-width:1.5px`];
}

/** Waits for the page font, so labels are measured at their real width. */
async function importAfterFonts() {
  await document.fonts.ready;
  return (await import("mermaid")).default;
}

/** Loads Mermaid once, and sets it up for the current theme on every call. */
async function loadMermaid() {
  mermaidLoader ??= importAfterFonts();
  const mermaid = await mermaidLoader;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: themeVariables(),
    flowchart: { curve: "basis", padding: 14, htmlLabels: true },
  });
  return mermaid;
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
  const { theme } = useTheme();
  useEffect(() => {
    if (!source.trim()) return;
    loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, withHouseStyle(source, themeClasses())))
      .then(({ svg }) => setState({ svg }), (error: Error) => setState({ error: error.message }));
  }, [source, theme]);
  useNodeClicks(container, state && "svg" in state ? state.svg : undefined, onNodeClick);
  if (!source.trim() || !state) return null;
  if ("error" in state) return <details className="diagram-error small muted"><summary>The picture could not be drawn</summary><pre>{source}</pre></details>;
  const zoomClass = onNodeClick ? "is-zoomable" : "";
  return <div ref={container} className={`diagram ${zoomClass} ${className}`} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
