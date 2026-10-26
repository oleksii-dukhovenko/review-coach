import { Fragment, useRef, useSyncExternalStore } from "react";

import { scopeSpecOf, useActiveScopes, useLayer, type KeyBinding, type ScopeName } from "../keys.ts";

// - Open or closed, shared by the ? key and every Keys button.

let isHelpOpen = false;
const helpListeners = new Set<() => void>();

function setHelpOpen(isOpen: boolean): void {
  isHelpOpen = isOpen;
  helpListeners.forEach((listener) => listener());
}

function subscribeToHelp(listener: () => void): () => void {
  helpListeners.add(listener);
  return () => helpListeners.delete(listener);
}

export function openKeyHelp(): void {
  setHelpOpen(true);
}

export function closeKeyHelp(): void {
  setHelpOpen(false);
}

export function toggleKeyHelp(): void {
  setHelpOpen(!isHelpOpen);
}

function useIsHelpOpen(): boolean {
  return useSyncExternalStore(subscribeToHelp, () => isHelpOpen);
}

// - How keys are written on screen.

const KEY_NAMES: Record<string, string> = {
  ArrowDown: "Down", ArrowUp: "Up", ArrowLeft: "Left", ArrowRight: "Right", Escape: "Esc", PageUp: "Page Up", PageDown: "Page Down",
};

/** "Cmd" on a Mac, else "Ctrl": the key written as Mod. */
export function modKeyName(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "Cmd" : "Ctrl";
}

function keyNameOf(part: string): string {
  if (part === "Mod") return modKeyName();
  return KEY_NAMES[part] ?? part;
}

/** One combo: "Mod+Enter" as Ctrl + Enter, "g i" as g then i. */
function ComboKeys({ combo }: { combo: string }) {
  return (
    <span className="key-combo">
      {combo.split(" ").map((press, pressIndex) => (
        <Fragment key={pressIndex}>
          {pressIndex > 0 ? <span className="key-then">then</span> : null}
          {press.split("+").map((part, partIndex) => (
            <Fragment key={partIndex}>{partIndex > 0 ? "+" : null}<kbd>{keyNameOf(part)}</kbd></Fragment>
          ))}
        </Fragment>
      ))}
    </span>
  );
}

function BindingRow({ binding }: { binding: KeyBinding }) {
  const combos = [...binding.combos, ...(binding.nativeCombos ?? [])];
  return (
    <tr>
      <th scope="row">
        {combos.map((combo, comboIndex) => (
          <Fragment key={combo}>{comboIndex > 0 ? <span className="key-or">or</span> : null}<ComboKeys combo={combo} /></Fragment>
        ))}
      </th>
      <td>{binding.label}</td>
    </tr>
  );
}

function ScopeTable({ scope }: { scope: ScopeName }) {
  const spec = scopeSpecOf(scope);
  return (
    <section className="key-scope">
      <h3>{spec.title}</h3>
      <table className="key-table">
        <tbody>{spec.bindings.map((binding) => <BindingRow key={binding.id} binding={binding} />)}</tbody>
      </table>
    </section>
  );
}

function KeyHelpPanel({ panel }: { panel: React.RefObject<HTMLDivElement | null> }) {
  const scopes = useActiveScopes().filter((scope) => scope !== "keyHelp");
  return (
    <div className="key-help-layer">
      <div className="key-help-backdrop" onClick={closeKeyHelp} />
      <div className="key-help" ref={panel} role="dialog" aria-modal="true" aria-labelledby="key-help-title">
        <header className="key-help-header">
          <h2 id="key-help-title">Keys for this page</h2>
          <button type="button" className="ghost" onClick={closeKeyHelp}>Close <kbd>Esc</kbd></button>
        </header>
        <div className="key-help-body">
          {scopes.map((scope) => <ScopeTable key={scope} scope={scope} />)}
        </div>
      </div>
    </div>
  );
}

/** The ? panel: every key that works here, from the key map. */
export function KeyHelp() {
  const isOpen = useIsHelpOpen();
  const panel = useRef<HTMLDivElement>(null);
  useLayer(panel, { isOpen, onClose: closeKeyHelp, scope: "keyHelp" });
  return isOpen ? <KeyHelpPanel panel={panel} /> : null;
}

/** A small button that opens the key list. */
export function KeyHelpButton({ className = "" }: { className?: string }) {
  return (
    <button type="button" className={`key-help-button ghost ${className}`.trim()} onClick={openKeyHelp} aria-haspopup="dialog">
      Keys <kbd>?</kbd>
    </button>
  );
}
