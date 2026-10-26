// - The keys module: import everything from here.
// - keyMap.ts holds the table, keyRules.ts the pure rules, keysReact.ts the hooks.

export {
  bindingsOf, KEYMAP, SCOPE_NAMES, scopeSpecOf,
  type BoundScopeName, type DocOnlyScopeName, type KeyBinding, type KeyIdOf, type LayerScopeName, type ScopeLevel, type ScopeName, type ScopeSpec,
} from "./keyMap.ts";
export {
  advanceSequence, comboOf, conflictsIn, isKeyLeftToTarget, isTypingTarget, keepCursor, moveCursor, nextTrapIndex, ownsArrowKeys,
  pickBinding, pressesItself, scopesForHelp, SEQUENCE_TIMEOUT_MS, sequencePrefixes,
  type BindingCandidate, type CursorMove, type KeyEventLike, type PendingPrefix, type SequenceStep, type TargetLike,
} from "./keyRules.ts";
export {
  focusPageHeading, focusQuietly, isFocusLost, useActiveScopes, useKeyDispatcher, useKeys, useLayer, useWidgetKeys,
  type HandlersOf, type KeyHandler, type LayerOptions, type UseKeysOptions,
} from "./keysReact.ts";
