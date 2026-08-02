/**
 * Lexer for Valve KeyValues, the grammar shared by `.vmf` files and a BSP's entity
 * lump. Every token carries its source offsets, because the write path splices ranges
 * of the original text rather than reserialising a parsed model.
 */

export type TokenKind = "string" | "lbrace" | "rbrace";

export interface Token {
  kind: TokenKind;
  /** Unquoted text for a `string` token; `{` or `}` otherwise. */
  value: string;
  /** Offset of the token in the source, including its opening quote. */
  start: number;
  /** Offset one past the token, including its closing quote. */
  end: number;
}

export class KvSyntaxError extends Error {
  constructor(
    message: string,
    readonly offset: number,
    source: string,
  ) {
    super(`${message} at offset ${offset} (line ${lineOf(source, offset)})`);
    this.name = "KvSyntaxError";
  }
}

/** 1-based line number of `offset`, for error messages only. */
export function lineOf(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

const WHITESPACE = new Set([" ", "\t", "\r", "\n"]);

/**
 * Tokenises `source`.
 *
 * Handles the three things Valve's own files actually contain: quoted strings,
 * bare words (block names in a VMF are unquoted), and `//` line comments. There are no
 * escape sequences in this grammar -- a backslash inside a quoted string is a literal
 * backslash, which is exactly how material paths like `DEV/DEV_MEASUREGENERIC01` and
 * Windows-style model paths survive a round trip.
 */
export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i]!;

    if (WHITESPACE.has(c)) {
      i++;
      continue;
    }

    // Line comment. `/` not followed by `/` is a legal bare-word character (it shows up
    // in material paths), so only a doubled slash starts a comment.
    if (c === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }

    if (c === "{") {
      tokens.push({ kind: "lbrace", value: "{", start: i, end: i + 1 });
      i++;
      continue;
    }

    if (c === "}") {
      tokens.push({ kind: "rbrace", value: "}", start: i, end: i + 1 });
      i++;
      continue;
    }

    if (c === '"') {
      const start = i;
      i++;
      const from = i;
      while (i < source.length && source[i] !== '"') {
        // A newline inside a quoted string means the closing quote is missing; say so
        // where it started rather than swallowing the rest of the file.
        if (source[i] === "\n") {
          throw new KvSyntaxError("unterminated quoted string", start, source);
        }
        i++;
      }
      if (i >= source.length) {
        throw new KvSyntaxError("unterminated quoted string", start, source);
      }
      tokens.push({ kind: "string", value: source.slice(from, i), start, end: i + 1 });
      i++;
      continue;
    }

    // Bare word: runs to whitespace, a brace, or a comment.
    const start = i;
    while (i < source.length) {
      const d = source[i]!;
      if (WHITESPACE.has(d) || d === "{" || d === "}" || d === '"') break;
      if (d === "/" && source[i + 1] === "/") break;
      i++;
    }
    if (i === start) {
      throw new KvSyntaxError(`unexpected character ${JSON.stringify(c)}`, i, source);
    }
    tokens.push({ kind: "string", value: source.slice(start, i), start, end: i });
  }

  return tokens;
}
