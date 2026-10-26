// - Every key in the app, as data.
// - The help list and the dispatcher both read this table.
// - Combos: "j", "N" (Shift+n), "?", "Mod+Enter", "Shift+ArrowDown", "g i" (g, then i).

/** Who answers first: widgets, then the focused element, then panels, the page, everywhere. */
export type ScopeLevel = "widget" | "focused" | "panel" | "page" | "everywhere";

export type KeyBinding = {
  readonly id: string;
  readonly combos: readonly string[];
  readonly label: string;
  // - Shown in the list; the browser does the work.
  readonly nativeCombos?: readonly string[];
  // - Answers only in some states; otherwise the key goes on.
  readonly passesOn?: boolean;
  // - Still works while a panel is open.
  readonly worksOverPanels?: boolean;
};

export type ScopeSpec = {
  readonly title: string;
  readonly level: ScopeLevel;
  readonly bindings: readonly KeyBinding[];
  // - Keys a widget handles itself; listed for help only.
  readonly isDocOnly?: boolean;
  // - A doc-only scope shows while any of these scopes is active.
  // - Without it, the widget lists itself with useWidgetKeys.
  readonly shownWith?: readonly string[];
};

const MOVE_DOWN_A_LINE = "Move down a code line";
const MOVE_UP_A_LINE = "Move up a code line";
const MARK_REVIEWED = "Mark this file reviewed, or not";

