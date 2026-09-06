#!/usr/bin/env bun

/**
 * PreToolUse — blocks `git commit` when the content it will commit adds prose comments to code.
 * Exit 2 blocks and shows stderr to Claude; every other path exits 0 (fail open).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const CODE_GLOBS = ["*.php", "*.ts", "*.tsx", "*.js", "*.jsx", "*.vue", "*.mjs", "*.cjs"];
const MAX_REGEX_LITERAL = 400;
const MAX_BARE_TOKEN = 24;

const ANNOTATION =
  /^@(param|return|returns|var|throws|template|extends|implements|method|property(-read|-write)?|deprecated|phpstan-|psalm-|type|see|inheritDoc|link|mixin|use)\b/i;

const DIRECTIVE =
  /^(@?ts-(expect-error|ignore|nocheck)|eslint-|oxlint-|oxfmt-|biome-ignore|prettier-ignore|istanbul ignore|[cv]8 ignore|noinspection|webpack[A-Z]|@?vite-ignore|deno-lint-ignore|stylelint-|jscs:|phpcs:|phpstan-ignore|@?codingStandards|type-coverage:|@?phan-)/i;

const IDENTIFIER_DIRECTIVE =
  /^(global|globals|exported|env)\s+[A-Za-z_$][\w$]*(\s*[,:]\s*[A-Za-z_$][\w$]*)*\s*$/;

const CODE_EXAMPLE = /^<[A-Za-z]/;
const CLOSING_TAG = /<\/[A-Za-z][\w.-]*>/;

type Language = "js" | "php" | "vue";

interface CommentSpan {
  line: number;
  text: string;
  block: boolean;
}

interface ToolInput {
  tool_name: string;
  tool_input: { command?: string };
  cwd?: string;
}

function languageOf(path: string): Language | null {
  if (path.endsWith(".php")) return "php";
  if (path.endsWith(".vue")) return "vue";
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path) ? "js" : null;
}

function countLines(text: string): number {
  return (text.match(/\n/g) ?? []).length;
}

/* ------------------------------------------------------------------ lexers */

const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "case", "do", "else",
  "yield", "await", "delete", "void", "throw", "new",
]);

function isRegexStart(previous: string, word: string): boolean {
  if (previous === "") return true;
  if (/[A-Za-z0-9_$]/.test(previous)) return REGEX_KEYWORDS.has(word);
  return !/[)\]'"`.]/.test(previous);
}

