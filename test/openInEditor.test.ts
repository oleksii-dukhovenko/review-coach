import { describe, expect, it } from "vitest";

import { diffviewCommand, neovimLink } from "../server/openInEditor.ts";
import type { PullRequest } from "../server/types.ts";

const base = "195af2825a7d4237db0b488087328bddbc93bf81";

describe("diffviewCommand", () => {
  it("opens the whole PR against its merge base", () => {
    expect(diffviewCommand(base)).toBe(`DiffviewOpen ${base}`);
  });

  it("keeps a file path inside a Vim string, so it cannot run commands", () => {
    expect(diffviewCommand(base, "a/it's | !rm.ts")).toBe(`execute 'DiffviewOpen ${base} -- ' . fnameescape('a/it''s | !rm.ts')`);
  });

  it("refuses anything that is not a commit id", () => {
    expect(() => diffviewCommand("main; !rm")).toThrow();
  });
});

describe("neovimLink", () => {
  const pr = { owner: "acme", repo: "shop", number: 42, baseRef: "feature-x" } as PullRequest;

  it("carries the repo, PR, base branch and file, encoded", () => {
    expect(neovimLink(pr, "routes/[store]/+page.svelte")).toBe(
      "review-coach://open?repo=acme%2Fshop&pr=42&base=feature-x&file=routes%2F%5Bstore%5D%2F%2Bpage.svelte",
    );
  });
});