export const KEYMAP = {
  commentBox: {
    title: "Comment box", level: "widget", isDocOnly: true, shownWith: ["codeLine"],
    bindings: [
      { id: "save", combos: ["Mod+Enter"], label: "Save the comment" },
      { id: "askClaude", combos: ["Mod+Shift+Enter"], label: "Ask Claude about these lines" },
      { id: "cancel", combos: ["Escape"], label: "Cancel, and go back to the line" },
    ],
  },
  wordPicker: {
    title: "Name list", level: "widget", isDocOnly: true, shownWith: ["codeLine", "drawerLine"],
    bindings: [
      { id: "move", combos: ["j", "k", "ArrowDown", "ArrowUp"], label: "Move between names" },
      { id: "pick", combos: ["Enter"], label: "Show where this name is used" },
      { id: "close", combos: ["Escape"], label: "Close, and go back to the line" },
    ],
  },
  peek: {
    title: "Where is this used", level: "widget", isDocOnly: true, shownWith: ["codeLine", "drawerLine"],
    bindings: [
      { id: "move", combos: ["j", "k", "ArrowDown", "ArrowUp"], label: "Move through the places" },
      { id: "ends", combos: ["Home", "End"], label: "First or last place" },
      { id: "page", combos: ["PageUp", "PageDown"], label: "Ten places at a time" },
      { id: "go", combos: ["Enter"], label: "Go there" },
      { id: "close", combos: ["Escape"], label: "Close, and go back to the line" },
    ],
  },
  answerBox: {
    title: "Answer box", level: "widget", isDocOnly: true,
    bindings: [
      { id: "send", combos: ["Enter"], label: "Send" },
      { id: "newLine", combos: ["Shift+Enter"], label: "New line" },
      { id: "cancel", combos: ["Escape"], label: "Cancel, and go back to the Answer button" },
    ],
  },
  yourReview: {
    title: "Your review", level: "widget", isDocOnly: true,
    bindings: [{ id: "submit", combos: ["Mod+Enter"], label: "Submit the review (asks you first)" }],
  },
  bigPicture: {
    title: "Big-picture box", level: "widget", isDocOnly: true,
    bindings: [{ id: "open", combos: ["Enter", "Space"], label: "Look inside" }],
  },
  flow: {
    title: "How it runs", level: "widget", isDocOnly: true,
    bindings: [
      { id: "move", combos: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "j", "k"], label: "Move between flow steps" },
      { id: "ends", combos: ["Home", "End"], label: "First or last flow step" },
    ],
  },
  train: {
    title: "Train drawing", level: "widget", isDocOnly: true,
    bindings: [
      { id: "links", combos: ["Enter", "Space"], label: "Go to this part's PR links" },
      { id: "back", combos: ["Escape"], label: "From the links, go back to the part" },
    ],
  },
  filterBox: {
    title: "In the filter box", level: "widget", isDocOnly: true, shownWith: ["inbox"],
    bindings: [
      { id: "toResults", combos: ["ArrowDown"], label: "Go to the first result" },
      { id: "openOnly", combos: ["Enter"], label: "Go to the first result; open it when only one PR matches" },
      { id: "clear", combos: ["Escape"], label: "Clear the filter; when empty, go back to the list" },
    ],
  },
  askBox: {
    title: "Ask box (your own PR)", level: "widget", isDocOnly: true,
    bindings: [{ id: "close", combos: ["Escape"], label: "Close, and go back to Ask about this" }],
  },
  replyBox: {
    title: "Reply box (your own PR)", level: "widget", isDocOnly: true,
    bindings: [{ id: "post", combos: ["Mod+Enter"], label: "Post the reply (asks you first)" }],
  },
  themePicker: {
    title: "Theme picker", level: "widget", isDocOnly: true, shownWith: ["everywhere"],
    bindings: [{ id: "choose", combos: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], label: "Choose the theme" }],
  },
  codeLine: {
    title: "On a code line", level: "focused",
    bindings: [
      { id: "down", combos: ["j", "ArrowDown"], label: MOVE_DOWN_A_LINE },
      { id: "up", combos: ["k", "ArrowUp"], label: MOVE_UP_A_LINE },
      { id: "oldSide", combos: ["h", "ArrowLeft"], label: "Move to the old code (left)" },
      { id: "newSide", combos: ["l", "ArrowRight"], label: "Move to the new code (right)" },
      { id: "growDown", combos: ["J", "Shift+ArrowDown"], label: "Pick one more line below" },
      { id: "growUp", combos: ["K", "Shift+ArrowUp"], label: "Pick one more line above" },
      { id: "comment", combos: ["Enter", "c"], label: "Comment on this line, or on the picked lines" },
      { id: "uses", combos: ["r"], label: "Show where a name on this line is used" },
      { id: "openFile", combos: ["o"], label: "Open the whole file at this line (new code only)", passesOn: true },
      { id: "fullDiff", combos: ["z"], label: "Show the full diff, or fold it again" },
      { id: "clearRange", combos: ["Escape"], label: "Drop the picked lines", passesOn: true },
    ],
  },
  drawerLine: {
    title: "On a line in the whole file", level: "focused",
    bindings: [
      { id: "down", combos: ["j", "ArrowDown"], label: "Move down a line" },
      { id: "up", combos: ["k", "ArrowUp"], label: "Move up a line" },
      { id: "uses", combos: ["r"], label: "Show where a name on this line is used" },
    ],
  },
  keyHelp: {
    title: "Key list", level: "panel",
    bindings: [{ id: "close", combos: ["Escape"], label: "Close the list" }],
  },
  drawer: {
    title: "Whole-file drawer", level: "panel",
    bindings: [{ id: "close", combos: ["Escape"], label: "Close the drawer" }],
  },
  zoom: {
    title: "Zoomed picture", level: "panel",
    bindings: [{ id: "close", combos: ["Escape"], label: "Zoom out" }],
  },
  inbox: {
    title: "Inbox", level: "page",
    bindings: [
      { id: "next", combos: ["j", "ArrowDown"], label: "Select the next PR" },
      { id: "previous", combos: ["k", "ArrowUp"], label: "Select the previous PR" },
      { id: "first", combos: ["Home"], label: "Select the first PR" },
      { id: "last", combos: ["End"], label: "Select the last PR" },
      { id: "open", combos: ["o"], nativeCombos: ["Enter"], label: "Open the selected PR" },
      { id: "prepare", combos: ["U"], label: "Prepare, update or retry the selected PR" },
      { id: "github", combos: ["v"], label: "Open the selected PR on GitHub" },
      { id: "section1", combos: ["1"], label: "Show Review requests" },
      { id: "section2", combos: ["2"], label: "Show Waiting on you" },
      { id: "section3", combos: ["3"], label: "Show Drafts to finish" },
      { id: "section4", combos: ["4"], label: "Show No reviewer yet" },
      { id: "section5", combos: ["5"], label: "Show Approved" },
      { id: "section6", combos: ["6"], label: "Show Waiting on others" },
      { id: "cycleShow", combos: ["s"], label: "Switch the Show filter: All, Ready, Not prepared" },
      { id: "refresh", combos: ["r"], label: "Check GitHub now" },
      { id: "focusFilter", combos: ["/"], label: "Put the cursor in the filter box" },
      { id: "closeMenu", combos: ["Escape"], label: "Close the open menu", passesOn: true },
    ],
  },
  overview: {
    title: "Overview", level: "page",
    bindings: [
      { id: "mainAction", combos: ["n"], label: "Start reading, continue, or finish the review" },
      { id: "step1", combos: ["1"], label: "Open step 1" },
      { id: "step2", combos: ["2"], label: "Open step 2" },
      { id: "step3", combos: ["3"], label: "Open step 3" },
      { id: "step4", combos: ["4"], label: "Open step 4" },
      { id: "step5", combos: ["5"], label: "Open step 5" },
      { id: "step6", combos: ["6"], label: "Open step 6" },
      { id: "step7", combos: ["7"], label: "Open step 7" },
      { id: "step8", combos: ["8"], label: "Open step 8" },
      { id: "step9", combos: ["9"], label: "Open step 9" },
      { id: "focusPicture", combos: ["b"], label: "Go to the big picture" },
    ],
  },
  step: {
    title: "Step", level: "page",
    bindings: [
      { id: "next", combos: ["n"], label: "Next step" },
      { id: "previous", combos: ["p"], label: "Previous step" },
      { id: "finishStep", combos: ["N"], label: "Finish the step: mark its files reviewed, go on" },
      { id: "lineDown", combos: ["j"], label: MOVE_DOWN_A_LINE },
      { id: "lineUp", combos: ["k"], label: MOVE_UP_A_LINE },
      { id: "nextFile", combos: ["]"], label: "Next file" },
      { id: "previousFile", combos: ["["], label: "Previous file" },
      { id: "nextQuestion", combos: ["q"], label: "Next open question" },
      { id: "previousQuestion", combos: ["Q"], label: "Previous open question" },
      { id: "markReviewed", combos: ["m"], label: MARK_REVIEWED },
    ],
  },
  files: {
    title: "All files", level: "page",
    bindings: [
      { id: "lineDown", combos: ["j"], label: MOVE_DOWN_A_LINE },
      { id: "lineUp", combos: ["k"], label: MOVE_UP_A_LINE },
      { id: "nextFile", combos: ["]"], label: "Next file" },
      { id: "previousFile", combos: ["["], label: "Previous file" },
      { id: "markReviewed", combos: ["m"], label: MARK_REVIEWED },
    ],
  },
  prReview: {
    title: "Jump to", level: "page",
    bindings: [
      { id: "goOverview", combos: ["g o"], label: "Go to the overview" },
      { id: "goSteps", combos: ["g s"], label: "Go to the first step not yet read" },
      { id: "goFiles", combos: ["g f"], label: "Go to all files" },
      { id: "goFinish", combos: ["g d"], label: "Go to Finish" },
    ],
  },
  pr: {
    title: "This PR", level: "page",
    bindings: [
      { id: "github", combos: ["v"], label: "Open the PR on GitHub" },
      { id: "prepare", combos: ["U"], label: "Prepare, update or retry this PR" },
    ],
  },
  everywhere: {
    title: "Everywhere", level: "everywhere",
    bindings: [
      { id: "help", combos: ["?"], label: "Show the keys for this page", worksOverPanels: true },
      { id: "goInbox", combos: ["g i"], label: "Go to the inbox" },
    ],
  },
} as const satisfies Record<string, ScopeSpec>;

type KeyMap = typeof KEYMAP;

export type ScopeName = keyof KeyMap;
export type KeyIdOf<Scope extends ScopeName> = KeyMap[Scope]["bindings"][number]["id"];

/** Scopes a widget handles itself; shown in the help list only. */
export type DocOnlyScopeName = { [Scope in ScopeName]: KeyMap[Scope] extends { isDocOnly: true } ? Scope : never }[ScopeName];
/** Panels opened with useLayer; their Escape closes them. */
export type LayerScopeName = { [Scope in ScopeName]: KeyMap[Scope]["level"] extends "panel" ? Scope : never }[ScopeName];
/** Scopes a component binds with useKeys. */
export type BoundScopeName = Exclude<ScopeName, DocOnlyScopeName | LayerScopeName>;

export const SCOPE_NAMES = Object.keys(KEYMAP) as ScopeName[];

export function scopeSpecOf(scope: ScopeName): ScopeSpec {
  return KEYMAP[scope];
}

export function bindingsOf(scope: ScopeName): readonly KeyBinding[] {
  return scopeSpecOf(scope).bindings;
}
