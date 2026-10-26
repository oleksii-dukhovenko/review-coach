import { describe, expect, it } from "vitest";

import { identifiersOn } from "../web/src/components/wordAtPoint.ts";

describe("identifiersOn", () => {
  it("lists each name once, where it first appears, without keywords or numbers", () => {
    expect(identifiersOn("const fooBar = baz(fooBar, 1)")).toEqual([
      { word: "fooBar", column: 6 },
      { word: "baz", column: 15 },
    ]);
  });

  it("splits names at dots and keeps $ and _", () => {
    expect(identifiersOn("$el.x_y")).toEqual([
      { word: "$el", column: 0 },
      { word: "x_y", column: 4 },
    ]);
  });

  it("gives nothing for an empty line", () => {
    expect(identifiersOn("")).toEqual([]);
  });
});
