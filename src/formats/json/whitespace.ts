/**
 * Whitespace-only JSON reformatting.
 *
 * `format` and `minify` never parse values: every string, number, literal and comment is copied
 * to the output character for character, so `1e400`, `12345678901234567890`, `-0.0`, `é`
 * escapes, key order and comments survive exactly (CLAUDE.md rule 1). Only the whitespace between
 * tokens changes. Text with a syntax error is refused (`null`) and left to the diagnostics.
 *
 * Plain TypeScript, no editor dependency.
 */

type Kind = "{" | "}" | "[" | "]" | "," | ":" | "string" | "atom" | "line" | "block";

interface Token {
  kind: Kind;
  text: string;
  /** A line break lies between the previous token and this one (always true for the first). */
  nlBefore: boolean;
}

export interface WhitespaceOptions {
  /** Comments are allowed (JSON with comments). */
  comments: boolean;
  /** A comma before a closing `}` or `]` is allowed, and kept as written. Default false. */
  trailingCommas?: boolean;
}

/** What strict `.json` documents are retried with when they hold only comments or trailing commas. */
export const LENIENT: WhitespaceOptions = { comments: true, trailingCommas: true };

// Raw control characters (U+0000 to U+001F) are not allowed inside a JSON string.
// eslint-disable-next-line no-control-regex
const STRING = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"$/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const LITERALS = new Set(["true", "false", "null"]);

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** Splits the text into tokens, or returns null on anything that is not JSON(C) lexically. */
function tokenise(text: string, comments: boolean): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  let newline = true;
  const n = text.length;
  while (i < n) {
    const ch = text.charAt(i);
    if (isSpace(ch)) {
      if (ch === "\n") newline = true;
      i++;
      continue;
    }
    let kind: Kind;
    let end: number;
    if ("{}[],:".includes(ch)) {
      kind = ch as Kind;
      end = i + 1;
    } else if (ch === '"') {
      kind = "string";
      end = i + 1;
      while (end < n && text.charAt(end) !== '"') end += text.charAt(end) === "\\" ? 2 : 1;
      if (end >= n) return null;
      end++;
      if (!STRING.test(text.slice(i, end))) return null;
    } else if (ch === "/") {
      if (!comments) return null;
      const next = text.charAt(i + 1);
      if (next === "/") {
        kind = "line";
        end = text.indexOf("\n", i);
        if (end < 0) end = n;
      } else if (next === "*") {
        kind = "block";
        end = text.indexOf("*/", i + 2);
        if (end < 0) return null;
        end += 2;
      } else {
        return null;
      }
    } else {
      kind = "atom";
      end = i;
      while (end < n) {
        const c = text.charAt(end);
        if (isSpace(c) || '{}[],:"/'.includes(c)) break;
        end++;
      }
      const word = text.slice(i, end);
      if (!NUMBER.test(word) && !LITERALS.has(word)) return null;
    }
    tokens.push({ kind, text: text.slice(i, end), nlBefore: newline });
    newline = false;
    i = end;
  }
  return tokens;
}

type Expect = "value" | "valueOrEnd" | "keyOrEnd" | "key" | "colon" | "after";

/** Checks the token order against the JSON grammar, without recursion. Comments are skipped. */
function validate(tokens: readonly Token[], trailingCommas: boolean): boolean {
  const stack: ("{" | "[")[] = [];
  let expect: Expect = "value";
  // The last token that is not a comment was a comma.
  let afterComma = false;
  for (const { kind } of tokens) {
    if (kind === "line" || kind === "block") continue;
    const top = stack[stack.length - 1];
    const wasComma = afterComma;
    afterComma = kind === ",";
    if (
      trailingCommas &&
      wasComma &&
      ((kind === "]" && top === "[") || (kind === "}" && top === "{"))
    ) {
      stack.pop();
      expect = "after";
      continue;
    }
    switch (expect) {
      case "value":
      case "valueOrEnd":
        if (kind === "]" && expect === "valueOrEnd" && stack[stack.length - 1] === "[") {
          stack.pop();
          expect = "after";
        } else if (kind === "{") {
          stack.push("{");
          expect = "keyOrEnd";
        } else if (kind === "[") {
          stack.push("[");
          expect = "valueOrEnd";
        } else if (kind === "string" || kind === "atom") {
          expect = "after";
        } else {
          return false;
        }
        break;
      case "keyOrEnd":
      case "key":
        if (kind === "}" && expect === "keyOrEnd") {
          stack.pop();
          expect = "after";
        } else if (kind === "string") {
          expect = "colon";
        } else {
          return false;
        }
        break;
      case "colon":
        if (kind !== ":") return false;
        expect = "value";
        break;
      case "after": {
        const top = stack[stack.length - 1];
        if (top === undefined) return false;
        if (kind === ",") expect = top === "{" ? "key" : "value";
        else if (kind === "}" && top === "{") stack.pop();
        else if (kind === "]" && top === "[") stack.pop();
        else return false;
        break;
      }
    }
  }
  return stack.length === 0 && expect === "after";
}

