import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { BspFormatError, LZMA_MAGIC } from "../src/bsp/header.js";
import { readVisleafStats } from "../src/bsp/visleaf.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readVisleafStatsTool } from "../src/tools/visleaf.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const ctx = sharedCtx as unknown as ToolContext;

const scratch = mkdtempSync(join(tmpdir(), "hammer-visleaf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lumpDescAt = (i: number): number => 8 + i * 16;
const LUMP_LEAFS = 10;
const LUMP_VISIBILITY = 4;

function withCompressedLump(index: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const offset = buf.readInt32LE(desc);
  buf.write(LZMA_MAGIC, offset, "ascii");
  buf.writeInt32LE(999, desc + 12);
  const path = join(scratch, `visleaf-compressed-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

function withMisalignedLeafs(): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(LUMP_LEAFS);
  const length = buf.readInt32LE(desc + 4);
  buf.writeInt32LE(length - 1, desc + 4);
  const path = join(scratch, "visleaf-misaligned.bsp");
  writeFileSync(path, buf);
  return path;
}

function withUnsupportedLeafVersion(): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(LUMP_LEAFS);
  buf.writeInt32LE(2, desc + 8); // version field
  const path = join(scratch, "visleaf-badversion.bsp");
  writeFileSync(path, buf);
  return path;
}

/**
 * Rewrites the probe's 32-byte (version 1) LEAFS lump as version 0's 56-byte record,
 * inserting the 24-byte CompressedLightCube field every version-0 dleaf_t carries. No
 * version-0 BSP is available to test against directly, so this is built from the one
 * known-good fixture rather than fabricated from scratch -- every field this reader reads
 * (contents, cluster, mins, maxs) keeps the exact bytes it had in the version-1 lump.
 */
function asLeafVersion0(): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(LUMP_LEAFS);
  const offset = buf.readInt32LE(desc);
  const length = buf.readInt32LE(desc + 4);
  const count = length / 32;

  const rewritten = Buffer.alloc(count * 56);
  for (let i = 0; i < count; i++) {
    // First 30 bytes (through leafWaterDataID) are identical between the two versions.
    buf.copy(rewritten, i * 56, offset + i * 32, offset + i * 32 + 30);
    // Bytes 30..53 are the 24-byte CompressedLightCube, left zeroed; 54..55 is padding.
  }

  // The rewritten lump does not fit where LEAFS used to sit, so it goes at EOF.
  const out = Buffer.concat([buf, rewritten]);
  out.writeInt32LE(buf.length, desc); // new offset: right after the original file
  out.writeInt32LE(rewritten.length, desc + 4);
  out.writeInt32LE(0, desc + 8); // version 0

  const path = join(scratch, "visleaf-v0.bsp");
  writeFileSync(path, out);
  return path;
}

describe("read_visleaf_stats", () => {
  it("reads the probe's leaves and matches its own VISIBILITY cluster count", () => {
    const r = readVisleafStats(PROBE);
    expect(r.leafVersion).toBe(1);
    expect(r.leafBytes).toBe(32);
    expect(r.leafCount).toBeGreaterThan(0);
    // Read independently from the raw bytes: 4 leaves have contents == 0 (not solid) and
    // distinct clusters 0..3, and the probe's own VISIBILITY header records numclusters=4.
    const openLeaves = r.leaves.filter((l) => l.contents === 0);
    expect(openLeaves.map((l) => l.cluster).sort()).toEqual([0, 1, 2, 3]);
    expect(r.clusterCount).toBe(4);
  });

  it("counts leaves with no cluster as (almost) the solid ones", () => {
    // Read independently from the raw bytes: leaf 0 is Source's shared "outside the map"
    // placeholder -- contents SOLID but cluster 0, not -1 -- so noClusterLeafCount is the
    // solid count minus exactly that one leaf, never equal to it.
    const r = readVisleafStats(PROBE);
    const solidCount = r.leaves.filter((l) => l.contents !== 0).length;
    expect(r.noClusterLeafCount).toBe(solidCount - 1);
    expect(r.leaves[0]!.contents).not.toBe(0);
    expect(r.leaves[0]!.cluster).not.toBe(-1);
    expect(r.noClusterLeafCount).toBeGreaterThan(0);
    expect(r.noClusterLeafCount).toBeLessThan(r.leafCount);
  });

  it("computes a positive volume for the room's leaves", () => {
    const r = readVisleafStats(PROBE);
    expect(r.leaves.some((l) => l.volume > 0)).toBe(true);
  });

  it("reads a version-0 (56-byte) LEAFS lump the same way as version 1", () => {
    const v1 = readVisleafStats(PROBE);
    const v0 = readVisleafStats(asLeafVersion0());
    expect(v0.leafVersion).toBe(0);
    expect(v0.leafBytes).toBe(56);
    expect(v0.leafCount).toBe(v1.leafCount);
    expect(v0.leaves.map((l) => [l.contents, l.cluster, l.mins, l.maxs])).toEqual(
      v1.leaves.map((l) => [l.contents, l.cluster, l.mins, l.maxs]),
    );
  });

  it("refuses a LEAFS version it does not know, rather than guessing", () => {
    const path = withUnsupportedLeafVersion();
    expect(() => readVisleafStats(path)).toThrow(BspFormatError);
    expect(() => readVisleafStats(path)).toThrow(/version 2/);
  });

  it("refuses a LEAFS lump whose length does not divide by its record size", () => {
    const path = withMisalignedLeafs();
    expect(() => readVisleafStats(path)).toThrow(BspFormatError);
    expect(() => readVisleafStats(path)).toThrow(/not a multiple/);
  });

  it("refuses an individually LZMA-compressed LEAFS lump, and says so", () => {
    const path = withCompressedLump(LUMP_LEAFS);
    expect(() => readVisleafStats(path)).toThrow(BspFormatError);
    expect(() => readVisleafStats(path)).toThrow(/compressed/i);
  });

  it("refuses an individually LZMA-compressed VISIBILITY lump, and says so", () => {
    const path = withCompressedLump(LUMP_VISIBILITY);
    expect(() => readVisleafStats(path)).toThrow(BspFormatError);
    expect(() => readVisleafStats(path)).toThrow(/compressed/i);
  });

  it("matches its declared output schema", async () => {
    const out = await readVisleafStatsTool.handler({ path: PROBE }, ctx);
    expect(() => z.object(readVisleafStatsTool.outputSchema!).parse(out)).not.toThrow();
  });

  it.skipIf(!has.prodMap)(
    "on the production map, agrees with itself: cluster count from VISIBILITY is plausible",
    () => {
      const r = readVisleafStats(paths.prodMap);
      expect(r.leafVersion).toBe(1);
      expect(r.leafCount).toBeGreaterThan(0);
      expect(r.clusterCount).toBeGreaterThan(0);
      // A cluster is a group of one or more leaves, never more clusters than leaves.
      expect(r.clusterCount!).toBeLessThanOrEqual(r.leafCount);
      expect(r.noClusterLeafCount).toBeGreaterThan(0);
      expect(r.noClusterLeafCount).toBeLessThan(r.leafCount);
    },
  );
});