function skipRegex(source: string, start: number): number {
  let inClass = false;
  const limit = Math.min(source.length, start + MAX_REGEX_LITERAL);
  for (let i = start + 1; i < limit; i++) {
    const c = source[i]!;
    if (c === "\\") { i++; continue; }
    if (c === "\n") return start;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return start;
}

/** A quote only opens a string when it is closed on the same line; otherwise it is an apostrophe. */
function closesOnLine(source: string, index: number, quote: string): boolean {
  const newline = source.indexOf("\n", index + 1);
  const limit = newline === -1 ? source.length : newline;
  const close = source.indexOf(quote, index + 1);
  return close !== -1 && close < limit;
}

function lexJs(source: string, startLine: number): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let line = startLine;
  let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  let buffer = "";
  let bufferLine = startLine;
  const interpolation: number[] = [];
  let previous = "";
  let word = "";

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    const next = source[i + 1] ?? "";

    if (state === "line") {
      if (c === "\n") {
        spans.push({ line: bufferLine, text: buffer, block: false });
        buffer = ""; state = "code"; line++;
      } else buffer += c;
      continue;
    }

    if (state === "block") {
      if (c === "*" && next === "/") {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; state = "code"; i++; previous = "/"; word = "";
      } else if (c === "\n") {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; line++; bufferLine = line;
      } else buffer += c;
      continue;
    }

    if (state === "sq" || state === "dq") {
      if (c === "\\") { i++; if (source[i] === "\n") line++; continue; }
      if (c === "\n") { line++; state = "code"; continue; }
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"')) {
        state = "code"; previous = c; word = "";
      }
      continue;
    }

    if (state === "tpl") {
      if (c === "\\") { i++; if (source[i] === "\n") line++; continue; }
      if (c === "\n") { line++; continue; }
      if (c === "$" && next === "{") {
        interpolation.push(0); state = "code"; i++; previous = "{"; word = "";
        continue;
      }
      if (c === "`") { state = "code"; previous = c; word = ""; }
      continue;
    }

    if (c === "\n") { line++; continue; }
    if (c === "/" && next === "/") {
      // `https://host` — a scheme colon sits hard against the slashes and no space follows.
      const after = source[i + 2] ?? "";
      if (source[i - 1] === ":" && after !== "" && !/\s/.test(after)) {
        i++; previous = "/"; word = "";
        continue;
      }
      state = "line"; bufferLine = line; buffer = ""; i++;
      continue;
    }
    if (c === "/" && next === "*") { state = "block"; bufferLine = line; buffer = ""; i++; continue; }
    if (c === "'" || c === '"') {
      if (closesOnLine(source, i, c)) { state = c === "'" ? "sq" : "dq"; continue; }
      previous = c; word = "";
      continue;
    }
    if (c === "`") { state = "tpl"; continue; }
    if (c === "/" && isRegexStart(previous, word)) {
      const end = skipRegex(source, i);
      if (end > i) { i = end; previous = "/"; word = ""; continue; }
    }
    if (interpolation.length > 0) {
      if (c === "{") interpolation[interpolation.length - 1]!++;
      else if (c === "}") {
        if (interpolation[interpolation.length - 1] === 0) {
          interpolation.pop(); state = "tpl"; continue;
        }
        interpolation[interpolation.length - 1]!--;
      }
    }
    if (/\s/.test(c)) continue;
    if (/[A-Za-z0-9_$]/.test(c)) word += c; else word = "";
    previous = c;
  }

  if (state === "line" || state === "block") {
    spans.push({ line: bufferLine, text: buffer, block: state === "block" });
  }
  return spans;
}

function lexHtml(source: string, startLine: number): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let line = startLine;
  let inside = false;
  let buffer = "";
  let bufferLine = line;

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (!inside) {
      if (c === "\n") line++;
      else if (source.startsWith("<!--", i)) { inside = true; bufferLine = line; buffer = ""; i += 3; }
      continue;
    }
    if (source.startsWith("-->", i)) {
      spans.push({ line: bufferLine, text: buffer, block: true });
      buffer = ""; inside = false; i += 2;
      continue;
    }
    if (c === "\n") {
      spans.push({ line: bufferLine, text: buffer, block: true });
      buffer = ""; line++; bufferLine = line;
      continue;
    }
    buffer += c;
  }
  if (inside) spans.push({ line: bufferLine, text: buffer, block: true });
  return spans;
}

const SCRIPT_OPEN = /^<script\b[^>]*>/i;

/**
 * Blade comments and echoes live inside `<script>` bodies, where the JS lexer would misread a
 * backtick or quote in their prose and swallow the rest of the file. Lift the comments out and
 * blank both forms, keeping newlines so line numbers still line up.
 */
function blankBlade(body: string, startLine: number, spans: CommentSpan[]): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  let output = "";
  let line = startLine;
  let i = 0;

  while (i < body.length) {
    if (body.startsWith("{{--", i)) {
      const close = body.indexOf("--}}", i + 4);
      const inner = body.slice(i + 4, close === -1 ? body.length : close);
      const end = close === -1 ? body.length : close + 4;
      let commentLine = line;
      for (const piece of inner.split("\n")) {
        spans.push({ line: commentLine, text: piece, block: true });
        commentLine++;
      }
      output += blank(body.slice(i, end));
      line += countLines(body.slice(i, end));
      i = end;
      continue;
    }
    const echo = body.startsWith("{!!", i) ? "!!}" : body.startsWith("{{", i) ? "}}" : null;
    if (echo !== null) {
      const close = body.indexOf(echo, i + 2);
      const end = close === -1 ? body.length : close + echo.length;
      output += blank(body.slice(i, end));
      line += countLines(body.slice(i, end));
      i = end;
      continue;
    }
    if (body[i] === "\n") line++;
    output += body[i];
    i++;
  }
  return output;
}

