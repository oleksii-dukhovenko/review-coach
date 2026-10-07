import { describe, expect, it } from "vitest";

import { checkedNode } from "../server/pictureMap.ts";

const node = { id: "A", file: "src/a.ts", startLine: 10, endLine: 40 };

describe("checkedNode", () => {
  it("keeps a range that fits the file", () => {
    expect(checkedNode(node, 100)).toEqual(node);
  });

  it("clears a box whose file does not exist", () => {
    expect(checkedNode(node, 0)).toEqual({ ...node, file: "", startLine: 0, endLine: 0 });
  });

  it("pulls the range inside the file and puts the end after the start", () => {
    expect(checkedNode({ ...node, startLine: 90, endLine: 5 }, 50)).toEqual({ ...node, startLine: 50, endLine: 50 });
  });
});
