import { useRef, type KeyboardEvent } from "react";

import { comboOf, focusQuietly, moveCursor, type CursorMove } from "../keys.ts";
import { setThemeChoice, useTheme, type ThemeChoice } from "../theme.ts";
import { Icon, type IconName } from "./Icon.tsx";

const CHOICES: { choice: ThemeChoice; icon: IconName; label: string }[] = [
  { choice: "light", icon: "sun", label: "Light" },
  { choice: "dark", icon: "moon", label: "Dark" },
  { choice: "system", icon: "desktop", label: "Same as my computer" },
];

const CHOICE_ORDER = CHOICES.map((option) => option.choice);

// - Arrow keys with no modifier held; anything else is left alone.
const ARROW_MOVES: Partial<Record<string, CursorMove>> = {
  ArrowLeft: "previous",
  ArrowUp: "previous",
  ArrowRight: "next",
  ArrowDown: "next",
};

/** Light, dark, or whatever the computer is set to. */
export function ThemePicker() {
  const { choice } = useTheme();
  const buttons = useRef(new Map<ThemeChoice, HTMLButtonElement>());

  const chooseByArrow = (event: KeyboardEvent) => {
    const move = ARROW_MOVES[comboOf(event)];
    if (move === undefined) return;
    event.preventDefault();
    const nextChoice = moveCursor(CHOICE_ORDER, choice, move) ?? choice;
    setThemeChoice(nextChoice);
    focusQuietly(buttons.current.get(nextChoice));
  };

  const keepButton = (option: ThemeChoice) => (button: HTMLButtonElement | null) => {
    if (button) buttons.current.set(option, button);
    else buttons.current.delete(option);
  };

  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme" onKeyDown={chooseByArrow}>
      {CHOICES.map((option) => {
        const isChosen = choice === option.choice;
        return (
          <button key={option.choice} ref={keepButton(option.choice)} role="radio" aria-checked={isChosen}
            aria-label={option.label} title={option.label} tabIndex={isChosen ? 0 : -1}
            className={isChosen ? "is-chosen" : ""} onClick={() => setThemeChoice(option.choice)}>
            <Icon name={option.icon} size={15} />
          </button>
        );
      })}
    </div>
  );
}
