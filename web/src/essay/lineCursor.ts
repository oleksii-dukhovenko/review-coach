// - The code line cursor: figures, the zoomed code, and the whole-file drawer.
// - nextCell is pure; the rest reads the page.

import { focusQuietly } from "../keys.ts";

export type CellSide = "left" | "right";
export type CellPos = { figure: string; row: number; side: CellSide };
export type LineMove = "down" | "up" | "left" | "right";
export type LineSide = "LEFT" | "RIGHT";
export type LinePoint = { file: string; line: number; side: LineSide };

const FIGURE_CELL = ".fig-half:not(.is-empty)";
const DRAWER_CELL = ".viewer-code > tbody > tr:not(.viewer-peek)";
const LINE_CELL = `${FIGURE_CELL}, ${DRAWER_CELL}`;

function isSameRow(first: CellPos, second: CellPos): boolean {
  return first.figure === second.figure && first.row === second.row;
}

function sideCell(cells: CellPos[], current: CellPos, side: CellSide): number | undefined {
  const index = cells.findIndex((cell) => isSameRow(cell, current) && cell.side === side);
  return index === -1 ? undefined : index;
}

function firstCellBelow(cells: CellPos[], from: number): number {
  return cells.findIndex((cell, index) => index > from && !isSameRow(cell, cells[from]));
}

function lastCellAbove(cells: CellPos[], from: number): number {
  return cells.findLastIndex((cell, index) => index < from && !isSameRow(cell, cells[from]));
}

/** The cell on this side of the row, or the row's other cell when this side is empty. */
function cellInRow(cells: CellPos[], rowCell: CellPos, side: CellSide): number {
  return sideCell(cells, rowCell, side) ?? cells.findIndex((cell) => isSameRow(cell, rowCell));
}

/** Where the cursor goes from cell `from`; undefined at an edge. */
export function nextCell(cells: CellPos[], from: number, move: LineMove, isWithinFigure: boolean): number | undefined {
  const current = cells[from];
  if (!current) return undefined;
  if (move === "left" || move === "right") return sideCell(cells, current, move);
  const neighbour = move === "down" ? firstCellBelow(cells, from) : lastCellAbove(cells, from);
  if (neighbour === -1) return undefined;
  const isOtherFigure = cells[neighbour].figure !== current.figure;
  if (isWithinFigure && isOtherFigure) return undefined;
  return cellInRow(cells, cells[neighbour], current.side);
}

// - Reading the page.

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

/** Every line cell under root that is on screen, in page order. */
export function lineCells(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(LINE_CELL)].filter(isShown);
}

/** The line cell that holds this element: a figure half or a drawer row. */
export function lineCellOf(element: Element | null): HTMLElement | null {
  return element?.closest<HTMLElement>(LINE_CELL) ?? null;
}

export function focusedLineCell(): HTMLElement | null {
  return lineCellOf(document.activeElement);
}

/** The file, line and side a figure half shows. */
export function linePointOf(cell: Element | null): LinePoint | undefined {
  const code = cell?.querySelector<HTMLElement>(".code[data-line]");
  const { file, line, side } = code?.dataset ?? {};
  const isKnownSide = side === "LEFT" || side === "RIGHT";
  return file && line && isKnownSide ? { file, line: Number(line), side } : undefined;
}

function idFor(ids: Map<Element, number>, element: Element): number {
  const id = ids.get(element) ?? ids.size;
  ids.set(element, id);
  return id;
}

function isLeftHalf(cell: Element): boolean {
  return cell.classList.contains("fig-half") && cell.previousElementSibling === null;
}

function cellPositions(cells: HTMLElement[]): CellPos[] {
  const figureIds = new Map<Element, number>();
  const rowIds = new Map<Element, number>();
  return cells.map((cell) => ({
    figure: String(idFor(figureIds, cell.closest(".fig-body, .viewer-code") ?? cell)),
    row: idFor(rowIds, cell.closest(".fig-row") ?? cell),
    side: isLeftHalf(cell) ? "left" : "right",
  }));
}

function pageFigureCells(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FIGURE_CELL)].filter((cell) => isShown(cell) && !cell.closest(".zoom-panel"));
}

/** The cells a move may reach: the zoom panel, the drawer, or the page. */
function cellsAround(cell: HTMLElement): HTMLElement[] {
  const panel = cell.closest(".zoom-panel") ?? cell.closest(".viewer-code");
  return panel ? lineCells(panel) : pageFigureCells();
}

function focusAndReveal(cell: HTMLElement | undefined): boolean {
  if (!cell) return false;
  focusQuietly(cell);
  cell.scrollIntoView({ block: "nearest" });
  return true;
}

function isDrawerLine(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(DRAWER_CELL);
}

function siblingRow(row: Element, move: LineMove): Element | null {
  return move === "down" ? row.nextElementSibling : row.previousElementSibling;
}

/** The next drawer line up or down, past peek rows; one step, not a scan of the file. */
function drawerRowAfter(row: HTMLElement, move: LineMove): HTMLElement | undefined {
  const isUpOrDown = move === "down" || move === "up";
  if (!isUpOrDown) return undefined;
  for (let next = siblingRow(row, move); next; next = siblingRow(next, move)) {
    if (isDrawerLine(next)) return next;
  }
  return undefined;
}

/** Moves focus one line from the focused one; stays in the zoom panel or drawer. */
export function moveLineFocus(from: Element, move: LineMove, isWithinFigure = false): boolean {
  const cell = lineCellOf(from);
  if (!cell) return false;
  if (isDrawerLine(cell)) return focusAndReveal(drawerRowAfter(cell, move));
  const cells = cellsAround(cell);
  const nextIndex = nextCell(cellPositions(cells), cells.indexOf(cell), move, isWithinFigure);
  return focusAndReveal(nextIndex === undefined ? undefined : cells[nextIndex]);
}

function halfOnSide(cell: Element, side: CellSide): Element | null {
  const row = cell.parentElement;
  return (side === "left" ? row?.firstElementChild : row?.lastElementChild) ?? null;
}

/** True when the figure row holds a line on that side, other than this one. */
export function hasLineOnSide(from: Element, side: CellSide): boolean {
  const cell = lineCellOf(from);
  const target = cell ? halfOnSide(cell, side) : null;
  const isOtherHalf = target !== null && target !== cell;
  return isOtherHalf && target.matches(FIGURE_CELL);
}

/** Focuses a figure line by file, line number and side; the zoom panel's copy first. */
export function focusLine(file: string, line: number, side: LineSide): boolean {
  const selector = `.code[data-file="${CSS.escape(file)}"][data-line="${line}"][data-side="${side}"]`;
  const code = document.querySelector(`.zoom-panel ${selector}`) ?? document.querySelector(selector);
  return focusQuietly(code?.closest(".fig-half"));
}

function isBelowWindowTop(cell: HTMLElement): boolean {
  return cell.getBoundingClientRect().top >= 0;
}

function isAboveWindowBottom(cell: HTMLElement): boolean {
  return cell.getBoundingClientRect().bottom <= window.innerHeight;
}

/** Focuses the first line in view going down, or the last one going up. */
export function focusLineInView(direction: "down" | "up"): boolean {
  const cells = pageFigureCells();
  return focusAndReveal(direction === "down" ? cells.find(isBelowWindowTop) : cells.findLast(isAboveWindowBottom));
}
