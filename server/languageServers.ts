import path from "node:path";
import { createRequire } from "node:module";

import { writeDartPackageConfigs } from "./dartPackages.ts";
import { LspClient, type LspServerCommand } from "./lspClient.ts";

export type LanguageSpec = {
  id: string;
  label: string;
  extensions: string[];
  languageIdFor: (extension: string) => string;
  server: () => LspServerCommand;
  // - Runs once per checkout before the server starts.
  prepare?: (worktree: string) => Promise<void>;
};

const IDLE_STOP_MS = 15 * 60 * 1000;
const MAX_RUNNING = 3;

const requireFromHere = createRequire(import.meta.url);

function typescriptServer(): LspServerCommand {
  const cli = requireFromHere.resolve("typescript-language-server/lib/cli.mjs");
  const tsserverPath = path.dirname(requireFromHere.resolve("tsserver-typescript/lib/tsserver.js"));
  // - The syntax server answers from one file while the project loads.
  const tsserver = { path: tsserverPath, useSyntaxServer: "never" };
  return { command: process.execPath, args: [cli, "--stdio"], initializationOptions: { tsserver } };
}

const TYPESCRIPT_LANGUAGE_IDS: Record<string, string> = {
  ".ts": "typescript", ".mts": "typescript", ".cts": "typescript", ".tsx": "typescriptreact",
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript", ".jsx": "javascriptreact",
};

const LANGUAGES: LanguageSpec[] = [
  {
    id: "go",
    label: "gopls",
    extensions: [".go"],
    languageIdFor: () => "go",
    server: () => ({ command: "gopls", args: ["serve"] }),
  },
  {
    id: "dart",
    label: "Dart analyzer",
    extensions: [".dart"],
    languageIdFor: () => "dart",
    server: () => ({ command: "dart", args: ["language-server", "--protocol=lsp", "--client-id=review-coach"] }),
    prepare: writeDartPackageConfigs,
  },
  {
    id: "typescript",
    label: "TypeScript",
    extensions: Object.keys(TYPESCRIPT_LANGUAGE_IDS),
    languageIdFor: (extension) => TYPESCRIPT_LANGUAGE_IDS[extension],
    server: typescriptServer,
  },
];

export function languageForFile(filePath: string): LanguageSpec | undefined {
  const extension = path.extname(filePath).toLowerCase();
  return LANGUAGES.find((language) => language.extensions.includes(extension));
}

type RunningServer = { client: Promise<LspClient>; lastUsed: number; isAlive: () => boolean };

const running = new Map<string, RunningServer>();

function stopServer(key: string): void {
  void running.get(key)?.client.then((client) => client.stop(), () => undefined);
  running.delete(key);
}

function stopLeastRecentlyUsed(): void {
  const oldest = [...running.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
  if (oldest) stopServer(oldest[0]);
}

function stopIdleServers(): void {
  const cutoff = Date.now() - IDLE_STOP_MS;
  for (const [key, server] of running) if (server.lastUsed < cutoff || !server.isAlive()) stopServer(key);
}

setInterval(stopIdleServers, 60_000).unref();

async function startServer(worktree: string, language: LanguageSpec): Promise<LspClient> {
  await language.prepare?.(worktree);
  const client = new LspClient(language.server(), worktree);
  await client.ready;
  return client;
}

function startTracked(worktree: string, language: LanguageSpec): RunningServer {
  let startedClient: LspClient | undefined;
  let startFailed = false;
  const client = startServer(worktree, language);
  client.then((started) => (startedClient = started), () => (startFailed = true));
  return { client, lastUsed: Date.now(), isAlive: () => !startFailed && (startedClient?.isAlive ?? true) };
}

/** One server per checkout and language, started on first use. */
export function serverFor(worktree: string, language: LanguageSpec): Promise<LspClient> {
  const key = `${worktree}|${language.id}`;
  const existing = running.get(key);
  if (existing?.isAlive()) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  stopServer(key);
  if (running.size >= MAX_RUNNING) stopLeastRecentlyUsed();
  const server = startTracked(worktree, language);
  running.set(key, server);
  return server.client;
}

/** Starts servers early so the first Ctrl+click is quick. */
export function warmUpServers(worktree: string, filePaths: string[]): void {
  const languages = new Set(filePaths.map(languageForFile).filter((language) => language !== undefined));
  for (const language of languages) serverFor(worktree, language).catch(() => undefined);
}

export function stopAllServers(): void {
  for (const key of [...running.keys()]) stopServer(key);
}
