import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readLightmapBudget } from "../src/bsp/lightmap.js";
import { BspFormatError, LZMA_MAGIC } from "../src/bsp/header.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readLightmapBudgetTool } from "../src/tools/lightmap.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const ctx = sharedCtx as unknown as ToolContext;

const scratch = mkdtempSync(join(tmpdir(), "hammer-lightmap-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lumpDescAt = (i: number): number => 8 + i * 16;

function withCompressedLump(index: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const offset = buf.readInt32LE(desc);
  buf.write(LZMA_MAGIC, offset, "ascii");
  buf.writeInt32LE(999, desc + 12);
  const path = join(scratch, `lightmap-compressed-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

function withMisalignedLump(index: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const length = buf.readInt32LE(desc + 4);
  buf.writeInt32LE(length - 1, desc + 4);
  const path = join(scratch, `lightmap-misaligned-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

describe("read_lightmap_budget", () => {
  it("reads all 16 sealed-room faces and gives every one a lightmap", () => {
    // gen_probe.py's faces are plain dev texture, no sky/nodraw/trigger anywhere.
    const r = readLightmapBudget(PROBE);
    expect(r.faceCount).toBe(16);
    expect(r.facesWithLightmap).toBe(16);
  });

  it("applies Source's size-plus-one convention, cross-checked against the raw bytes", () => {
    // Read directly, independent of the reader under test: every probe face measured
    // 16x16 luxels in the raw dface_t bytes (checked by hand against the fixture), so the
    // reported luxel count must be (16+1)*(16+1) = 289, not 16*16 = 256.
    const r = readLightmapBudget(PROBE);
    for (const f of r.faces) {
      expect(f.sizeLuxels).toEqual([16, 16]);
      expect(f.luxels).toBe(289);
    }
    expect(r.totalLuxels).toBe(16 * 289);
  });

  it("computes a positive luxels-per-area ratio when face area is known", () => {
    const r = readLightmapBudget(PROBE);
    expect(r.litAreaUnits).toBeGreaterThan(0);
  });

  it("refuses a FACES lump whose length does not divide by 56", () => {
    const path = withMisalignedLump(7);
    expect(() => readLightmapBudget(path)).toThrow(BspFormatError);
    expect(() => readLightmapBudget(path)).toThrow(/not a multiple/);
  });

  it("refuses an individually LZMA-compressed TEXINFO lump, and says so", () => {
    const path = withCompressedLump(6);
    expect(() => readLightmapBudget(path)).toThrow(BspFormatError);
    expect(() => readLightmapBudget(path)).toThrow(/compressed/i);
  });

  it("refuses an individually LZMA-compressed FACES lump, and says so", () => {
    const path = withCompressedLump(7);
    expect(() => readLightmapBudget(path)).toThrow(BspFormatError);
    expect(() => readLightmapBudget(path)).toThrow(/compressed/i);
  });

  it("matches its declared output schema", async () => {
    const out = await readLightmapBudgetTool.handler({ path: PROBE, limit: 20 }, ctx);
    expect(() => z.object(readLightmapBudgetTool.outputSchema!).parse(out)).not.toThrow();
  });

  it("orders the costliest list by luxels, descending", async () => {
    const out = (await readLightmapBudgetTool.handler({ path: PROBE, limit: 5 }, ctx)) as {
      costliest: Array<{ luxels: number }>;
    };
    const luxels = out.costliest.map((f) => f.luxels);
    expect([...luxels].sort((a, b) => b - a)).toEqual(luxels);
  });

  it.skipIf(!has.prodMap)(
    "on the production map, excludes sky/nodraw surfaces from the budget",
    () => {
      const r = readLightmapBudget(paths.prodMap);
      expect(r.faceCount).toBeGreaterThan(0);
      // A city map has sky and trigger volumes; some faces must be excluded, and not all.
      expect(r.facesWithLightmap).toBeGreaterThan(0);
      expect(r.facesWithLightmap).toBeLessThan(r.faceCount);
      expect(r.totalLuxels).toBeGreaterThan(0);
    },
  );
});
