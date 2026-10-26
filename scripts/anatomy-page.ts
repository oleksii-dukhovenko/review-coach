// Writes one self-contained HTML page that plays a PR anatomy scene.
// - Usage: npm run anatomy:page -- <scene.json> <out.html> [--light | --dark] [--repo <dir>]
// - The JSON is a scene, or { "scene": ... } as the anatomy job saves it.
// - Without a theme flag the page follows the system setting.
// - The scene goes through the app's own checks first.
// - --repo also checks code lines against that checkout.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

import { lineCountOf } from "../server/fileLines.ts";
import { checkedScene } from "../server/sceneCheck.ts";
import { sceneSchema, type Scene } from "../server/sceneSchema.ts";

type ThemeChoice = "light" | "dark" | "system";

// - repo: checkout whose code lines get checked.
// - null skips the line check.
type Options = { scenePath: string; outPath: string; theme: ThemeChoice; repo: string | null };

type Bundle = { script: string; style: string };

type BuiltFile = { type: "chunk"; code: string } | { type: "asset"; fileName: string; source: string | Uint8Array };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "web/src/anatomy/standalone.tsx");
const USAGE = "Usage: npm run anatomy:page -- <scene.json> <out.html> [--light | --dark] [--repo <dir>]";

const PAGE_CSS = `
.anatomy-page { width: min(880px, 100% - 32px); margin: 32px auto; }
`;

function themeFrom(args: string[]): ThemeChoice {
  if (args.includes("--light")) return "light";
  if (args.includes("--dark")) return "dark";
  return "system";
}

function repoFrom(args: string[]): string | null {
  const flagAt = args.indexOf("--repo");
  return flagAt >= 0 ? (args[flagAt + 1] ?? null) : null;
}

function filesFrom(args: string[]): string[] {
  const repo = repoFrom(args);
  return args.filter((arg) => !arg.startsWith("--") && arg !== repo);
}

function optionsFrom(args: string[]): Options {
  const files = filesFrom(args);
  if (files.length !== 2) throw new Error(USAGE);
  return { scenePath: files[0]!, outPath: files[1]!, theme: themeFrom(args), repo: repoFrom(args) };
}

function isWrapped(json: unknown): json is { scene: unknown } {
  return typeof json === "object" && json !== null && "scene" in json;
}

// - Without a checkout every line range is kept.
function lineCounter(repo: string | null): (file: string) => number {
  return repo ? (file) => lineCountOf(repo, file) : () => Number.MAX_SAFE_INTEGER;
}

/** The scene after the app's checks; stops when they drop it. */
function checkedOrStop(scene: Scene, repo: string | null): Scene {
  const checked = checkedScene(scene, lineCounter(repo));
  if (!checked) throw new Error("The scene needs at least one part and all three steps: before, change, after.");
  const wasChanged = JSON.stringify(checked) !== JSON.stringify(scene);
  if (wasChanged) console.warn("The scene broke the format, so the page shows the fixed version. Compare both and fix the JSON.");
  return checked;
}

async function readScene(file: string, repo: string | null): Promise<Scene> {
  const json: unknown = JSON.parse(await readFile(file, "utf8"));
  const scene = sceneSchema.parse(isWrapped(json) ? json.scene : json);
  return checkedOrStop(scene, repo);
}

function filesOf(result: unknown): BuiltFile[] {
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => (output as { output: BuiltFile[] }).output);
}

/** Bundles the player into one script and one stylesheet, in memory. */
async function bundlePlayer(): Promise<Bundle> {
  const result = await build({
    configFile: false,
    root: path.join(ROOT, "web"),
    logLevel: "warn",
    plugins: [react()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: { write: false, minify: true, cssCodeSplit: false, rollupOptions: { input: ENTRY, output: { format: "iife" } } },
  });
  const files = filesOf(result);
  const script = files.filter(isChunk).map((file) => file.code).join("\n");
  const style = files.filter(isCssAsset).map((file) => String(file.source)).join("\n");
  return { script, style };
}

function isChunk(file: BuiltFile): file is Extract<BuiltFile, { type: "chunk" }> {
  return file.type === "chunk";
}

function isCssAsset(file: BuiltFile): file is Extract<BuiltFile, { type: "asset" }> {
  return file.type === "asset" && file.fileName.endsWith(".css");
}

const safeInScript = (text: string) => text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

function pageHtml(scene: Scene, bundle: Bundle, theme: ThemeChoice): string {
  const data = JSON.stringify({ scene, theme }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${scene.tldr.replace(/[<&"]/g, "")}</title>
<style>${bundle.style}${PAGE_CSS}</style>
</head>
<body>
<div id="root"></div>
<script id="anatomy-data" type="application/json">${data}</script>
<script>${safeInScript(bundle.script)}</script>
</body>
</html>
`;
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  const scene = await readScene(options.scenePath, options.repo);
  const bundle = await bundlePlayer();
  await writeFile(options.outPath, pageHtml(scene, bundle, options.theme));
  console.log(`Wrote ${options.outPath}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
