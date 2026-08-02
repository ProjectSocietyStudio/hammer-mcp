import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEntityText, readEntityLump } from "../src/bsp/entities.js";
import {
  BspFormatError,
  HEADER_BYTES,
  MAP_REVISION_OFFSET,
  readHeader,
} from "../src/bsp/header.js";
import { histogram } from "../src/entity/model.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PROBE = join(FIXTURES, "hmcp_probe.bsp");

describe("BSP header", () => {
  it("reads ident, version and mapRevision from the probe map", () => {
    const h = readHeader(PROBE);
    expect(h.ident).toBe("VBSP");
    expect(h.version).toBe(20);
    // The probe VMF declares mapversion 1, and vbsp copies it into the header.
    expect(h.mapRevision).toBe(1);
    expect(h.lumps).toHaveLength(64);
  });

  it("puts mapRevision at offset 1032, where the .lmp writer looks for it", () => {
    expect(MAP_REVISION_OFFSET).toBe(1032);
    expect(HEADER_BYTES).toBe(1036);
    const raw = readFileSync(PROBE);
    expect(raw.readInt32LE(MAP_REVISION_OFFSET)).toBe(readHeader(PROBE).mapRevision);
  });

  it("names the entity lump and reports a plausible size", () => {
    const lump = readHeader(PROBE).lumps[0]!;
    expect(lump.name).toBe("ENTITIES");
    expect(lump.length).toBeGreaterThan(0);
  });

  it("refuses a file that is not VBSP", () => {
    const path = join(tmpdir(), `hmcp-not-a-bsp-${process.pid}.bsp`);
    const buf = Buffer.alloc(HEADER_BYTES);
    buf.write("XBSP", 0, "ascii");
    writeFileSync(path, buf);
    expect(() => readHeader(path)).toThrow(BspFormatError);
  });

  it("refuses an unsupported version", () => {
    const path = join(tmpdir(), `hmcp-bad-version-${process.pid}.bsp`);
    const buf = Buffer.alloc(HEADER_BYTES);
    buf.write("VBSP", 0, "ascii");
    buf.writeInt32LE(17, 4);
    writeFileSync(path, buf);
    expect(() => readHeader(path)).toThrow(/unsupported BSP version 17/);
  });

  it("refuses a file too short to hold a header", () => {
    const path = join(tmpdir(), `hmcp-short-${process.pid}.bsp`);
    writeFileSync(path, Buffer.alloc(64));
    expect(() => readHeader(path)).toThrow(/too small/);
  });
});

describe("entity lump", () => {
  it("reads the probe map's entities and finds the marker we placed", () => {
    const lump = readEntityLump(PROBE);
    expect(lump.nulTerminated).toBe(true);
    const names = lump.entities.map((e) => e.classname);
    expect(names).toContain("worldspawn");
    expect(names).toContain("info_player_start");
    expect(names).toContain("light");
    const probe = lump.entities.find((e) => e.targetname === "hmcp_probe");
    expect(probe?.classname).toBe("info_target");
    expect(probe?.origin).toEqual([0, 0, 64]);
  });

  it("indexes entities in source order", () => {
    const lump = readEntityLump(PROBE);
    expect(lump.entities.map((e) => e.index)).toEqual(lump.entities.map((_, i) => i));
  });

  it("counts classnames, most frequent first", () => {
    const h = histogram(parseEntityText('{"classname" "a"}{"classname" "b"}{"classname" "a"}'));
    expect(h[0]).toEqual(["a", 2]);
    expect(h[1]).toEqual(["b", 1]);
  });

  it("rejects VMF body text rather than silently reporting zero entities", () => {
    // Handing a VMF to a BSP-entity reader must say so. Returning [] here would read as
    // "this map has no entities" instead of "you gave me the wrong thing".
    expect(() => parseEntityText('world\n{\n"classname" "worldspawn"\n}\n')).toThrow(
      /expected an anonymous/,
    );
  });
});