function lexPhp(source: string, startLine: number): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let line = startLine;
  let state: "html" | "code" | "line" | "block" | "sq" | "dq" | "htmlComment" | "bladeComment" = "html";
  let buffer = "";
  let bufferLine = line;
  let blade = false;

  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;

    if (state === "html") {
      if (c === "\n") { line++; continue; }
      if (source.startsWith("<?", i)) {
        const opener = source.startsWith("<?php", i) ? 5 : source.startsWith("<?=", i) ? 3 : 2;
        i += opener - 1; state = "code"; blade = false;
        continue;
      }
      if (source.startsWith("@php", i) && !/[A-Za-z0-9_]/.test(source[i + 4] ?? "")) {
        i += 3; state = "code"; blade = true;
        continue;
      }
      if (c === "<" && SCRIPT_OPEN.test(source.slice(i, i + 200))) {
        const opener = SCRIPT_OPEN.exec(source.slice(i))![0];
        const bodyStart = i + opener.length;
        const close = source.toLowerCase().indexOf("</script", bodyStart);
        const end = close === -1 ? source.length : close;
        const bodyLine = line + countLines(opener);
        spans.push(...lexJs(blankBlade(source.slice(bodyStart, end), bodyLine, spans), bodyLine));
        line += countLines(source.slice(i, end));
        i = end - 1;
        continue;
      }
      if (source.startsWith("{{--", i)) { state = "bladeComment"; bufferLine = line; buffer = ""; i += 3; continue; }
      if (source.startsWith("<!--", i)) { state = "htmlComment"; bufferLine = line; buffer = ""; i += 3; continue; }
      continue;
    }

    if (state === "htmlComment" || state === "bladeComment") {
      const terminator = state === "htmlComment" ? "-->" : "--}}";
      if (source.startsWith(terminator, i)) {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; state = "html"; i += terminator.length - 1;
        continue;
      }
      if (c === "\n") {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; line++; bufferLine = line;
        continue;
      }
      buffer += c;
      continue;
    }

    if (state === "line") {
      if (source.startsWith("?>", i) || (blade && source.startsWith("@endphp", i))) {
        spans.push({ line: bufferLine, text: buffer, block: false });
        buffer = ""; state = "html"; i += source.startsWith("?>", i) ? 1 : 6;
        continue;
      }
      if (c === "\n") {
        spans.push({ line: bufferLine, text: buffer, block: false });
        buffer = ""; state = "code"; line++;
        continue;
      }
      buffer += c;
      continue;
    }

    if (state === "block") {
      if (source.startsWith("*/", i)) {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; state = "code"; i += 1;
        continue;
      }
      if (c === "\n") {
        spans.push({ line: bufferLine, text: buffer, block: true });
        buffer = ""; line++; bufferLine = line;
        continue;
      }
      buffer += c;
      continue;
    }

    if (state === "sq" || state === "dq") {
      if (c === "\\") { i++; if (source[i] === "\n") line++; continue; }
      if (c === "\n") { line++; continue; }
      if ((state === "sq" && c === "'") || (state === "dq" && c === '"')) state = "code";
      continue;
    }

    if (c === "\n") { line++; continue; }
    if (source.startsWith("?>", i)) { state = "html"; i += 1; continue; }
    if (blade && source.startsWith("@endphp", i)) { state = "html"; i += 6; continue; }
    if (source.startsWith("//", i)) { state = "line"; bufferLine = line; buffer = ""; i += 1; continue; }
    if (source.startsWith("/*", i)) { state = "block"; bufferLine = line; buffer = ""; i += 1; continue; }
    if (c === "#") {
      if (source[i + 1] === "[") { i++; continue; }
      state = "line"; bufferLine = line; buffer = "";
      continue;
    }
    if (c === "'") { state = "sq"; continue; }
    if (c === '"') { state = "dq"; continue; }
    if (source.startsWith("<<<", i)) {
      const opener = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(source.slice(i));
      if (opener) {
        const body = source.slice(i + opener[0].length);
        const closer = new RegExp(`^[ \\t]*${opener[2]}(?![A-Za-z0-9_])`, "m").exec(body);
        const length = opener[0].length + (closer ? closer.index + closer[0].length : body.length);
        line += countLines(source.slice(i, i + length));
        i += length - 1;
      }
    }
  }

  if (state !== "html" && state !== "code" && state !== "sq" && state !== "dq") {
    spans.push({ line: bufferLine, text: buffer, block: state !== "line" });
  }
  return spans;
}

