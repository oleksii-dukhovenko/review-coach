import "@phosphor-icons/web/duotone";

// - Our names mapped to Phosphor icon names (duotone weight).
const PHOSPHOR = {
  bulb: "lightbulb",
  question: "question",
  arrowRight: "arrow-right",
  arrowLeft: "arrow-left",
  arrowUp: "arrow-up",
  arrowUpRight: "arrow-up-right",
  file: "file",
  check: "check",
  checkCircle: "check-circle",
  map: "map-trifold",
  sparkles: "sparkle",
  alert: "warning",
  book: "book-open",
  flow: "flow-arrow",
  trash: "trash",
  eye: "eye",
  x: "x",
  target: "crosshair",
  message: "chat-text",
  code: "code",
  refresh: "arrow-clockwise",
  github: "github-logo",
  plus: "plus",
} as const;

export type IconName = keyof typeof PHOSPHOR;

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return <i className={`ph-duotone ph-${PHOSPHOR[name]} icon ${className}`} style={{ fontSize: size }} aria-hidden="true" />;
}
