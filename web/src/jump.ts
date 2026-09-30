const FLASH_MS = 1600;

export function tourStopId(filePath: string): string {
  return `stop-${filePath.replace(/[^a-zA-Z0-9]/g, "-")}`;
}

function openCollapsedParents(element: Element): void {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
}

function flash(element: Element): void {
  element.classList.add("jump-flash");
  setTimeout(() => element.classList.remove("jump-flash"), FLASH_MS);
}

export function jumpToFile(filePath: string): boolean {
  const stop = document.getElementById(tourStopId(filePath));
  if (!stop) return false;
  if (stop instanceof HTMLDetailsElement) stop.open = true;
  stop.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function findLineRow(filePath: string, line: number, side: "LEFT" | "RIGHT"): HTMLElement | null {
  const selector = `td.code[data-file="${CSS.escape(filePath)}"][data-line="${line}"][data-side="${side}"]`;
  return document.querySelector<HTMLElement>(selector)?.closest("tr") ?? null;
}

/** Scrolls to a diff line; falls back to the file's tour stop. */
export function jumpToLine(filePath: string, line: number, side: "LEFT" | "RIGHT"): "line" | "file" | "missing" {
  const row = findLineRow(filePath, line, side);
  if (!row) return jumpToFile(filePath) ? "file" : "missing";
  openCollapsedParents(row);
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  flash(row);
  return "line";
}
