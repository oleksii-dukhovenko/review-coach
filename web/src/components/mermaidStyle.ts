// - Light colors; the page passes the current theme's own when it draws.
const LIGHT_CLASSES = [
  "classDef added fill:#d5f3da,stroke:#298646,color:#053817,stroke-width:1.5px",
  "classDef changed fill:#fde6c6,stroke:#98660a,color:#402801,stroke-width:1.5px",
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
