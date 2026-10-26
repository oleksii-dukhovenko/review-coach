import { describe, expect, it } from "vitest";

import {
  advanceSequence, bindingsOf, comboOf, conflictsIn, isTypingTarget, keepCursor, KEYMAP, moveCursor, nextTrapIndex, ownsArrowKeys,
  pickBinding, SCOPE_NAMES, scopeSpecOf, scopesForHelp, sequencePrefixes,
  type KeyEventLike, type ScopeName, type TargetLike,
} from "../web/src/keys.ts";

function press(key: string, held: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held };
}

function element(tagName: string, extras: Partial<NonNullable<TargetLike>> = {}): TargetLike {
  return { tagName, ...extras };
}

const textarea = element("TEXTAREA");
const plainDiv = element("DIV");

describe("comboOf", () => {
  it("writes plain letters as themselves", () => {
    expect(comboOf(press("j"))).toBe("j");
  });

  it("writes Shift+n as N, and ? without Shift+", () => {
    expect(comboOf(press("N", { shiftKey: true }))).toBe("N");
    expect(comboOf(press("?", { shiftKey: true }))).toBe("?");
  });

  it("writes Ctrl+Enter and Cmd+Enter both as Mod+Enter", () => {
    expect(comboOf(press("Enter", { ctrlKey: true }))).toBe("Mod+Enter");
    expect(comboOf(press("Enter", { metaKey: true }))).toBe("Mod+Enter");
  });

  it("writes Shift on named keys, Space by name, and Alt", () => {
    expect(comboOf(press("ArrowDown", { shiftKey: true }))).toBe("Shift+ArrowDown");
    expect(comboOf(press(" "))).toBe("Space");
    expect(comboOf(press("x", { altKey: true }))).toBe("Alt+x");
  });
});