function lineAt(source: string, index: number): number {
  return 1 + countLines(source.slice(0, index));
}

function lexVue(source: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  const opener = /<(script|style)\b[^>]*>/gi;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = opener.exec(source)) !== null) {
    if (match.index < last) continue;
    const tag = match[1]!.toLowerCase();
    const bodyStart = match.index + match[0].length;

    const following = /<(script|style)\b[^>]*>/gi;
    following.lastIndex = bodyStart;
    const nextBlock = following.exec(source);
    const limit = nextBlock ? nextBlock.index : source.length;

    // A string holding "</script>" must not end the block, so take the last closer in range.
    let end = source.lastIndexOf(`</${tag}`, limit);
    if (end < bodyStart) end = limit;

    spans.push(...lexHtml(source.slice(last, match.index), lineAt(source, last)));
    spans.push(...lexJs(source.slice(bodyStart, end), lineAt(source, bodyStart)));

    if (end === limit) last = limit;
    else {
      const close = source.indexOf(">", end);
      last = close === -1 ? source.length : close + 1;
    }
    opener.lastIndex = last;
  }
  spans.push(...lexHtml(source.slice(last), lineAt(source, last)));
  return spans;
}

function lexComments(source: string, language: Language): CommentSpan[] {
  if (language === "php") return lexPhp(source, 1);
  if (language === "vue") return lexVue(source);
  return lexJs(source, 1);
}

/** Returns the prose carried by a comment span, or null when the span is not prose. */
function proseOf(span: CommentSpan): string | null {
  let text = span.block ? span.text.replace(/^\s*\*+/, "") : span.text;
  text = text.trim();

  if (text === "") return null;
  if (text.startsWith("#!")) return null;
  if (ANNOTATION.test(text)) return null;
  if (DIRECTIVE.test(text)) return null;
  if (IDENTIFIER_DIRECTIVE.test(text)) return null;
  if (CODE_EXAMPLE.test(text) && CLOSING_TAG.test(text)) return null;
  if (!/[A-Za-z]/.test(text)) return null;
  if (!/\s/.test(text) && text.length <= MAX_BARE_TOKEN) return null;

  return text;
}

/** Best-effort comment text of a removed line, used only to exempt, never to accuse. */
function removedProseOf(line: string): string | null {
  const marker = /(\/\/|\/\*|<!--|#(?!\[))/.exec(line);
  if (marker === null) return null;
  return line
    .slice(marker.index + marker[0].length)
    .replace(/(\*\/|-->)\s*$/, "")
    .trim();
}

/* ----------------------------------------------------------- command parse */

interface CommitTarget {
  cwd: string;
  all: boolean;
  include: boolean;
  pathspecs: string[];
  override: boolean;
}

const KEYWORDS = new Set([
  "if", "then", "else", "elif", "fi", "do", "done", "while", "until",
  "for", "case", "esac", "select", "!", "{", "}", "(", ")",
]);
const WRAPPERS = new Set([
  "env", "command", "builtin", "exec", "nohup", "nice", "time", "stdbuf",
  "sudo", "doas", "xargs", "timeout", "script",
]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const GIT_GLOBAL_VALUE = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix",
]);
const COMMIT_VALUE_LONG = new Set([
  "--message", "--file", "--reuse-message", "--reedit-message", "--fixup", "--squash",
  "--author", "--date", "--template", "--trailer",
]);
const COMMIT_VALUE_SHORT = new Set(["m", "F", "C", "c", "t"]);

