import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export type LspPosition = { line: number; character: number };

export type LspLocation = { uri: string; range: { start: LspPosition; end: LspPosition } };

type LspLocationLink = { targetUri: string; targetSelectionRange: LspLocation["range"] };

export type LspServerCommand = {
  command: string;
  args: string[];
  initializationOptions?: object;
};

type PendingRequest = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

type RpcMessage = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string } };

const HEADER_END = "\r\n\r\n";

/** Splits a byte stream into Content-Length framed JSON messages. */
export class FrameReader {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): RpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: RpcMessage[] = [];
    for (let message = this.nextMessage(); message; message = this.nextMessage()) messages.push(message);
    return messages;
  }

  private nextMessage(): RpcMessage | undefined {
    const headerEnd = this.buffer.indexOf(HEADER_END);
    if (headerEnd === -1) return undefined;
    const bodyLength = contentLengthOf(this.buffer.subarray(0, headerEnd).toString("ascii"));
    const bodyStart = headerEnd + HEADER_END.length;
    if (this.buffer.length < bodyStart + bodyLength) return undefined;
    const body = this.buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8");
    this.buffer = this.buffer.subarray(bodyStart + bodyLength);
    return JSON.parse(body) as RpcMessage;
  }
}

function contentLengthOf(header: string): number {
  const match = header.match(/Content-Length:\s*(\d+)/i);
  if (!match) throw new Error(`Language server sent a frame without Content-Length: ${header}`);
  return Number(match[1]);
}

export function frame(message: object): string {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message });
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}${HEADER_END}${body}`;
}

export function fileUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

/** Locations and location links both become plain locations. */
export function toLocations(result: unknown): LspLocation[] {
  if (!result) return [];
  const items = Array.isArray(result) ? result : [result];
  return items.map((item: LspLocation | LspLocationLink) =>
    "targetUri" in item ? { uri: item.targetUri, range: item.targetSelectionRange } : item,
  );
}

/** Replies the server expects from any client; null means "nothing to add". */
function answerServerRequest(method: string, params: unknown): unknown {
  if (method !== "workspace/configuration") return null;
  return ((params as { items?: unknown[] })?.items ?? []).map(() => null);
}

/** One running language server, talking JSON-RPC over stdio. */
export class LspClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly reader = new FrameReader();
  private readonly pending = new Map<number, PendingRequest>();
  private readonly openedFiles = new Set<string>();
  private nextId = 1;
  private exited = false;
  readonly ready: Promise<void>;

  constructor(server: LspServerCommand, private readonly rootPath: string) {
    this.child = spawn(server.command, server.args, { cwd: rootPath, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (chunk: Buffer) => this.reader.push(chunk).forEach((message) => this.handle(message)));
    this.child.stderr.on("data", () => undefined);
    this.child.on("error", (error) => this.failEverything(error));
    this.child.on("exit", (code) => this.failEverything(new Error(`Language server exited with code ${code}`)));
    this.child.stdin.on("error", () => undefined);
    this.ready = this.initialize(server.initializationOptions);
  }

  get isAlive(): boolean {
    return !this.exited;
  }

  private async initialize(initializationOptions: object | undefined): Promise<void> {
    const rootUri = fileUri(this.rootPath);
    await this.request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: "pr" }],
      capabilities: {
        textDocument: { references: {}, definition: { linkSupport: true }, synchronization: {} },
        workspace: { workspaceFolders: true, configuration: true },
        window: { workDoneProgress: false },
      },
      initializationOptions,
    }, 60_000);
    this.notify("initialized", {});
  }

  private handle(message: RpcMessage): void {
    const isServerRequest = message.method !== undefined && message.id !== undefined;
    if (isServerRequest) {
      this.send({ id: message.id, result: answerServerRequest(message.method!, message.params) });
      return;
    }
    if (typeof message.id !== "number") return;
    const waiting = this.pending.get(message.id);
    if (!waiting) return;
    this.pending.delete(message.id);
    clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error.message));
    else waiting.resolve(message.result);
  }

  private send(message: object): void {
    if (!this.exited) this.child.stdin.write(frame(message));
  }

  private failEverything(error: Error): void {
    this.exited = true;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LspTimeoutError(method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  openFile(absolutePath: string, languageId: string): void {
    if (this.openedFiles.has(absolutePath)) return;
    this.openedFiles.add(absolutePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    this.notify("textDocument/didOpen", { textDocument: { uri: fileUri(absolutePath), languageId, version: 1, text } });
  }

  async references(absolutePath: string, position: LspPosition, timeoutMs: number): Promise<LspLocation[]> {
    const params = { textDocument: { uri: fileUri(absolutePath) }, position, context: { includeDeclaration: true } };
    return toLocations(await this.request("textDocument/references", params, timeoutMs));
  }

  async definition(absolutePath: string, position: LspPosition, timeoutMs: number): Promise<LspLocation[]> {
    const params = { textDocument: { uri: fileUri(absolutePath) }, position };
    return toLocations(await this.request("textDocument/definition", params, timeoutMs));
  }

  stop(): void {
    if (this.exited) return;
    this.exited = true;
    this.child.kill();
  }
}

export class LspTimeoutError extends Error {
  constructor(method: string) {
    super(`Language server did not answer ${method} in time`);
  }
}
