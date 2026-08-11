import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readGeometry } from "../src/bsp/geometry.js";
import { readHeader } from "../src/bsp/header.js";
import { FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const LEAFS = 10;
const scratch = mkdtempSync(join(tmpdir(), "hammer-leafs-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The probe with lump `index`'s own version field forced to `version`. */
function withLumpVersion(index: number, version: number): string {
  const buf = Buffer.from(readFileSync(PROBE));
  buf.writeInt32LE(version, 8 + index * 16 + 8);
  const path = join(scratch, `leafs-v${version}.bsp`);
  writeFileSync(path, buf);
  return path;
}

const leafsOf = (path: string) => readGeometry(path).lumps.find((l) => l.index === LEAFS)!;

describe("counting leaves", () => {
  it("uses the size the lump's own version calls for", () => {
    // dleaf_t is 32 bytes at version 1 and 56 at version 0, where it still carries an
    // inline CompressedLightCube. The lump header says which, and it is already read.
    const probe = readHeader(PROBE).lumps[LEAFS]!;
    expect(probe.version).toBe(1);
    expect(leafsOf(PROBE).count).toBe(probe.length / 32);
  });

  it("refuses rather than counting a version-0 lump at the version-1 size", () => {
    // The probe's 928 bytes divide by 32 and not by 56. Read as version 0 it must yield
    // no count -- where a hard-coded 32 would happily return 29 leaves for a layout that
    // is not there. This is the whole reason the size is version-dependent: practically
    // every modern map is version 1, so hard-coding 32 passes every test anyone runs.
    const v0 = leafsOf(withLumpVersion(LEAFS, 0));
    expect(v0.count).toBeNull();
    expect(v0.note).toMatch(/not a multiple of the expected 56-byte/);
  });

  it("names a version it does not know instead of guessing one", () => {
    const v7 = leafsOf(withLumpVersion(LEAFS, 7));
    expect(v7.count).toBeNull();
    expect(v7.note).toMatch(/version 7 is not one this reader knows/);
    expect(v7.note).toMatch(/known: 0, 1/);
  });

  it("still counts every other lump normally", () => {
    // A guard that quietly stopped counting anything would pass the two tests above.
    const planes = readGeometry(PROBE).lumps.find((l) => l.index === 1)!;
    expect(planes.count).toBe(40);
  });

  it.skipIf(!has.prodMap)("agrees with an independent reader on real maps", () => {
    // Cross-checked 11/08/2026 against a separate implementation written in another
    // session, which walked the lump itself rather than dividing its length:
    //   rp_nycity_day  23711 leaves      gm_construct  5002
    // Two implementations, two methods, same numbers.
    expect(leafsOf(paths.prodMap).count).toBe(23711);
  });

  it.skipIf(!has.navPair)("agrees on gm_construct too", () => {
    expect(leafsOf(join(paths.mapsDir, "gm_construct.bsp")).count).toBe(5002);
  });
});
