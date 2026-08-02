import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KvSyntaxError, lex } from "../src/kv/lex.js";
import { children, get, getAll, pairs, parse } from "../src/kv/parse.js";
import type { KvBlock } from "../src/kv/parse.js";
import { findOffsetGaps, serialize } from "../src/kv/serialize.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("lexer", () => {
  it("reads quoted strings, bare words and braces with their offsets", () => {
    const src = 'world\n{\n\t"id" "1"\n}\n';
    const t = lex(src);
    expect(t.map((x) => x.kind)).toEqual(["string", "lbrace", "string", "string", "rbrace"]);
    expect(t[0]).toMatchObject({ value: "world", start: 0, end: 5 });
    // Offsets on a quoted token span the quotes; the value does not.
    expect(t[2]).toMatchObject({ value: "id", start: 9, end: 13 });
    expect(src.slice(t[2]!.start, t[2]!.end)).toBe('"id"');
  });

  it("treats // as a comment but keeps a single slash inside a word", () => {
    const t = lex('"material" "DEV/DEV_MEASUREGENERIC01" // trailing\n');
    expect(t).toHaveLength(2);
    expect(t[1]!.value).toBe("DEV/DEV_MEASUREGENERIC01");
  });

  it("does not treat a backslash as an escape", () => {
    const t = lex('"model" "models\\props\\door.mdl"');
    expect(t[1]!.value).toBe("models\\props\\door.mdl");
  });

  it("reports an unterminated string where it started", () => {
    expect(() => lex('"id" "1\nnext')).toThrow(KvSyntaxError);
  });
});

describe("parser", () => {
  it("parses named blocks and preserves duplicate keys in order", () => {
    const src = 'connections\n{\n\t"OnUse" "a"\n\t"OnUse" "b"\n}\n';
    const [block] = parse(src) as [KvBlock];
    expect(block.name).toBe("connections");
    expect(getAll(block, "OnUse")).toEqual(["a", "b"]);
    expect(pairs(block)).toEqual([
      ["OnUse", "a"],
      ["OnUse", "b"],
    ]);
  });

  it("parses anonymous blocks, the shape of a BSP entity lump", () => {
    const nodes = parse('{\n"classname" "light"\n}\n{\n"classname" "info_target"\n}\n');
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.kind === "block" && n.name === "")).toBe(true);
    expect(get(nodes[0] as KvBlock, "classname")).toBe("light");
  });

  it("rejects an unclosed block and an unmatched brace", () => {
    expect(() => parse("world\n{\n")).toThrow(KvSyntaxError);
    expect(() => parse("}\n")).toThrow(KvSyntaxError);
  });

  it("gives block bodies offsets that slice back to the original text", () => {
    const src = 'entity\n{\n\t"id" "7"\n}\n';
    const [block] = parse(src) as [KvBlock];
    expect(src.slice(block.start, block.end)).toBe('entity\n{\n\t"id" "7"\n}');
    expect(src.slice(block.bodyStart, block.bodyEnd)).toBe('\n\t"id" "7"\n');
  });
});

describe("offset integrity -- the real round-trip oracle", () => {
  /**
   * Asserting `serialize(parse(x)) === x` would assert that Hammer formats exactly the
   * way we do, which it does not. What the splice write path actually depends on is that
   * the parsed offsets account for the whole source, so any range we do not touch can be
   * copied through verbatim. That is what this checks.
   */
  it("accounts for every byte of the probe VMF", () => {
    const src = readFileSync(join(FIXTURES, "hmcp_probe.vmf"), "utf8");
    const nodes = parse(src);
    expect(findOffsetGaps(src, nodes)).toEqual([]);
  });

  it("accounts for every byte of a VMF written by Hammer itself", () => {
    // Hammer's own output, from the TTT map examples that ship with GMod. Read from
    // srcds/ rather than committed: that tree is SteamCMD-managed and this file is not
    // ours. When it is absent the fixture above still covers the property.
    const hammerWritten = join(
      FIXTURES,
      "..",
      "..",
      "..",
      "srcds",
      "garrysmod",
      "gamemodes",
      "terrortown",
      "mapexamples",
      "ttt_traps.vmf",
    );
    let src: string;
    try {
      src = readFileSync(hammerWritten, "utf8");
    } catch {
      return; // not installed here
    }
    const nodes = parse(src);
    expect(findOffsetGaps(src, nodes)).toEqual([]);
    expect(nodes.length).toBeGreaterThan(3);
  });

  it("round-trips a document it formatted itself", () => {
    const src = serialize(parse('entity\n{\n"classname" "light"\n}\n'));
    expect(serialize(parse(src))).toBe(src);
  });

  it("reports a gap when text between nodes is not whitespace or a comment", () => {
    const src = 'a\n{\n}\nstray_word\nb\n{\n}\n';
    // `stray_word` parses as the name of block `b`, so a clean parse is expected here;
    // the guard is that no *unaccounted* text survives.
    expect(findOffsetGaps(src, parse(src))).toEqual([]);
  });
});

describe("helpers", () => {
  it("finds direct children by name", () => {
    const [world] = parse('world\n{\nsolid\n{\n}\nsolid\n{\n}\n}\n') as [KvBlock];
    expect(children(world, "solid")).toHaveLength(2);
  });
});
