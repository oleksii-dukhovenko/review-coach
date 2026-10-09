// - Light colors; the page passes the current theme's own when it draws.
const LIGHT_CLASSES = [
  "classDef added fill:#cbeeff,stroke:#0088b0,color:#0a303e,stroke-width:1.5px",
  "classDef changed fill:#ffdee6,stroke:#d6006c,color:#4b1528,stroke-width:1.5px",
];

function isFlowchart(source: string): boolean {
  return /^\s*(flowchart|graph)\b/.test(source);
}

/** Adds the added/changed colors, and drops click and style lines. */
export function withHouseStyle(source: string, houseClasses = LIGHT_CLASSES): string {
  const safeLines = source.split("\n").filter((line) => !/^\s*(click|classDef|style)\b/.test(line));
  const classLines = isFlowchart(source) ? houseClasses : [];
  return [...safeLines, ...classLines].join("\n");
}
