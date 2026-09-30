const IDENTIFIER_CHAR = /[\w$]/;
const IDENTIFIER_START = /^[A-Za-z_$]/;

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

function identifierAround(text: string, offset: number): string | undefined {
  let start = offset;
  while (start > 0 && IDENTIFIER_CHAR.test(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && IDENTIFIER_CHAR.test(text[end])) end++;
  const word = text.slice(start, end);
  return IDENTIFIER_START.test(word) ? word : undefined;
}

/** The name under the mouse in a code cell, if any. */
export function wordAtClick(event: React.MouseEvent<HTMLElement>, lineText: string): string | undefined {
  const offset = clickOffsetInCell(event.clientX, event.clientY, event.currentTarget);
  return offset === undefined ? undefined : identifierAround(lineText, offset);
}
