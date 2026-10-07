import { useEffect, useId, useState } from "react";

// - Keep in sync with --added / --changed in styles.css.
const LIGHT_CLASSES = [
  "classDef added fill:#e3f5e8,stroke:#1f7a36,color:#123d1c,stroke-width:2px",
  "classDef changed fill:#fff4d6,stroke:#b54708,color:#4a2a05,stroke-width:2px",
];
const DARK_CLASSES = [
  "classDef added fill:#17301d,stroke:#6fd08a,color:#e3f5e8,stroke-width:2px",
  "classDef changed fill:#3a2a19,stroke:#f5a35c,color:#fdf0e3,stroke-width:2px",
];

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function isFlowchart(source: string): boolean {
  return /^\s*(flowchart|graph)\b/.test(source);
}

/** Adds the added/changed colors, and drops click and style lines. */
export function withHouseStyle(source: string, isDark: boolean): string {
  const safeLines = source.split("\n").filter((line) => !/^\s*(click|classDef|style)\b/.test(line));
  const classLines = isFlowchart(source) ? (isDark ? DARK_CLASSES : LIGHT_CLASSES) : [];
  return [...safeLines, ...classLines].join("\n");
}

let mermaidLoader: Promise<typeof import("mermaid").default> | undefined;

// - Keep in sync with the tokens in styles.css.
const LIGHT_THEME = { primaryColor: "#f1f3f6", primaryBorderColor: "#d0d5dd", primaryTextColor: "#101828", lineColor: "#98a2b3", edgeLabelBackground: "#ffffff" };
const DARK_THEME = { primaryColor: "#1c2027", primaryBorderColor: "#333a45", primaryTextColor: "#eceff3", lineColor: "#667085", edgeLabelBackground: "#15181e" };

/** Waits for the page font, so labels are measured at their real width. */
async function importAfterFonts() {
  await document.fonts.ready;
  return (await import("mermaid")).default;
}

function loadMermaid(isDark: boolean) {
  mermaidLoader ??= importAfterFonts().then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: { ...(isDark ? DARK_THEME : LIGHT_THEME), fontFamily: "Inter, system-ui, sans-serif", fontSize: "14px" },
      flowchart: { curve: "basis", padding: 14, htmlLabels: true },
    });
    return mermaid;
  });
  return mermaidLoader;
}

type RenderState = { svg: string } | { error: string } | undefined;

/** Draws a Mermaid diagram; shows nothing if it cannot. */
export function Mermaid({ source, className = "" }: { source: string; className?: string }) {
  const diagramId = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<RenderState>();
  useEffect(() => {
    if (!source.trim()) return;
    const isDark = prefersDark();
    loadMermaid(isDark)
      .then((mermaid) => mermaid.render(diagramId, withHouseStyle(source, isDark)))
      .then(({ svg }) => setState({ svg }), (error: Error) => setState({ error: error.message }));
  }, [source]);
  if (!source.trim() || !state) return null;
  if ("error" in state) return <details className="diagram-error small muted"><summary>The picture could not be drawn</summary><pre>{source}</pre></details>;
  return <div className={`diagram ${className}`} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
