import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { repoFromRemote, toolsHashOf } from "../server/selfUpdate.ts";

describe("repoFromRemote", () => {
  it("reads owner/name from https and ssh remotes", () => {
    expect(repoFromRemote("https://github.com/acme/review-coach.git")).toBe("acme/review-coach");
    expect(repoFromRemote("https://github.com/acme/review-coach")).toBe("acme/review-coach");
    expect(repoFromRemote("git@github.com:acme/review-coach.git\n")).toBe("acme/review-coach");
  });

  it("gives nothing for other hosts", () => {
    expect(repoFromRemote("https://gitlab.com/acme/review-coach.git")).toBe("");
  });
});

describe("toolsHashOf", () => {
  function folderWith(dockerfile: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tools-"));
    fs.mkdirSync(path.join(root, "docker"));
    fs.writeFileSync(path.join(root, "Dockerfile"), dockerfile);
    fs.writeFileSync(path.join(root, "docker", "entrypoint.sh"), "#!/bin/sh\n");
    return root;
  }

  it("changes only when the image's files change", () => {
    const first = folderWith("FROM node:24\n");
    const same = folderWith("FROM node:24\n");
    const newer = folderWith("FROM node:25\n");
    fs.writeFileSync(path.join(same, "README.md"), "app code changes do not count");
    expect(toolsHashOf(first)).toBe(toolsHashOf(same));
    expect(toolsHashOf(first)).not.toBe(toolsHashOf(newer));
  });
});
