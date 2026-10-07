import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { config } from "./config.ts";
import type { MainJobKind } from "./jobKinds.ts";
import type { JobStatus, PullRequest } from "./types.ts";

export type JobKind = MainJobKind | "guide";

export type JobRecord = {
  prKey: string;
  kind: JobKind;
  status: JobStatus;
  // - Head sha for walkthroughs, thread fingerprint for triage.
  builtFor: string | null;
  data: unknown;
  error: string | null;
  sessionId: string | null;
  builtAt: string | null;
};

export type AskRecord = {
  id: number;
  prKey: string;
  file: string;
  line: number;
  // - Set when the question was about several lines.
  startLine: number | null;
  question: string;
  answer: string;
  createdAt: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prs (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  in_inbox INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS jobs (
  pr_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  built_for TEXT,
  data TEXT,
  error TEXT,
  session_id TEXT,
  built_at TEXT,
  PRIMARY KEY (pr_key, kind)
);
CREATE TABLE IF NOT EXISTS review_states (
  pr_key TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS asks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_key TEXT NOT NULL,
  file TEXT NOT NULL,
  line INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ask_sessions (
  pr_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some((existing) => existing.name === column);
}

/** Columns added after the first release. */
function addMissingColumns(database: DatabaseSync): void {
  if (!hasColumn(database, "asks", "start_line")) database.exec("ALTER TABLE asks ADD COLUMN start_line INTEGER");
}

function openDatabase(): DatabaseSync {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  const database = new DatabaseSync(config.dbFile);
  database.exec(SCHEMA);
  addMissingColumns(database);
  return database;
}

const database = openDatabase();

export function savePr(pr: PullRequest): void {
  database
    .prepare("INSERT INTO prs (key, data, in_inbox) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET data = excluded.data, in_inbox = 1")
    .run(pr.key, JSON.stringify(pr));
}

export function getPr(prKey: string): PullRequest | undefined {
  const row = database.prepare("SELECT data FROM prs WHERE key = ?").get(prKey) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as PullRequest) : undefined;
}

export function listInboxPrs(): PullRequest[] {
  const rows = database.prepare("SELECT data FROM prs WHERE in_inbox = 1").all() as { data: string }[];
  return rows.map((row) => JSON.parse(row.data) as PullRequest);
}

export function hidePrFromInbox(prKey: string): void {
  database.prepare("UPDATE prs SET in_inbox = 0 WHERE key = ?").run(prKey);
}

export function autoUpdateSettingKey(prKey: string): string {
  return `autoUpdate:${prKey}`;
}

export function deletePrEverywhere(prKey: string): void {
  for (const table of ["jobs", "review_states", "asks", "ask_sessions"]) {
    database.prepare(`DELETE FROM ${table} WHERE pr_key = ?`).run(prKey);
  }
  database.prepare("DELETE FROM settings WHERE key = ?").run(autoUpdateSettingKey(prKey));
  database.prepare("DELETE FROM prs WHERE key = ?").run(prKey);
}

type JobRow = {
  pr_key: string;
  kind: JobKind;
  status: JobStatus;
  built_for: string | null;
  data: string | null;
  error: string | null;
  session_id: string | null;
  built_at: string | null;
};

function toJobRecord(row: JobRow): JobRecord {
  return {
    prKey: row.pr_key,
    kind: row.kind,
    status: row.status,
    builtFor: row.built_for,
    data: row.data ? JSON.parse(row.data) : null,
    error: row.error,
    sessionId: row.session_id,
    builtAt: row.built_at,
  };
}

export function getJob(prKey: string, kind: JobKind): JobRecord | undefined {
  const row = database.prepare("SELECT * FROM jobs WHERE pr_key = ? AND kind = ?").get(prKey, kind) as JobRow | undefined;
  return row ? toJobRecord(row) : undefined;
}

export function setJobStatus(prKey: string, kind: JobKind, status: JobStatus, error: string | null = null): void {
  database
    .prepare(
      `INSERT INTO jobs (pr_key, kind, status, error) VALUES (?, ?, ?, ?)
       ON CONFLICT(pr_key, kind) DO UPDATE SET status = excluded.status, error = excluded.error`,
    )
    .run(prKey, kind, status, error);
}

type FinishedJob = { prKey: string; kind: JobKind; builtFor: string; data: unknown; sessionId: string };

export function saveFinishedJob(job: FinishedJob): void {
  database
    .prepare(
      `INSERT INTO jobs (pr_key, kind, status, built_for, data, error, session_id, built_at)
       VALUES (?, ?, 'ready', ?, ?, NULL, ?, ?)
       ON CONFLICT(pr_key, kind) DO UPDATE SET status = 'ready', built_for = excluded.built_for,
         data = excluded.data, error = NULL, session_id = excluded.session_id, built_at = excluded.built_at`,
    )
    .run(job.prKey, job.kind, job.builtFor, JSON.stringify(job.data), job.sessionId, new Date().toISOString());
  const replacesAskContext = job.kind !== "guide";
  if (replacesAskContext) database.prepare("DELETE FROM ask_sessions WHERE pr_key = ?").run(job.prKey);
}

export function getReviewState(prKey: string): unknown {
  const row = database.prepare("SELECT data FROM review_states WHERE pr_key = ?").get(prKey) as { data: string } | undefined;
  return row ? JSON.parse(row.data) : {};
}

export function saveReviewState(prKey: string, state: unknown): void {
  database
    .prepare("INSERT INTO review_states (pr_key, data) VALUES (?, ?) ON CONFLICT(pr_key) DO UPDATE SET data = excluded.data")
    .run(prKey, JSON.stringify(state));
}

export function listAsks(prKey: string): AskRecord[] {
  const rows = database.prepare("SELECT * FROM asks WHERE pr_key = ? ORDER BY id").all(prKey) as {
    id: number; pr_key: string; file: string; line: number; start_line: number | null; question: string; answer: string; created_at: string;
  }[];
  return rows.map((row) => ({
    id: row.id, prKey: row.pr_key, file: row.file, line: row.line, startLine: row.start_line,
    question: row.question, answer: row.answer, createdAt: row.created_at,
  }));
}

export function saveAsk(ask: Omit<AskRecord, "id" | "createdAt">): void {
  database
    .prepare("INSERT INTO asks (pr_key, file, line, start_line, question, answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ask.prKey, ask.file, ask.line, ask.startLine, ask.question, ask.answer, new Date().toISOString());
}

export function getAskSession(prKey: string): string | undefined {
  const row = database.prepare("SELECT session_id FROM ask_sessions WHERE pr_key = ?").get(prKey) as { session_id: string } | undefined;
  return row?.session_id;
}

export function saveAskSession(prKey: string, sessionId: string): void {
  database
    .prepare("INSERT INTO ask_sessions (pr_key, session_id) VALUES (?, ?) ON CONFLICT(pr_key) DO UPDATE SET session_id = excluded.session_id")
    .run(prKey, sessionId);
}

export function getSetting(key: string): string | undefined {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function saveSetting(key: string, value: string): void {
  database
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/** Jobs cut off by a restart go back to not started. */
export function resetUnfinishedJobs(): void {
  database.prepare("UPDATE jobs SET status = 'none', error = NULL WHERE status IN ('queued', 'building')").run();
}
