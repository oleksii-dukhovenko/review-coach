// - React and DOM parts of the keys module.
// - One window listener answers keys for every mounted scope.

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from "react";

import {
  bindingsOf, SCOPE_NAMES, type BoundScopeName, type DocOnlyScopeName, type KeyBinding, type KeyIdOf, type LayerScopeName, type ScopeName,
} from "./keyMap.ts";
import {
  advanceSequence, comboOf, isKeyLeftToTarget, nextTrapIndex, pickBinding, scopesForHelp,
  type BindingCandidate, type PendingPrefix, type TargetLike,
} from "./keyRules.ts";

export type KeyHandler = ((event: KeyboardEvent) => void) | { run: (event: KeyboardEvent) => void; when: () => boolean };
export type HandlersOf<Scope extends BoundScopeName> = Record<KeyIdOf<Scope>, KeyHandler>;
export type UseKeysOptions = { within?: RefObject<HTMLElement | null>; isOn?: boolean };
export type LayerOptions = {
  isOpen: boolean;
  onClose: () => void;
  initialFocus?: () => HTMLElement | null;
  // - Names the panel in the key list.
  scope?: LayerScopeName;
};

type Registration = { scope: BoundScopeName; handlers: RefObject<Record<string, KeyHandler>>; within?: RefObject<HTMLElement | null> };
type Layer = { panel: RefObject<HTMLElement | null>; close: () => void; scope?: LayerScopeName };
type Candidate = BindingCandidate & { run: (event: KeyboardEvent) => void; worksOverPanels?: boolean };

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Process", "Dead"]);
const TAB_STOPS = "a[href], button, input:not([type='hidden']), select, textarea, summary, [tabindex], [contenteditable='true']";

const registrations: Registration[] = [];
const layers: Layer[] = [];
const shownWidgets: DocOnlyScopeName[] = [];
const changeListeners = new Set<() => void>();
let activeScopes: ScopeName[] = [];
let pendingPrefix: PendingPrefix | null = null;

// - Registry of mounted scopes and open panels.

// - Skips the key list's own panel.
function panelUnderKeyList(): Layer | undefined {
  return layers.findLast((layer) => layer.scope !== "keyHelp");
}

function isBoundInside(registration: Registration, panel: HTMLElement | null): boolean {
  const element = registration.within?.current;
  return Boolean(panel && element && panel.contains(element));
}

// - While a panel is open, page keys are off.
function scopesInPanel(layer: Layer): ScopeName[] {
  const panel = layer.panel.current;
  const insideScopes = registrations.filter((registration) => isBoundInside(registration, panel)).map((registration) => registration.scope);
  return layer.scope ? [...insideScopes, layer.scope] : insideScopes;
}

function scopesOnPage(): ScopeName[] {
  return [...registrations.map((registration) => registration.scope), ...shownWidgets];
}

function announceChange(): void {
  const panelLayer = panelUnderKeyList();
  activeScopes = scopesForHelp(panelLayer ? scopesInPanel(panelLayer) : scopesOnPage());
  changeListeners.forEach((listener) => listener());
}

function addTo<Item>(list: Item[], item: Item): () => void {
  list.push(item);
  announceChange();
  return () => {
    const index = list.indexOf(item);
    if (index !== -1) list.splice(index, 1);
    announceChange();
  };
}

