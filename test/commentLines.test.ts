import { describe, expect, it } from "vitest";

import { commentFlags } from "../web/src/components/commentLines.ts";

describe("commentFlags", () => {
  it("marks every line of a JSDoc block", () => {
    const lines = ["/**", " * Updates the cart.", " * @param order The order", " */", "const updatePrices = async () => {"];
    expect(commentFlags(lines, "cart.ts")).toEqual([true, true, true, true, false]);
  });

  it("continues a block that opened in an earlier line", () => {
    const lines = ["/* starts here", "if this looked like code", "ends here */", "return total;"];
    expect(commentFlags(lines, "a.js")).toEqual([true, true, true, false]);
  });

  it("does not treat a glob as a comment opener", () => {
    expect(commentFlags(['include: ["src/**/*.ts"],', "strict: true,"], "tsconfig.ts")).toEqual([false, false]);
  });

  it("closes a one-line block comment on the same line", () => {
    expect(commentFlags(["/* one line */", "run();"], "a.ts")).toEqual([true, false]);
  });

  it("keeps Go pointer code as code", () => {
    expect(commentFlags(["*count = 0", "// reset the count"], "a.go")).toEqual([false, true]);
  });

  it("leaves code with a trailing comment to the highlighter", () => {
    expect(commentFlags(["const total = 1; // one"], "a.ts")).toEqual([false]);
  });

  it("uses # for YAML and Python", () => {
    expect(commentFlags(["# cache step", "run: npm ci"], "ci.yml")).toEqual([true, false]);
  });

  it("marks nothing for unknown file types", () => {
    expect(commentFlags(["// hi"], "notes.txt")).toEqual([false]);
  });
});
