// - The rules every key follows, as pure functions.
// - No DOM here: each takes plain objects, so tests run in Node.

import { bindingsOf, SCOPE_NAMES, scopeSpecOf, type KeyBinding, type ScopeLevel, type ScopeName } from "./keyMap.ts";

export type KeyEventLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing?: boolean };
export type TargetLike = { tagName: string; type?: string; role?: string | null; isContentEditable?: boolean } | null;

export type PendingPrefix = { prefix: string; startedAt: number };
export type SequenceStep = { combo: string | undefined; pending: PendingPrefix | null };
export type CursorMove = "next" | "previous" | "first" | "last";
export type BindingCandidate = { combos: readonly string[]; when?: () => boolean };

export const SEQUENCE_TIMEOUT_MS = 1500;

const TYPING_INPUT_TYPES = new Set(["", "text", "search", "email", "url", "number", "password", "tel"]);
const ARROW_OWNER_TAGS = new Set(["input", "select", "textarea"]);
const ARROW_OWNER_ROLES = new Set(["radio", "tab", "listbox", "option", "slider"]);
const CONTROL_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Space", "Enter"]);
const SELF_PRESSING_TAGS = new Set(["button", "a", "summary"]);
const SELF_PRESSING_ROLES = new Set(["button", "link", "checkbox", "radio", "switch", "menuitem", "tab"]);
const LEVEL_ORDER: readonly ScopeLevel[] = ["widget", "focused", "panel", "page", "everywhere"];

const ALL_COMBOS = SCOPE_NAMES.flatMap((scope) => bindingsOf(scope).flatMap((binding) => binding.combos));
const SEQUENCES = new Set(ALL_COMBOS.filter((combo) => combo.includes(" ")));
const SEQUENCE_PREFIXES = new Set([...SEQUENCES].map((sequence) => sequence.split(" ")[0]));

/** The key as written in the key map: "j", "N", "?", "Mod+Enter", "Shift+ArrowDown", "Space". */
export function comboOf(event: KeyEventLike): string {
  const keyName = event.key === " " ? "Space" : event.key;
  const isNamedKey = keyName.length > 1;
  const modifiers = [
    event.ctrlKey || event.metaKey ? "Mod" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey && isNamedKey ? "Shift" : "",
  ];
  return [...modifiers.filter((modifier) => modifier !== ""), keyName].join("+");
}

function tagOf(target: NonNullable<TargetLike>): string {
  return target.tagName.toLowerCase();
}

/** True when keys typed here are text, not commands. */
export function isTypingTarget(target: TargetLike): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = tagOf(target);
  const isTextInput = tag === "input" && TYPING_INPUT_TYPES.has((target.type ?? "").toLowerCase());
  return tag === "textarea" || tag === "select" || isTextInput;
}

/** True for controls that move with arrows, Home, End, Space and Enter. */
export function ownsArrowKeys(target: TargetLike): boolean {
  if (!target) return false;
  return ARROW_OWNER_TAGS.has(tagOf(target)) || ARROW_OWNER_ROLES.has(target.role ?? "");
}

/** True for buttons and links: Enter and Space press them. */
export function pressesItself(target: TargetLike): boolean {
  if (!target) return false;
  return SELF_PRESSING_TAGS.has(tagOf(target)) || SELF_PRESSING_ROLES.has(target.role ?? "");
}

function baseKeyOf(combo: string): string {
  return combo.replace(/^((Mod|Alt|Shift)\+)+(?=.)/, "");
}

/** True when the focused element keeps this key for itself. */
export function isKeyLeftToTarget(combo: string, target: TargetLike): boolean {
  if (combo.startsWith("Mod+")) return false;
  if (isTypingTarget(target)) return true;
  const baseKey = baseKeyOf(combo);
  const isControlKey = CONTROL_KEYS.has(baseKey);
  const isPressKey = baseKey === "Enter" || baseKey === "Space";
  return (isControlKey && ownsArrowKeys(target)) || (isPressKey && pressesItself(target));
}

function isReady(candidate: BindingCandidate): boolean {
  return candidate.when?.() ?? true;
}

/** The first binding, in answer order, that takes this key here. */
export function pickBinding<Candidate extends BindingCandidate>(candidates: readonly Candidate[], combo: string, target: TargetLike): Candidate | undefined {
  if (isKeyLeftToTarget(combo, target)) return undefined;
  return candidates.find((candidate) => candidate.combos.includes(combo) && isReady(candidate));
}

