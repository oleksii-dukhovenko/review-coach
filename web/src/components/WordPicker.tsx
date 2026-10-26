import { useEffect, useRef } from "react";

import { focusQuietly, moveCursor, type CursorMove } from "../keys.ts";
import type { ClickedWord } from "./wordAtPoint.ts";

type WordPickerProps = { words: ClickedWord[]; onPick: (word: ClickedWord) => void; onClose: () => void };

const MOVE_OF_KEY: Record<string, CursorMove> = {
  j: "next", ArrowDown: "next", ArrowRight: "next",
  k: "previous", ArrowUp: "previous", ArrowLeft: "previous",
  Home: "first", End: "last",
};

function buttonsIn(list: HTMLElement | null): HTMLButtonElement[] {
  return list ? [...list.querySelectorAll<HTMLButtonElement>("button")] : [];
}

function hasCommandKey(event: React.KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

/** A short list of the names on a line: pick one to see where it is used. */
export function WordPicker({ words, onPick, onClose }: WordPickerProps) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    focusQuietly(buttonsIn(list.current)[0]);
  }, []);

  const moveFocus = (move: CursorMove) => {
    const buttons = buttonsIn(list.current);
    const focused = buttons.find((button) => button === document.activeElement);
    moveCursor(buttons, focused, move)?.focus();
  };
  const handleKey = (event: React.KeyboardEvent) => {
    if (hasCommandKey(event)) return;
    const move = MOVE_OF_KEY[event.key];
    if (move) {
      event.preventDefault();
      moveFocus(move);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="word-picker" ref={list} role="group" aria-label="Which name?" onKeyDown={handleKey}>
      <span className="word-picker-title">Show uses of</span>
      {words.map((word) => (
        <button type="button" key={`${word.word}:${word.column}`} className="word-picker-word mono" onClick={() => onPick(word)}>
          {word.word}
        </button>
      ))}
    </div>
  );
}
