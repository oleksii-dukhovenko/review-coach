import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "../server/diff.ts";
import { actorOf, lanesOf, stepChange, type FlowStep } from "../web/src/flowLanes.ts";

const HANDLER = {
  ...parseUnifiedDiff(`diff --git a/handler.go b/handler.go
--- a/handler.go
+++ b/handler.go
@@ -10,2 +10,3 @@ func Restore() {
 	job := start()
+	sendHeader()
 	wait(job)
`)[0],
  tag: "normal" as const,
  tagReason: "",
};

function step(overrides: Partial<FlowStep>): FlowStep {
  return { actor: "", label: "x", layer: "logic", file: "handler.go", line: 10, explanation: "", sends: "", ...overrides };
}

describe("lanesOf", () => {
  it("makes one lane per actor, in the order they first act", () => {
    const flow = [step({ actor: "Orchestra" }), step({ actor: "Bridge" }), step({ actor: "Orchestra" })];
    expect(lanesOf(flow)).toEqual(["Orchestra", "Bridge"]);
  });

  it("falls back to the layer for older walkthroughs", () => {
    expect(actorOf(step({ actor: "", layer: "api" }))).toBe("API");
  });
});

describe("stepChange", () => {
  it("knows a line this PR added", () => {
    expect(stepChange(step({ line: 11 }), [HANDLER])).toBe("changed");
  });

  it("knows an untouched line in a changed file", () => {
    expect(stepChange(step({ line: 10 }), [HANDLER])).toBe("same-file");
  });

  it("knows code outside the PR", () => {
    expect(stepChange(step({ file: "job.go" }), [HANDLER])).toBe("existing");
  });
});

describe("handOffOf", async () => {
  const { handOffOf } = await import("../web/src/flowLanes.ts");

  it("hides filler words", () => {
    expect(handOffOf(step({ sends: "nothing" }))).toBe("");
    expect(handOffOf(step({ sends: "job ID" }))).toBe("job ID");
  });
});
