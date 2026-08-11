import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readGeometry } from "../src/bsp/geometry.js";
import { LZMA_MAGIC, readHeader } from "../src/bsp/header.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const scratch = mkdtempSync(join(tmpdir(), "hammer-lzma-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Byte offset of lump `i`'s descriptor: ident[4] + version[4] + i * sizeof(lump_t). */
const lumpDescAt = (i: number): number => 8 + i * 16;

/**
 * The probe with one lump marked as individually LZMA-compressed.
 *
 * Built at run time from the committed probe rather than shipped as a second binary, so
 * the two cannot drift apart -- and so no map anyone can read is added to the repository.
 *
 * `declaredUncompressed` goes into the fourCC field, which is what a real compressed lump
 * carries there instead of a codec tag.
 */
function withCompressedLump(index: number, declaredUncompressed: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  const desc = lumpDescAt(index);
  const offset = buf.readInt32LE(desc);
  buf.write(LZMA_MAGIC, offset, "ascii");
  buf.writeInt32LE(declaredUncompressed, desc + 12);

  const path = join(scratch, `compressed-${index}.bsp`);
  writeFileSync(path, buf);
  return path;
}

describe("a lump compressed on its own", () => {
  // PLANES on the probe: 40 records of 20 bytes = 800, which divides EXACTLY. That is the
  // whole point of picking it. A compressed length lands on a multiple of the record size
  // roughly one time in `bytes`, and in that case the divisibility guard passes it through
  // as a plausible, wrong count. Only the magic tells them apart.
  const PLANES = 1;

  it("the fixture would sail past the divisibility guard", () => {
    const clean = readHeader(PROBE);
    expect(clean.lumps[PLANES]!.length % 20).toBe(0);
    expect(clean.lumps[PLANES]!.compressed).toBe(false);
  });

  it("is detected from its magic, not from its size", () => {
    const path = withCompressedLump(PLANES, 16_000);
    const h = readHeader(path);
    expect(h.lumps[PLANES]!.compressed).toBe(true);
    expect(h.lumps[PLANES]!.declaredUncompressedBytes).toBe(16_000);
    // Untouched lumps stay untouched: the check is per-lump, not per-file.
    expect(h.lumps[7]!.compressed).toBe(false);
    expect(h.lumps[7]!.declaredUncompressedBytes).toBeNull();
  });

  it("refuses to count it, and says why", () => {
    const path = withCompressedLump(PLANES, 16_000);
    const planes = readGeometry(path).lumps.find((l) => l.index === PLANES)!;

    expect(planes.compressed).toBe(true);
    expect(planes.count).toBeNull();
    expect(planes.usedFraction).toBeUndefined();
    expect(planes.note).toMatch(/compressed/i);
    // The reason must name compression, not the wrong culprit. The pre-existing note
    // blamed a BSP version whose struct layout differs -- a reader would go looking in
    // entirely the wrong place.
    expect(planes.note).not.toMatch(/layout differs/);
    expect(planes.note).toMatch(/16000/);
    expect(planes.note).toMatch(/not verified/);
  });

  it("still counts the same lump when it is not compressed", () => {
    // Without this, a guard that simply refused to count PLANES on every map would pass
    // every assertion above.
    const planes = readGeometry(PROBE).lumps.find((l) => l.index === PLANES)!;
    expect(planes.compressed).toBe(false);
    expect(planes.count).toBe(40);
    expect(planes.note).toBeUndefined();
  });

  it("keeps a compressed lump out of the near-limit list", () => {
    // A lump with no count cannot be near anything. Reporting one would put a map on the
    // "cannot grow" list for a lump nobody measured.
    const path = withCompressedLump(PLANES, 16_000);
    expect(readGeometry(path).nearLimit.some((l) => l.index === PLANES)).toBe(false);
  });
});