/** Removes heredoc operators and their bodies so message text is never parsed as commands. */
function stripHeredocs(command: string): string {
  const output: string[] = [];
  let terminator: string | null = null;

  for (const line of command.split("\n")) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    let next: string | null = null;
    const cleaned = line.replace(/(?<!<)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g, (_match, _quote, id) => {
      next ??= id;
      return "";
    });
    output.push(cleaned);
    terminator = next;
  }
  return output.join("\n");
}

function substitutions(command: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < command.length - 1; i++) {
    if (command[i] !== "$" || command[i + 1] !== "(") continue;
    let depth = 1;
    let j = i + 2;
    for (; j < command.length && depth > 0; j++) {
      if (command[j] === "(") depth++;
      else if (command[j] === ")") depth--;
    }
    found.push(command.slice(i + 2, j - 1));
    i = j - 1;
  }
  return found;
}

function splitSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;

  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      current += c;
      if (c === "\\" && quote === '"') current += command[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; current += c; continue; }
    if (c === "\\") { current += c + (command[++i] ?? ""); continue; }
    if (c === "$" && command[i + 1] === "(") { depth++; current += "$("; i++; continue; }
    if (depth > 0 && c === "(") { depth++; current += c; continue; }
    if (depth > 0 && c === ")") { depth--; current += c; continue; }
    if (depth === 0 && (c === "\n" || c === ";" || c === "&" || c === "|")) {
      if ((c === "&" && command[i + 1] === "&") || (c === "|" && command[i + 1] === "|")) i++;
      segments.push(current); current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;

  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (quote) {
      if (c === "\\" && quote === '"') { current += segment[++i] ?? ""; started = true; continue; }
      if (c === quote) { quote = null; continue; }
      current += c; started = true;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue; }
    if (c === "\\") {
      const following = segment[++i];
      if (following === "\n" || following === undefined) continue;
      current += following; started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) { tokens.push(current); current = ""; started = false; }
      continue;
    }
    current += c; started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

function resolvePath(path: string, cwd: string): string {
  let value = path;
  if (value === "~" || value.startsWith("~/")) value = homedir() + value.slice(1);
  return isAbsolute(value) ? value : join(cwd, value);
}

