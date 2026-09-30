import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import dart from "highlight.js/lib/languages/dart";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

const LANGUAGES = { bash, dart, go, javascript, json, python, sql, typescript, yaml };

for (const [name, definition] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, definition);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  go: "go", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
  dart: "dart", py: "python", sql: "sql", sh: "bash", yml: "yaml", yaml: "yaml", json: "json",
};

export function languageForFile(filePath: string): string | undefined {
  return LANGUAGE_BY_EXTENSION[filePath.split(".").pop() ?? ""];
}

/** Highlights one line; safe HTML because hljs escapes the text. */
export function highlightLine(text: string, language: string | undefined): string {
  if (!language) return escapeHtml(text);
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}

/** Whole-line comments skip code colors and read as comments. */
export function renderCodeLine(text: string, language: string | undefined, isComment: boolean): string {
  if (isComment) return `<span class="hljs-comment">${escapeHtml(text)}</span>`;
  return highlightLine(text, language);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
