import { addHistoryStep } from "./scrollHistory.ts";

const FLASH_MS = 3000;
const QUIET_AFTER_SCROLL_MS = 120;
const LONGEST_SCROLL_MS = 2500;

function openCollapsedParents(element: Element): void {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  }
}

/** Runs once the page stops moving, so you see what comes next. */
function afterScrollStops(callback: () => void): void {
  let quietTimer = setTimeout(finish, QUIET_AFTER_SCROLL_MS);
  const giveUpTimer = setTimeout(finish, LONGEST_SCROLL_MS);
  function restartQuietTimer() {
    clearTimeout(quietTimer);
    quietTimer = setTimeout(finish, QUIET_AFTER_SCROLL_MS);
  }
  function finish() {
    clearTimeout(quietTimer);
    clearTimeout(giveUpTimer);
    window.removeEventListener("scroll", restartQuietTimer);
    callback();
  }
  window.addEventListener("scroll", restartQuietTimer, { passive: true });
}

/** Marks where you landed: a glow once you arrive, then a quiet marker until the next jump. */
function markLanding(element: Element): void {
  document.querySelectorAll(".jump-target").forEach((previous) => previous.classList.remove("jump-target"));
  element.classList.add("jump-target");
  afterScrollStops(() => {
    element.classList.remove("jump-flash");
    void (element as HTMLElement).offsetWidth;
    element.classList.add("jump-flash");
    setTimeout(() => element.classList.remove("jump-flash"), FLASH_MS);
  });
}

function findLineRow(filePath: string, line: number, side: "LEFT" | "RIGHT"): HTMLElement | null {
  const selector = `.code[data-file="${CSS.escape(filePath)}"][data-line="${line}"][data-side="${side}"]`;
  return document.querySelector<HTMLElement>(selector)?.closest<HTMLElement>("tr, .fig-row") ?? null;
}

/** Scrolls to a diff line; false when it is not on the page. */
export function jumpToLine(filePath: string, line: number, side: "LEFT" | "RIGHT"): boolean {
  const row = findLineRow(filePath, line, side);
  if (!row) return false;
  addHistoryStep();
  openCollapsedParents(row);
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  markLanding(row);
  return true;
}
