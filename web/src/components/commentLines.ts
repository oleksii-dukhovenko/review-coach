type CommentStyle = { linePrefixes: string[]; hasStarLines?: boolean; blockStart?: string; blockEnd?: string };

const C_STYLE: CommentStyle = { linePrefixes: ["//", "/*"], hasStarLines: true, blockStart: "/*", blockEnd: "*/" };
const HASH_STYLE: CommentStyle = { linePrefixes: ["#"] };
const SQL_STYLE: CommentStyle = { linePrefixes: ["--"], blockStart: "/*", blockEnd: "*/" };
const MARKUP_STYLE: CommentStyle = { linePrefixes: ["//", "/*", "<!--"], hasStarLines: true, blockStart: "/*", blockEnd: "*/" };

// - " * text" and " */" continue a block; "*ptr = 1" is code.
const STAR_LINE = /^\*(\s|\/|$)/;

const STYLE_BY_EXTENSION: Record<string, CommentStyle> = {
  go: C_STYLE, ts: C_STYLE, tsx: C_STYLE, js: C_STYLE, jsx: C_STYLE, mjs: C_STYLE, cjs: C_STYLE,
  dart: C_STYLE, java: C_STYLE, kt: C_STYLE, swift: C_STYLE, css: C_STYLE, scss: C_STYLE, proto: C_STYLE,
  rs: C_STYLE, c: C_STYLE, cpp: C_STYLE, cs: C_STYLE,
  svelte: MARKUP_STYLE, vue: MARKUP_STYLE, html: MARKUP_STYLE,
  py: HASH_STYLE, yml: HASH_STYLE, yaml: HASH_STYLE, sh: HASH_STYLE, bash: HASH_STYLE, toml: HASH_STYLE, rb: HASH_STYLE,
  sql: SQL_STYLE,
};

function styleFor(filePath: string): CommentStyle | undefined {
  return STYLE_BY_EXTENSION[filePath.split(".").pop()?.toLowerCase() ?? ""];
}

function startsWithCommentMarker(trimmed: string, style: CommentStyle): boolean {
  const isStarLine = style.hasStarLines === true && STAR_LINE.test(trimmed);
  return isStarLine || style.linePrefixes.some((prefix) => trimmed.startsWith(prefix));
}

/** True when a block comment is still open at the end of the line. */
function leavesBlockOpen(trimmed: string, style: CommentStyle, wasOpen: boolean): boolean {
  if (!style.blockStart || !style.blockEnd) return false;
  // - Only a line that starts with "/*" opens a block; globs like "src/**/*.ts" do not.
  const opensHere = trimmed.startsWith(style.blockStart);
  if (!wasOpen && !opensHere) return false;
  const closeSearchFrom = opensHere ? style.blockStart.length : 0;
  return !trimmed.includes(style.blockEnd, closeSearchFrom);
}

/** For each line in a run of consecutive lines: is it a whole-line comment? */
export function commentFlags(texts: string[], filePath: string): boolean[] {
  const style = styleFor(filePath);
  if (!style) return texts.map(() => false);
  let isInsideBlock = false;
  return texts.map((text) => {
    const trimmed = text.trim();
    const isComment = trimmed.length > 0 && (isInsideBlock || startsWithCommentMarker(trimmed, style));
    isInsideBlock = leavesBlockOpen(trimmed, style, isInsideBlock);
    return isComment;
  });
}