describe("isTypingTarget", () => {
  it("is true for text fields", () => {
    const typingInputTypes = ["text", "search", "email", "url", "number", "password", "tel", undefined];
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(element("SELECT"))).toBe(true);
    expect(isTypingTarget(element("DIV", { isContentEditable: true }))).toBe(true);
    for (const type of typingInputTypes) expect(isTypingTarget(element("INPUT", { type }))).toBe(true);
  });

  it("is false for ticks, buttons and plain elements", () => {
    expect(isTypingTarget(element("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(element("INPUT", { type: "radio" }))).toBe(false);
    expect(isTypingTarget(element("BUTTON"))).toBe(false);
    expect(isTypingTarget(plainDiv)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("ownsArrowKeys", () => {
  it("is true for form controls and arrow-key roles", () => {
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA"]) expect(ownsArrowKeys(element(tagName))).toBe(true);
    for (const role of ["radio", "tab", "listbox", "option", "slider"]) expect(ownsArrowKeys(element("DIV", { role }))).toBe(true);
  });

  it("is false for a link, a heading and the body", () => {
    expect(ownsArrowKeys(element("A"))).toBe(false);
    expect(ownsArrowKeys(element("H1"))).toBe(false);
    expect(ownsArrowKeys(element("BODY"))).toBe(false);
  });
});

describe("picking a binding", () => {
  const nextRow = { name: "next", combos: ["j", "ArrowDown"] };
  const saveComment = { name: "save", combos: ["Mod+Enter"] };

  it("does not fire a plain letter while typing", () => {
    expect(pickBinding([nextRow], "j", textarea)).toBeUndefined();
    expect(pickBinding([nextRow], "j", plainDiv)).toBe(nextRow);
  });

  it("does not fire a plain letter with Ctrl, Cmd or Alt held", () => {
    for (const held of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(pickBinding([nextRow], comboOf(press("j", held)), plainDiv)).toBeUndefined();
    }
  });

  it("fires Mod+Enter only where it is bound, even while typing", () => {
    expect(pickBinding([nextRow], "Mod+Enter", textarea)).toBeUndefined();
    expect(pickBinding([nextRow, saveComment], "Mod+Enter", textarea)).toBe(saveComment);
  });

  it("falls through to the next scope when when() is false", () => {
    const clearRange = { name: "clearRange", combos: ["Escape"], when: () => false };
    const closePanel = { name: "close", combos: ["Escape"] };
    expect(pickBinding([clearRange, closePanel], "Escape", plainDiv)).toBe(closePanel);
  });

  it("leaves arrows to radios and Enter to buttons", () => {
    expect(pickBinding([nextRow], "ArrowDown", element("INPUT", { type: "radio" }))).toBeUndefined();
    expect(pickBinding([{ combos: ["Enter"] }], "Enter", element("BUTTON"))).toBeUndefined();
  });
});

describe("advanceSequence", () => {
  it("joins g then i within 1.5 s", () => {
    const afterG = advanceSequence(null, "g", 1000);
    expect(afterG.combo).toBeUndefined();
    expect(advanceSequence(afterG.pending, "i", 2000)).toEqual({ combo: "g i", pending: null });
  });

  it("forgets g after 1.5 s", () => {
    const afterG = advanceSequence(null, "g", 1000);
    expect(advanceSequence(afterG.pending, "i", 2600).combo).toBe("i");
  });

  it("drops a key that finishes no jump, and clears g", () => {
    const afterG = advanceSequence(null, "g", 1000);
    expect(advanceSequence(afterG.pending, "x", 1100)).toEqual({ combo: undefined, pending: null });
  });

  it("passes a lone key through", () => {
    expect(advanceSequence(null, "i", 1000)).toEqual({ combo: "i", pending: null });
  });
});

describe("moveCursor", () => {
  const rows = ["a", "b", "c"];

  it("moves by one and stops at both ends", () => {
    expect(moveCursor(rows, "a", "next")).toBe("b");
    expect(moveCursor(rows, "c", "next")).toBe("c");
    expect(moveCursor(rows, "b", "previous")).toBe("a");
    expect(moveCursor(rows, "a", "previous")).toBe("a");
  });

  it("goes to the first and last", () => {
    expect(moveCursor(rows, "b", "first")).toBe("a");
    expect(moveCursor(rows, "b", "last")).toBe("c");
  });

  it("starts at an end when nothing is selected", () => {
    expect(moveCursor(rows, undefined, "next")).toBe("a");
    expect(moveCursor(rows, undefined, "previous")).toBe("c");
  });

  it("gives nothing for an empty list", () => {
    expect(moveCursor([], undefined, "next")).toBeUndefined();
  });
});

describe("keepCursor", () => {
  it("keeps a row that is still there", () => {
    expect(keepCursor(["a", "b", "c"], "b", ["c", "b"])).toBe("b");
  });

  it("takes the row now at the same place when the row is gone", () => {
    expect(keepCursor(["a", "b", "c"], "b", ["a", "c"])).toBe("c");
  });

  it("takes the new last row when the last row is gone", () => {
    expect(keepCursor(["a", "b", "c"], "c", ["a", "b"])).toBe("b");
  });

  it("gives nothing when the list is empty", () => {
    expect(keepCursor(["a"], "a", [])).toBeUndefined();
  });
});

describe("nextTrapIndex", () => {
  it("wraps Tab from the last item to the first", () => {
    expect(nextTrapIndex(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first item to the last", () => {
    expect(nextTrapIndex(3, 0, true)).toBe(2);
  });

  it("moves by one in between", () => {
    expect(nextTrapIndex(3, 1, false)).toBe(2);
    expect(nextTrapIndex(3, 1, true)).toBe(0);
  });
});

describe("the key map", () => {
  const scopesActiveTogether: ScopeName[][] = [
    ["everywhere", "inbox"],
    ["everywhere", "pr", "prReview", "overview"],
    ["everywhere", "pr", "prReview", "step", "codeLine"],
    ["everywhere", "pr", "prReview", "files", "codeLine"],
    ["everywhere", "drawer", "drawerLine"],
    ["everywhere", "zoom", "codeLine"],
  ];

  it("gives no key two meanings in scopes that are active together", () => {
    for (const scopes of scopesActiveTogether) expect(conflictsIn(scopes), scopes.join(" + ")).toEqual([]);
  });

  it("finds a clash when one key means two things", () => {
    expect(conflictsIn(["inbox", "step"])).toContain('j: inbox.next "Select the next PR" vs step.lineDown "Move down a code line"');
  });

  it("never binds a jump's first key on its own", () => {
    const prefixes = sequencePrefixes();
    expect(prefixes).toEqual(["g"]);
    for (const scope of SCOPE_NAMES) {
      const combos = bindingsOf(scope).flatMap((binding) => binding.combos);
      expect(combos.filter((combo) => prefixes.includes(combo)), scope).toEqual([]);
    }
  });

  it("uses each id once within a scope", () => {
    for (const scope of SCOPE_NAMES) {
      const ids = bindingsOf(scope).map((binding) => binding.id);
      expect(new Set(ids).size, scope).toBe(ids.length);
    }
  });

  it("shows widget lists only beside real scopes", () => {
    for (const scope of SCOPE_NAMES) {
      for (const other of scopeSpecOf(scope).shownWith ?? []) expect(Object.keys(KEYMAP), scope).toContain(other);
    }
  });

  it("lists help tables in answer order, with the widgets for the page", () => {
    expect(scopesForHelp(["everywhere", "inbox"])).toEqual(["filterBox", "themePicker", "inbox", "everywhere"]);
    expect(scopesForHelp(["everywhere", "codeLine", "step", "codeLine"]).slice(0, 4)).toEqual(["commentBox", "wordPicker", "peek", "themePicker"]);
  });

  it("lists a widget's keys only while that widget is on the page", () => {
    expect(scopesForHelp(["everywhere", "step"])).not.toContain("answerBox");
    expect(scopesForHelp(["everywhere", "step", "answerBox"])).toContain("answerBox");
  });
});