function parseTokens(text: string, options: WhitespaceOptions): Token[] | null {
  const tokens = tokenise(text, options.comments);
  return tokens !== null && validate(tokens, options.trailingCommas === true) ? tokens : null;
}

const isComment = (token: Token) => token.kind === "line" || token.kind === "block";

/** Does the text end with a line break (after any trailing spaces)? */
const endsWithNewline = (text: string) => /\n[ \t\r]*$/.test(text);

/**
 * Reindents the text with `indent` spaces per level. Empty containers stay `{}` and `[]`; a
 * comment keeps its place: on its own line if it was on its own line, otherwise at the end of the
 * line of the token before it. A final line break is kept if there was one and not added if not.
 */
export function formatJson(
  text: string,
  indent: number,
  options: WhitespaceOptions,
): string | null {
  const tokens = parseTokens(text, options);
  if (tokens === null) return null;
  const unit = " ".repeat(indent);
  const out: string[] = [];
  let depth = 0;
  // A line break is owed before the next token.
  let pending = false;
  // A block comment sat at the start of its line and its line continues.
  let space = false;
  let atLineStart = true;
  // The last token that is not a comment; decides whether a comment stays on the line.
  let last: Kind | null = null;
  let lastWasKey = false;
  const containers: ("{" | "[")[] = [];

  const breakLine = () => {
    out.push("\n", unit.repeat(depth));
    atLineStart = true;
    pending = false;
    space = false;
  };
  const put = (s: string) => {
    out.push(s);
    atLineStart = false;
  };

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k] as Token;
    const { kind } = token;
    if (kind === "line" || kind === "block") {
      const inline = last === ":" || lastWasKey;
      const ownLine = !inline && token.nlBefore;
      if (ownLine) {
        if (out.length > 0 && !atLineStart) breakLine();
        put(token.text);
        const next = tokens[k + 1];
        if (kind === "line" || next === undefined || next.nlBefore) pending = true;
        else space = true;
      } else {
        put(` ${token.text}`);
        if (kind === "line") pending = true;
      }
      continue;
    }

    if (kind === "}" || kind === "]") {
      depth--;
      containers.pop();
      breakLine();
      put(kind);
      last = kind;
      lastWasKey = false;
      continue;
    }
    if (kind === ",") {
      if (pending) breakLine();
      put(",");
      pending = true;
      last = kind;
      lastWasKey = false;
      continue;
    }
    if (kind === ":") {
      if (pending) breakLine();
      put(":");
      last = kind;
      lastWasKey = false;
      continue;
    }

    // A value or a key: string, atom, or the start of a container.
    const top = containers[containers.length - 1];
    const isKey = kind === "string" && top === "{" && (last === "{" || last === ",");
    if (pending) breakLine();
    else if (last === ":" || space) put(" ");
    space = false;
    if (kind === "{" || kind === "[") {
      const close = kind === "{" ? "}" : "]";
      const next = tokens[k + 1];
      if (next !== undefined && next.kind === close) {
        // Empty container: written as `{}` or `[]`.
        put(kind + close);
        k++;
        last = close;
        lastWasKey = false;
        continue;
      }
      put(kind);
      containers.push(kind);
      depth++;
      pending = true;
    } else {
      put(token.text);
    }
    last = kind;
    lastWasKey = isKey;
  }
  if (endsWithNewline(text)) out.push("\n");
  return out.join("");
}

/**
 * Removes the whitespace between tokens. Comments stay: a line comment keeps its line break
 * after it, and a comment that began a line still begins one.
 */
export function minifyJson(text: string, options: WhitespaceOptions): string | null {
  const tokens = parseTokens(text, options);
  if (tokens === null) return null;
  const out: string[] = [];
  let owed = false;
  tokens.forEach((token, k) => {
    if (owed) {
      out.push("\n");
      owed = false;
    }
    if (isComment(token)) {
      if (token.nlBefore && out.length > 0 && out[out.length - 1] !== "\n") out.push("\n");
      out.push(token.text);
      const next = tokens[k + 1];
      if (token.kind === "line" || (next !== undefined && next.nlBefore)) owed = true;
    } else {
      out.push(token.text);
    }
  });
  if (endsWithNewline(text)) out.push("\n");
  return out.join("");
}
