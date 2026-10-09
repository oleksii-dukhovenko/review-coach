import { setThemeChoice, useTheme, type ThemeChoice } from "../theme.ts";
import { Icon, type IconName } from "./Icon.tsx";

const CHOICES: { choice: ThemeChoice; icon: IconName; label: string }[] = [
  { choice: "light", icon: "sun", label: "Light" },
  { choice: "dark", icon: "moon", label: "Dark" },
  { choice: "system", icon: "desktop", label: "Same as my computer" },
];

/** Light, dark, or whatever the computer is set to. */
export function ThemePicker() {
  const { choice } = useTheme();
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Theme">
      {CHOICES.map((option) => (
        <button key={option.choice} role="radio" aria-checked={choice === option.choice} title={option.label}
          className={choice === option.choice ? "is-chosen" : ""} onClick={() => setThemeChoice(option.choice)}>
          <Icon name={option.icon} size={15} />
        </button>
      ))}
    </div>
  );
}