function pathspecsFromFile(path: string, cwd: string): string[] {
  try {
    return readFileSync(resolvePath(path, cwd), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function findCommits(command: string, startCwd: string, depth = 0): CommitTarget[] {
  const targets: CommitTarget[] = [];
  if (depth > 3) return targets;

  for (const inner of substitutions(command)) {
    targets.push(...findCommits(inner, startCwd, depth + 1));
  }

  let cwd = startCwd;

  for (const segment of splitSegments(stripHeredocs(command))) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;

    let index = 0;
    let override = false;
    let wrapped = false;
    let nested = false;

    while (index < tokens.length) {
      const stripped = tokens[index]!.replace(/^[({]+/, "");
      if (stripped === "") { index++; continue; }
      tokens[index] = stripped;

      const command = basename(stripped);
      if (command === "git" || stripped === "cd") break;

      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(stripped)) {
        if (stripped === "COMMENT_BUDGET_OK=1") override = true;
        index++; continue;
      }
      if (KEYWORDS.has(stripped)) { index++; continue; }
      if (WRAPPERS.has(command)) { wrapped = true; index++; continue; }
      if (SHELLS.has(command)) {
        const flag = tokens.findIndex((t, at) => at > index && /^-[a-z]*c$/.test(t));
        const inner = flag === -1 ? undefined : tokens[flag + 1];
        if (inner !== undefined) {
          for (const target of findCommits(inner, cwd, depth + 1)) {
            targets.push(override ? { ...target, override: true } : target);
          }
        }
        nested = true;
        break;
      }
      if (wrapped) { index++; continue; }
      break;
    }
    if (nested) continue;

    const name = tokens[index];
    if (name === undefined) continue;

    if (name === "cd") {
      const argument = tokens[index + 1];
      if (argument !== undefined && argument !== "-") cwd = resolvePath(argument, cwd);
      continue;
    }
    if (basename(name) !== "git") continue;

    let gitCwd = cwd;
    let i = index + 1;
    while (i < tokens.length && tokens[i]!.startsWith("-")) {
      const token = tokens[i]!;
      if (token === "-C") {
        const path = tokens[i + 1];
        if (path !== undefined) gitCwd = resolvePath(path, gitCwd);
        i += 2;
        continue;
      }
      i += GIT_GLOBAL_VALUE.has(token) ? 2 : 1;
    }
    if (tokens[i] !== "commit") continue;

    let all = false;
    let include = false;
    let separator = false;
    const pathspecs: string[] = [];

    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j]!;
      if (/^\d?[<>&]/.test(token)) {
        if (/^\d?(&?>>?|<<?)$/.test(token)) j++;
        continue;
      }
      if (token === "--") { separator = true; continue; }
      if (separator) { pathspecs.push(token); continue; }
      if (token.startsWith("--")) {
        const bare = token.split("=")[0]!;
        if (bare === "--all") all = true;
        if (bare === "--include") include = true;
        if (bare === "--pathspec-from-file") {
          const value = token.includes("=") ? token.slice(bare.length + 1) : tokens[++j];
          const listed = value === undefined ? [] : pathspecsFromFile(value, gitCwd);
          // An unreadable list (notably `-`, meaning stdin) leaves the scope unknown,
          // so widen to the whole worktree rather than silently inspecting the index.
          if (listed.length === 0) all = true; else pathspecs.push(...listed);
          continue;
        }
        if (COMMIT_VALUE_LONG.has(bare) && !token.includes("=")) j++;
        continue;
      }
      if (token.startsWith("-") && token.length > 1) {
        const letters = token.slice(1);
        for (let k = 0; k < letters.length; k++) {
          const letter = letters[k]!;
          if (letter === "a") all = true;
          if (letter === "i") include = true;
          if (COMMIT_VALUE_SHORT.has(letter)) {
            // A value attached to the option is not a flag cluster: `-m"add tests"`.
            if (k === letters.length - 1) j++;
            break;
          }
        }
        continue;
      }
      pathspecs.push(token);
    }

    targets.push({ cwd: gitCwd, all, include, pathspecs, override });
  }
  return targets;
}

/* -------------------------------------------------------------------- diff */

const GIT_CONFIG = [
  "-c", "core.quotePath=false",
  "-c", "diff.mnemonicPrefix=false",
  "-c", "diff.noprefix=false",
  "-c", "diff.relative=false",
];
const DIFF_FLAGS = ["-U0", "--no-ext-diff", "--no-textconv", "--text"];

async function git(args: string[], cwd: string): Promise<string | null> {
  const proc = Bun.spawn(["git", ...GIT_CONFIG, ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  const output = await new Response(proc.stdout).text();
  return (await proc.exited) === 0 ? output : null;
}

function unquotePath(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path;
  const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
  const bytes: number[] = [];
  const body = path.slice(1, -1);

  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") { bytes.push(...new TextEncoder().encode(body[i]!)); continue; }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1));
    if (octal) { bytes.push(parseInt(octal[0], 8)); i += 3; continue; }
    const escape = body[++i]!;
    bytes.push(...new TextEncoder().encode(escapes[escape] ?? escape));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

interface ParsedDiff {
  files: Map<string, Map<number, string>>;
  removed: Set<string>;
}

function parseDiff(diff: string): ParsedDiff {
  const files = new Map<string, Map<number, string>>();
  const removed = new Set<string>();
  let added: Map<number, string> | null = null;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const path = unquotePath(line.slice(4).trim());
      if (path === "/dev/null") { added = null; continue; }
      const name = path.startsWith("b/") ? path.slice(2) : path;
      added = files.get(name) ?? new Map<number, string>();
      files.set(name, added);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("diff ")) continue;
    if (line.startsWith("@@")) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) newLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+")) {
      added?.set(newLine, line.slice(1));
      newLine++;
      continue;
    }
    if (line.startsWith("-")) { removed.add(line.slice(1).trim()); continue; }
    if (line.startsWith(" ")) newLine++;
  }

  return { files, removed };
}