/** Joins "g" then "i" into "g i"; a key that finishes no jump is dropped. */
export function advanceSequence(pending: PendingPrefix | null, combo: string, now: number): SequenceStep {
  const isPendingFresh = pending !== null && now - pending.startedAt <= SEQUENCE_TIMEOUT_MS;
  if (isPendingFresh) {
    const sequence = `${pending.prefix} ${combo}`;
    return { combo: SEQUENCES.has(sequence) ? sequence : undefined, pending: null };
  }
  if (SEQUENCE_PREFIXES.has(combo)) return { combo: undefined, pending: { prefix: combo, startedAt: now } };
  return { combo, pending: null };
}

/** Moves along a list and stops at both ends. */
export function moveCursor<Key>(keys: readonly Key[], current: Key | undefined, move: CursorMove): Key | undefined {
  if (keys.length === 0) return undefined;
  const lastIndex = keys.length - 1;
  const index = current === undefined ? -1 : keys.indexOf(current);
  const hasCurrent = index !== -1;
  const targetIndex: Record<CursorMove, number> = {
    first: 0,
    last: lastIndex,
    next: hasCurrent ? Math.min(index + 1, lastIndex) : 0,
    previous: hasCurrent ? Math.max(index - 1, 0) : lastIndex,
  };
  return keys[targetIndex[move]];
}

/** Keeps the cursor on its item; if it is gone, takes the item now at its place. */
export function keepCursor<Key>(previousKeys: readonly Key[], current: Key | undefined, nextKeys: readonly Key[]): Key | undefined {
  if (current === undefined || nextKeys.length === 0) return undefined;
  if (nextKeys.includes(current)) return current;
  const oldIndex = Math.max(previousKeys.indexOf(current), 0);
  return nextKeys[Math.min(oldIndex, nextKeys.length - 1)];
}

/** Where Tab goes inside a panel: it wraps at both ends. */
export function nextTrapIndex(count: number, index: number, isBackward: boolean): number {
  if (count === 0) return -1;
  if (isBackward) return index <= 0 ? count - 1 : index - 1;
  return (index + 1) % count;
}

type ScopedBinding = { scope: ScopeName; binding: KeyBinding };

function scopedBindingsOf(scopes: readonly ScopeName[]): ScopedBinding[] {
  return scopes.flatMap((scope) => bindingsOf(scope).map((binding) => ({ scope, binding })));
}

function sharedCombos(first: KeyBinding, second: KeyBinding): string[] {
  return first.combos.filter((combo) => second.combos.includes(combo));
}

function isClash(first: KeyBinding, second: KeyBinding): boolean {
  const meansTheSame = first.label === second.label;
  const eitherPassesOn = first.passesOn === true || second.passesOn === true;
  return !meansTheSame && !eitherPassesOn;
}

function describeClash(combo: string, first: ScopedBinding, second: ScopedBinding): string {
  return `${combo}: ${first.scope}.${first.binding.id} "${first.binding.label}" vs ${second.scope}.${second.binding.id} "${second.binding.label}"`;
}

function clashesBetween(first: ScopedBinding, second: ScopedBinding): string[] {
  if (!isClash(first.binding, second.binding)) return [];
  return sharedCombos(first.binding, second.binding).map((combo) => describeClash(combo, first, second));
}

/** Keys that mean two things across scopes that are active together. */
export function conflictsIn(scopes: readonly ScopeName[]): string[] {
  const entries = scopedBindingsOf(scopes);
  return entries.flatMap((first, firstIndex) => entries.slice(firstIndex + 1).flatMap((second) => clashesBetween(first, second)));
}

/** The first key of every jump, such as "g". */
export function sequencePrefixes(): string[] {
  return [...SEQUENCE_PREFIXES];
}

function levelRank(scope: ScopeName): number {
  return LEVEL_ORDER.indexOf(scopeSpecOf(scope).level);
}

function isShownWith(scope: ScopeName, active: ReadonlySet<ScopeName>): boolean {
  return (scopeSpecOf(scope).shownWith ?? []).some((other) => active.has(other as ScopeName));
}

/** Active scopes plus their widget lists, in answer order, each once. */
export function scopesForHelp(active: readonly ScopeName[]): ScopeName[] {
  const activeSet = new Set(active);
  const widgetScopes = SCOPE_NAMES.filter((scope) => scopeSpecOf(scope).isDocOnly && isShownWith(scope, activeSet));
  const shown = new Set([...activeSet, ...widgetScopes]);
  return SCOPE_NAMES.filter((scope) => shown.has(scope)).sort((first, second) => levelRank(first) - levelRank(second));
}
