import { KvSyntaxError, lex } from "./lex.js";
import type { Token } from "./lex.js";

/**
 * A `"key" "value"` line.
 *
 * Duplicate keys are legal and meaningful in this grammar (a `connections` block repeats
 * an output name once per target), so entries are an ordered array -- never a Map.
 */
export interface KvPair {
  kind: "pair";
  key: string;
  value: string;
  /** Offset of the key's opening quote. */
  start: number;
  /** Offset one past the value's closing quote. */
  end: number;
}

export interface KvBlock {
  kind: "block";
  /** Block name (`solid`, `side`, `entity`); empty for the anonymous blocks of an entity lump. */
  name: string;
  entries: KvNode[];
  /** Offset where the block starts: its name, or its `{` when anonymous. */
  start: number;
  /** Offset one past the closing `}`. */
  end: number;
  /** Offset one past the opening `{`, i.e. where the body begins. */
  bodyStart: number;
  /** Offset of the closing `}`. */
  bodyEnd: number;
}

export type KvNode = KvPair | KvBlock;

/**
 * Parses a KeyValues document into a tree of offset-carrying nodes.
 *
 * Accepts both shapes we need with one code path: named blocks (`entity { ... }`, as in
 * a VMF) and anonymous ones (`{ ... }`, as in a BSP entity lump).
 */
export function parse(source: string): KvNode[] {
  const tokens = lex(source);
  let i = 0;

  function parseEntries(stopAtBrace: boolean): KvNode[] {
    const out: KvNode[] = [];
    for (;;) {
      const t = tokens[i];
      if (!t) {
        if (stopAtBrace) throw new KvSyntaxError("unclosed block", source.length, source);
        return out;
      }
      if (t.kind === "rbrace") {
        if (stopAtBrace) return out;
        throw new KvSyntaxError("unmatched }", t.start, source);
      }
      out.push(parseNode());
    }
  }

  function parseNode(): KvNode {
    const first = tokens[i]!;

    // Anonymous block: `{ ... }` with no preceding name.
    if (first.kind === "lbrace") {
      i++;
      const entries = parseEntries(true);
      const close = expectRbrace(first.start);
      return {
        kind: "block",
        name: "",
        entries,
        start: first.start,
        end: close.end,
        bodyStart: first.end,
        bodyEnd: close.start,
      };
    }

    // Otherwise a string, which is either a block name or the key of a pair.
    i++;
    const next = tokens[i];

    if (next?.kind === "lbrace") {
      i++;
      const entries = parseEntries(true);
      const close = expectRbrace(first.start);
      return {
        kind: "block",
        name: first.value,
        entries,
        start: first.start,
        end: close.end,
        bodyStart: next.end,
        bodyEnd: close.start,
      };
    }

    if (!next || next.kind !== "string") {
      throw new KvSyntaxError(
        `expected a value or { after ${JSON.stringify(first.value)}`,
        first.start,
        source,
      );
    }
    i++;
    return {
      kind: "pair",
      key: first.value,
      value: next.value,
      start: first.start,
      end: next.end,
    };
  }

  function expectRbrace(openedAt: number): Token {
    const t = tokens[i];
    if (!t || t.kind !== "rbrace") {
      throw new KvSyntaxError("unclosed block", openedAt, source);
    }
    i++;
    return t;
  }

  return parseEntries(false);
}

/** First value for `key` in a block, or undefined. */
export function get(block: KvBlock, key: string): string | undefined {
  for (const e of block.entries) {
    if (e.kind === "pair" && e.key === key) return e.value;
  }
  return undefined;
}

/** Every value for `key`, in source order. */
export function getAll(block: KvBlock, key: string): string[] {
  const out: string[] = [];
  for (const e of block.entries) {
    if (e.kind === "pair" && e.key === key) out.push(e.value);
  }
  return out;
}

/** Direct child blocks named `name`. */
export function children(block: KvBlock, name: string): KvBlock[] {
  return block.entries.filter((e): e is KvBlock => e.kind === "block" && e.name === name);
}

/** Every `"key" "value"` pair of a block, in source order, duplicates included. */
export function pairs(block: KvBlock): Array<[string, string]> {
  return block.entries
    .filter((e): e is KvPair => e.kind === "pair")
    .map((p) => [p.key, p.value]);
}
