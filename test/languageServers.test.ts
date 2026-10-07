import { describe, expect, it } from "vitest";

import { languageVersionOf, packageNameOf, parsePubspecLock } from "../server/dartPackages.ts";
import { languageForFile } from "../server/languageServers.ts";
import { frame, FrameReader, toLocations } from "../server/lspClient.ts";
import { withHouseStyle } from "../web/src/components/Mermaid.tsx";
import { identifierAround } from "../web/src/components/wordAtPoint.ts";

describe("FrameReader", () => {
  it("reads a message split across chunks", () => {
    const framed = Buffer.from(frame({ id: 1, result: "héllo" }));
    const reader = new FrameReader();
    expect(reader.push(framed.subarray(0, 10))).toEqual([]);
    expect(reader.push(framed.subarray(10))).toEqual([{ jsonrpc: "2.0", id: 1, result: "héllo" }]);
  });

  it("reads two messages from one chunk", () => {
    const reader = new FrameReader();
    const both = Buffer.from(frame({ id: 1 }) + frame({ id: 2 }));
    expect(reader.push(both).map((message) => message.id)).toEqual([1, 2]);
  });
});

describe("toLocations", () => {
  const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

  it("turns location links into locations", () => {
    expect(toLocations([{ targetUri: "file:///a.go", targetSelectionRange: range, targetRange: range }])).toEqual([{ uri: "file:///a.go", range }]);
  });

  it("accepts one location or none", () => {
    expect(toLocations({ uri: "file:///a.go", range })).toHaveLength(1);
    expect(toLocations(null)).toEqual([]);
  });
});

describe("languageForFile", () => {
  it("picks a server by extension", () => {
    expect(languageForFile("cmd/main.go")?.id).toBe("go");
    expect(languageForFile("lib/app.dart")?.id).toBe("dart");
    expect(languageForFile("src/page.tsx")?.id).toBe("typescript");
    expect(languageForFile("src/Page.svelte")).toBeUndefined();
  });
});

describe("Dart package helpers", () => {
  it("reads the lowest SDK version", () => {
    expect(languageVersionOf('name: x\nenvironment:\n  sdk: "3.3.2"\n')).toBe("3.3");
    expect(languageVersionOf("environment:\n  sdk: '>=2.12.0-0 <3.0.0'\n")).toBe("2.12");
    expect(languageVersionOf("environment:\n  flutter: any\n  sdk: ^3.1.0\n")).toBe("3.1");
    expect(languageVersionOf("name: x\n")).toBe("3.0");
  });

  it("reads the package name", () => {
    expect(packageNameOf("name: backoffice\ndescription: x\n")).toBe("backoffice");
  });

  it("reads hosted and sdk packages from a lockfile", () => {
    const lock = `packages:
  get:
    dependency: "direct main"
    description:
      name: get
      url: "https://pub.dev"
    source: hosted
    version: "4.6.6"
  flutter:
    dependency: "direct main"
    description: flutter
    source: sdk
    version: "0.0.0"
sdks:
  dart: ">=3.3.0 <4.0.0"
`;
    expect(parsePubspecLock(lock)).toEqual([
      { name: "get", source: "hosted", version: "4.6.6" },
      { name: "flutter", source: "sdk", version: "0.0.0" },
    ]);
  });
});

describe("withHouseStyle", () => {
  it("adds colors to flowcharts and drops click lines", () => {
    const styled = withHouseStyle('flowchart LR\n  A["Page"]:::changed --> B\n  click A "https://example.com"');
    expect(styled).toContain("classDef changed");
    expect(styled).not.toContain("click A");
  });

  it("leaves other diagram kinds alone", () => {
    expect(withHouseStyle("sequenceDiagram\n  A->>B: hi")).toBe("sequenceDiagram\n  A->>B: hi");
  });
});

describe("identifierAround", () => {
  it("finds the name and where it starts", () => {
    expect(identifierAround("  final bool isWebMode = web_mode.isWebMode();", 40)).toEqual({ word: "isWebMode", column: 34 });
  });

  it("ignores numbers and punctuation", () => {
    expect(identifierAround("x = 42;", 5)).toBeUndefined();
  });
});
