// Writes one self-contained HTML page that plays a PR anatomy scene.
// - Usage: npm run anatomy:page -- <scene.json> <out.html> [--light | --dark]
// - The JSON is a scene, or { "scene": ... } as the anatomy job saves it.
// - Without a theme flag the page follows the system setting.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { build } from "vite";

import { sceneSchema, type Scene } from "../server/sceneSchema.ts";

type ThemeChoice = "light" | "dark" | "system";

type Options = { scenePath: string; outPath: string; theme: ThemeChoice };

type Bundle = { script: string; style: string };

type BuiltFile = { type: "chunk"; code: string } | { type: "asset"; fileName: string; source: string | Uint8Array };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "web/src/anatomy/standalone.tsx");
const USAGE = "Usage: npm run anatomy:page -- <scene.json> <out.html> [--light | --dark]";

const PAGE_CSS = `
.anatomy-page { width: min(880px, 100% - 32px); margin: 32px auto; }
`;

function optionsFrom(args: string[]): Options {
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length !== 2) throw new Error(USAGE);
  const theme: ThemeChoice = args.includes("--light") ? "light" : args.includes("--dark") ? "dark" : "system";
  return { scenePath: files[0]!, outPath: files[1]!, theme };
}

async function readScene(file: string): Promise<Scene> {
  const json: unknown = JSON.parse(await readFile(file, "utf8"));
  const isWrapped = typeof json === "object" && json !== null && "scene" in json;
  return sceneSchema.parse(isWrapped ? (json as { scene: unknown }).scene : json);
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
  const script = files.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
  const style = files.flatMap((file) => (file.type === "asset" && file.fileName.endsWith(".css") ? [String(file.source)] : [])).join("\n");
  return { script, style };
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
  const scene = await readScene(options.scenePath);
  const bundle = await bundlePlayer();
  await writeFile(options.outPath, pageHtml(scene, bundle, options.theme));
  console.log(`Wrote ${options.outPath}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
