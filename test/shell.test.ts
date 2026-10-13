import { describe, expect, it } from "vitest";

import { runCommand } from "../server/shell.ts";

const quickExitRuns = 500;

describe("runCommand", () => {
  it("survives commands that exit before reading stdin", async () => {
    for (let run = 1; run <= quickExitRuns; run++) {
      const result = await runCommand("true", [], { input: "unread input" });
      expect(result.exitCode).toBe(0);
    }
  });
});
