import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readMaterials } from "../src/bsp/materials.js";
import { BspFormatError } from "../src/bsp/header.js";
import { LZMA_MAGIC } from "../src/bsp/header.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readMaterialsTool } from "../src/tools/materials.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const ctx = sharedCtx as unknown as ToolContext;

const scratch = mkdtempSync(join(tmpdir(), "hammer-materials-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lumpDescAt = (i: number): number => 8 + i * 16;

/** Marks lump `index` of a copy of the probe as individually LZMA-compressed. */
function withCompressedLump(index: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const offset = buf.readInt32LE(desc);
  buf.write(LZMA_MAGIC, offset, "ascii");
  buf.writeInt32LE(999, desc + 12);
  const path = join(scratch, `materials-compressed-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

/** Truncates lump `index` by one byte, breaking its divisibility by its record size. */
function withMisalignedLump(index: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const length = buf.readInt32LE(desc + 4);
  buf.writeInt32LE(length - 1, desc + 4);
  const path = join(scratch, `materials-misaligned-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

describe("read_materials", () => {
  it("finds the probe's single material and its full usage count", () => {
    const r = readMaterials(PROBE);
    expect(r.texdataCount).toBe(1);
    // gen_probe.py paints every side with DEV/DEV_MEASUREGENERIC01: all texinfo agree.
    expect(r.materials).toHaveLength(1);
    expect(r.materials[0]!.name).toBe("DEV/DEV_MEASUREGENERIC01");
    expect(r.materials[0]!.usageCount).toBe(r.texinfoCount);
    expect(r.unattributedTexinfo).toBe(0);
  });

  it("reports plausible texture dimensions", () => {
    const r = readMaterials(PROBE);
    expect(r.materials[0]!.width).toBeGreaterThan(0);
    expect(r.materials[0]!.height).toBeGreaterThan(0);
  });

  it("refuses a TEXDATA lump whose length does not divide by 32", () => {
    // TEXDATA lump index.
    const path = withMisalignedLump(2);
    expect(() => readMaterials(path)).toThrow(BspFormatError);
    expect(() => readMaterials(path)).toThrow(/not a multiple/);
  });

  it("refuses an individually LZMA-compressed TEXINFO lump", () => {
    // TEXINFO lump index.
    const path = withCompressedLump(6);
    expect(() => readMaterials(path)).toThrow(BspFormatError);
    expect(() => readMaterials(path)).toThrow(/compressed/i);
  });

  it("filters by name and sorts by name when asked", async () => {
    const out = (await readMaterialsTool.handler(
      { path: PROBE, limit: 200, sortBy: "name", nameContains: "measuregeneric" },
      ctx,
    )) as { materials: Array<{ name: string }> };
    expect(out.materials).toHaveLength(1);

    const empty = (await readMaterialsTool.handler(
      { path: PROBE, limit: 200, sortBy: "name", nameContains: "nope-not-here" },
      ctx,
    )) as { materials: Array<{ name: string }> };
    expect(empty.materials).toHaveLength(0);
  });

  it("matches its declared output schema", async () => {
    const out = await readMaterialsTool.handler(
      { path: PROBE, limit: 200, sortBy: "usage" },
      ctx,
    );
    expect(() => z.object(readMaterialsTool.outputSchema!).parse(out)).not.toThrow();
  });

  it.skipIf(!has.prodMap)(
    "on the production map, material count is consistent with TEXDATA",
    () => {
      const r = readMaterials(paths.prodMap);
      // Distinct names can only be <= texdata entries: two texdata rows can share a name,
      // never the reverse.
      expect(r.materials.length).toBeLessThanOrEqual(r.texdataCount);
      expect(r.texdataCount).toBeGreaterThan(0);
      const totalUsage = r.materials.reduce((a, m) => a + m.usageCount, 0);
      expect(totalUsage + r.unattributedTexinfo).toBe(r.texinfoCount);
    },
  );
});