function subscribeToScopes(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

function useLatest<Value>(value: Value): RefObject<Value> {
  const latest = useRef(value);
  useLayoutEffect(() => {
    latest.current = value;
  });
  return latest;
}

/** Answers a scope's keys while the component is mounted. */
export function useKeys<Scope extends BoundScopeName>(scope: Scope, handlers: HandlersOf<Scope>, options: UseKeysOptions = {}): void {
  const latestHandlers = useLatest<Record<string, KeyHandler>>(handlers);
  const isOn = options.isOn ?? true;
  useEffect(() => {
    if (!isOn) return;
    return addTo(registrations, { scope, handlers: latestHandlers, within: options.within });
  }, [scope, isOn, options.within]);
}

/** Lists a widget's own keys in the key list while it is mounted. */
export function useWidgetKeys(scope: DocOnlyScopeName, isOn = true): void {
  useEffect(() => {
    if (!isOn) return;
    return addTo(shownWidgets, scope);
  }, [scope, isOn]);
}

/** The scopes the key list shows, in answer order. */
export function useActiveScopes(): ScopeName[] {
  return useSyncExternalStore(subscribeToScopes, () => activeScopes);
}

// - Focus helpers.

/** True when focus has dropped to the page body. */
export function isFocusLost(): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/** Focuses without scrolling; makes the element focusable first if needed. */
export function focusQuietly(element: Element | null | undefined): boolean {
  const isFocusable = element instanceof HTMLElement || element instanceof SVGElement;
  if (!isFocusable) return false;
  if (!element.hasAttribute("tabindex") && element.tabIndex < 0) element.setAttribute("tabindex", "-1");
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

/** Focuses the page title, so the next Tab starts at the top. */
export function focusPageHeading(): void {
  focusQuietly(document.querySelector(".app h1"));
}

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

function isTabStop(element: HTMLElement): boolean {
  const isDisabled = element.matches(":disabled");
  return element.tabIndex >= 0 && !isDisabled && isShown(element);
}

function tabStopsIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(isTabStop);
}

function focusInsidePanel(panel: HTMLElement | null, initialFocus: (() => HTMLElement | null) | undefined): void {
  if (!panel) return;
  focusQuietly(initialFocus?.() ?? tabStopsIn(panel)[0] ?? panel);
}

function isFocusLostOrIn(panel: HTMLElement | null): boolean {
  return isFocusLost() || (panel?.contains(document.activeElement) ?? false);
}

function returnFocus(opener: Element | null, panel: HTMLElement | null): void {
  const isOpenerOnPage = opener?.isConnected ?? false;
  if (isOpenerOnPage && isFocusLostOrIn(panel)) focusQuietly(opener);
}

/** A panel on top: focus moves in, Tab stays in, Escape closes it, focus goes back. */
export function useLayer(panel: RefObject<HTMLElement | null>, options: LayerOptions): void {
  const latestOptions = useLatest(options);
  useEffect(() => {
    if (!options.isOpen) return;
    const opener = document.activeElement;
    const panelElement = panel.current;
    const removeLayer = addTo(layers, { panel, close: () => latestOptions.current.onClose(), scope: options.scope });
    focusInsidePanel(panelElement, latestOptions.current.initialFocus);
    return () => {
      removeLayer();
      returnFocus(opener, panelElement);
    };
  }, [options.isOpen]);
}

// - The dispatcher.

function targetOf(eventTarget: EventTarget | null): TargetLike {
  if (!(eventTarget instanceof Element)) return null;
  return {
    tagName: eventTarget.tagName,
    type: eventTarget instanceof HTMLInputElement ? eventTarget.type : undefined,
    role: eventTarget.getAttribute("role"),
    isContentEditable: eventTarget instanceof HTMLElement && eventTarget.isContentEditable,
  };
}

function isAlreadyHandled(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || MODIFIER_KEYS.has(event.key);
}

function isPlainTab(event: KeyboardEvent): boolean {
  const hasCommandKey = event.ctrlKey || event.metaKey || event.altKey;
  return event.key === "Tab" && !hasCommandKey;
}

function trapTabInTopLayer(event: KeyboardEvent): boolean {
  const panel = layers.at(-1)?.panel.current;
  if (!panel || !isPlainTab(event)) return false;
  const stops = tabStopsIn(panel);
  const index = stops.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  focusQuietly(stops[nextTrapIndex(stops.length, index, event.shiftKey)] ?? panel);
  return true;
}

function comboAfterPrefix(event: KeyboardEvent, target: TargetLike): string | undefined {
  const combo = comboOf(event);
  if (isKeyLeftToTarget(combo, target)) {
    pendingPrefix = null;
    return undefined;
  }
  const step = advanceSequence(pendingPrefix, combo, Date.now());
  pendingPrefix = step.pending;
  return step.combo;
}

function candidateOf(binding: KeyBinding, handler: KeyHandler | undefined): Candidate[] {
  if (!handler) return [];
  const run = typeof handler === "function" ? handler : handler.run;
  const when = typeof handler === "function" ? undefined : handler.when;
  return [{ combos: binding.combos, run, when, worksOverPanels: binding.worksOverPanels }];
}

function candidatesOf(registration: Registration): Candidate[] {
  return bindingsOf(registration.scope).flatMap((binding) => candidateOf(binding, registration.handlers.current[binding.id]));
}

function depthOf(element: Element | null): number {
  let depth = 0;
  for (let parent = element?.parentElement; parent; parent = parent.parentElement) depth++;
  return depth;
}

function withinElementOf(registration: Registration): HTMLElement | null {
  return registration.within?.current ?? null;
}

function holdsFocus(registration: Registration, container: Element | null): boolean {
  const element = withinElementOf(registration);
  const active = document.activeElement;
  if (!element || !active) return false;
  const isInContainer = container === null || container.contains(element);
  return element.contains(active) && isInContainer;
}

/** Scopes tied to the focused element, innermost first; null container means the whole page. */
function focusedRegistrations(container: Element | null): Registration[] {
  const holding = registrations.filter((registration) => holdsFocus(registration, container));
  return holding.sort((first, second) => depthOf(withinElementOf(second)) - depthOf(withinElementOf(first)));
}

function unscopedRegistrations(): Registration[] {
  const unscoped = registrations.filter((registration) => registration.within === undefined);
  return unscoped.sort((first, second) => SCOPE_NAMES.indexOf(first.scope) - SCOPE_NAMES.indexOf(second.scope));
}

function closeCandidate(layer: Layer): Candidate {
  return { combos: ["Escape"], run: () => layer.close() };
}

function candidatesOverPanel(layer: Layer): Candidate[] {
  const panel = layer.panel.current;
  const insidePanel = panel ? focusedRegistrations(panel).flatMap(candidatesOf) : [];
  const overPanels = unscopedRegistrations().flatMap(candidatesOf).filter((candidate) => candidate.worksOverPanels);
  return [...insidePanel, closeCandidate(layer), ...overPanels];
}

function candidatesOnPage(): Candidate[] {
  return [...focusedRegistrations(null), ...unscopedRegistrations()].flatMap(candidatesOf);
}

/** Every binding that may answer now, in answer order. */
function candidatesInOrder(): Candidate[] {
  const topLayer = layers.at(-1);
  return topLayer ? candidatesOverPanel(topLayer) : candidatesOnPage();
}

function dispatchKey(event: KeyboardEvent): void {
  if (isAlreadyHandled(event)) return;
  if (trapTabInTopLayer(event)) return;
  const target = targetOf(event.target);
  const combo = comboAfterPrefix(event, target);
  if (combo === undefined) return;
  const picked = pickBinding(candidatesInOrder(), combo, target);
  if (!picked) return;
  event.preventDefault();
  picked.run(event);
}

/** Listens for keys on the window; call once, in App. */
export function useKeyDispatcher(): void {
  useEffect(() => {
    window.addEventListener("keydown", dispatchKey);
    return () => window.removeEventListener("keydown", dispatchKey);
  }, []);
}
