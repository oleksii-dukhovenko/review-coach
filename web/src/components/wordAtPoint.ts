const IDENTIFIER_CHAR = /[\w$]/;
const IDENTIFIER_START = /^[A-Za-z_$]/;
const KEYWORDS = new Set(["const", "let", "return", "function", "if", "else", "import", "export", "from", "new"]);

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function caretAt(clientX: number, clientY: number): { node: Node; offset: number } | undefined {
  const caretDocument = document as CaretDocument;
  const position = caretDocument.caretPositionFromPoint?.(clientX, clientY);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = caretDocument.caretRangeFromPoint?.(clientX, clientY);
  return range ? { node: range.startContainer, offset: range.startOffset } : undefined;
}

/** Character offset of the click inside the cell's plain text. */
function clickOffsetInCell(clientX: number, clientY: number, cell: HTMLElement): number | undefined {
  const caret = caretAt(clientX, clientY);
  if (!caret || !cell.contains(caret.node)) return undefined;
  const textBeforeClick = document.createRange();
  textBeforeClick.setStart(cell, 0);
  textBeforeClick.setEnd(caret.node, caret.offset);
  return textBeforeClick.toString().length;
}

export type ClickedWord = { word: string; column: number };

export function identifierAround(text: string, offset: number): ClickedWord | undefined {
  let start = offset;
  while (start > 0 && IDENTIFIER_CHAR.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && IDENTIFIER_CHAR.test(text[end])) end++;
  const word = text.slice(start, end);
  return IDENTIFIER_START.test(word) ? { word, column: start } : undefined;
}

function startsAWord(text: string, offset: number): boolean {
  const followsWordChar = offset > 0 && IDENTIFIER_CHAR.test(text[offset - 1]);
  return IDENTIFIER_CHAR.test(text[offset]) && !followsWordChar;
}

function wordStartOffsets(text: string): number[] {
  return [...Array(text.length).keys()].filter((offset) => startsAWord(text, offset));
}

function isListedName(found: ClickedWord | undefined): found is ClickedWord {
  return found !== undefined && !KEYWORDS.has(found.word);
}

function firstOfEach(words: ClickedWord[]): ClickedWord[] {
  return words.filter((word, index) => words.findIndex((other) => other.word === word.word) === index);
}

/** Every name on a line, once each, where it first appears. */
export function identifiersOn(text: string): ClickedWord[] {
  const names = wordStartOffsets(text).map((offset) => identifierAround(text, offset)).filter(isListedName);
  return firstOfEach(names);
}

/** The name under the mouse in a code cell, and where it starts. */
export function wordAtClick(event: React.MouseEvent<HTMLElement>, lineText: string): ClickedWord | undefined {
  const offset = clickOffsetInCell(event.clientX, event.clientY, event.currentTarget);
  return offset === undefined ? undefined : identifierAround(lineText, offset);
}