interface Scan {
  worktree: boolean;
  scope: string[];
  cwd: string;
}

async function scanOffences(scan: Scan, root: string, base: string, cwd: string): Promise<string[]> {
  const diff = await git(
    scan.worktree
      ? ["diff", base, ...DIFF_FLAGS, "--", ...scan.scope]
      : ["diff", "--cached", base, ...DIFF_FLAGS, "--", ...scan.scope],
    scan.cwd
  );
  if (diff === null) return [];

  const { files, removed } = parseDiff(diff);
  const exempt = new Set(removed);
  for (const line of removed) {
    const prose = removedProseOf(line);
    if (prose !== null && prose !== "") exempt.add(prose);
  }

  const offences: string[] = [];
  for (const [path, added] of files) {
    const language = languageOf(path);
    if (language === null || added.size === 0) continue;

    const source = scan.worktree
      ? await Bun.file(join(root, path)).text().catch(() => null)
      : await git(["show", `:${path}`], cwd);
    if (source === null) continue;

    for (const span of lexComments(source, language)) {
      const raw = added.get(span.line);
      if (raw === undefined) continue;
      const prose = proseOf(span);
      if (prose === null) continue;
      if (exempt.has(raw.trim()) || exempt.has(prose)) continue;
      offences.push(`${path}:${span.line}: ${prose}`);
    }
  }
  return offences;
}

async function offencesFor(target: CommitTarget, sessionCwd: string): Promise<string[]> {
  const cwd = existsSync(target.cwd) ? target.cwd : sessionCwd;
  const root = (await git(["rev-parse", "--show-toplevel"], cwd))?.trim();
  if (!root) return [];

  const base = (await git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd))?.trim() || EMPTY_TREE;
  const scoped = target.pathspecs.length > 0;
  const scans: Scan[] = [];

  // Code globs are cwd-relative, so a commit run from a subdirectory must diff from the root.
  if (scoped) scans.push({ worktree: true, scope: target.pathspecs, cwd });
  else scans.push({ worktree: target.all, scope: CODE_GLOBS, cwd: root });
  // `--include` adds pathspecs to whatever is already staged, so the index is in scope too.
  if (target.include && scoped) scans.push({ worktree: false, scope: CODE_GLOBS, cwd: root });

  const offences: string[] = [];
  for (const scan of scans) offences.push(...await scanOffences(scan, root, base, cwd));
  return offences;
}

async function main(): Promise<void> {
  try {
    const input: ToolInput = await Bun.stdin.json();
    if (input.tool_name !== "Bash") process.exit(0);

    const sessionCwd = input.cwd ?? process.cwd();
    const targets = findCommits(input.tool_input.command ?? "", sessionCwd);
    if (targets.length === 0) process.exit(0);

    const offences = new Set<string>();
    for (const target of targets) {
      if (target.override) continue;
      for (const offence of await offencesFor(target, sessionCwd)) offences.add(offence);
    }
    if (offences.size === 0) process.exit(0);

    console.error(
      `BLOCKED: this commit adds ${offences.size} prose comment line(s) to code.\n\n` +
        [...offences].map((line) => `  ${line}`).join("\n") +
        `\n\nThe standard is almost none — volume is the defect, not accuracy, and the remedy is\n` +
        `deletion, never a shorter rewrite. Rationale belongs in the commit message.\n` +
        `Type annotations (@param, @return, ...) and tooling directives are exempt.\n\n` +
        `Delete them, or if a line genuinely carries a why the code cannot state, say which\n` +
        `and re-run with COMMENT_BUDGET_OK=1 prefixed to the command.`
    );
    process.exit(2);
  } catch {
    process.exit(0);
  }
}

main();
