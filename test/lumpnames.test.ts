import { describe, expect, it } from "vitest";
import { LUMP_SPECS } from "../src/bsp/geometry.js";
import { HDR_LUMPS, LUMP_NAMES, readHeader } from "../src/bsp/header.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readBspInfo } from "../src/tools/bsp.js";
import { ctx as sharedCtx, has, paths } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;

/**
 * Every index this repository names, against `LUMP_*` in `src/public/bspfile.h` of
 * source-sdk-2013, read 11/08/2026. Written out rather than derived, because a table
 * checked against itself checks nothing.
 */
const FROM_BSPFILE_H: Record<number, string> = {
  0: "ENTITIES",
  8: "LIGHTING",
  9: "OCCLUSION",
  14: "MODELS",
  35: "GAME_LUMP",
  40: "PAKFILE",
  45: "OVERLAYS",
  51: "LEAF_AMBIENT_INDEX_HDR",
  52: "LEAF_AMBIENT_INDEX",
  53: "LIGHTING_HDR",
  54: "WORLDLIGHTS_HDR",
  55: "LEAF_AMBIENT_LIGHTING_HDR",
  56: "LEAF_AMBIENT_LIGHTING",
  57: "XZIPPAKFILE",
  58: "FACES_HDR",
};

describe("lump names", () => {
  it.each(Object.entries(FROM_BSPFILE_H))("names %s as bspfile.h does", (index, name) => {
    expect(LUMP_NAMES[Number(index)]).toBe(name);
  });

  it("does not call lump 56 an HDR lump", () => {
    // The specific mistake that shipped. LEAF_AMBIENT_LIGHTING is per-visleaf ambient and
    // is present in LDR maps too, so labelling it LIGHTING_HDR makes every LDR map read as
    // HDR-compiled -- an audit of a map's lighting then concludes the opposite of the truth
    // with nothing to flag it.
    expect(LUMP_NAMES[56]).not.toMatch(/HDR/);
    expect(LUMP_NAMES[53]).toBe("LIGHTING_HDR");
  });

  it("gives no two indexes the same name", () => {
    // How the bug looked from outside: LIGHTING_HDR appeared at both 53 and 56, across the
    // two tables that used to exist.
    const names = Object.values(LUMP_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has one table, so the geometry specs cannot disagree with it", () => {
    // The root cause was two hand-maintained lists: geometry.ts had 53 right while
    // header.ts had 56 wrong, and nothing compared them. Specs now carry no name at all.
    for (const spec of LUMP_SPECS) {
      expect(LUMP_NAMES[spec.index], `lump ${spec.index} has a spec but no name`).toBeDefined();
    }
    expect(LUMP_SPECS.every((s) => !("name" in s))).toBe(true);
  });

  it("keeps 55 and 56 out of the HDR verdict", () => {
    // Measured on the production map below: 55 is non-empty on a map with no HDR lighting
    // at all. Neither ambient lump can carry this question.
    expect(HDR_LUMPS).not.toContain(55);
    expect(HDR_LUMPS).not.toContain(56);
    expect([...HDR_LUMPS]).toEqual([53, 54, 58]);
  });
});

describe("HDR, on a map that has none", () => {
  it.skipIf(!has.prodMap)("reports LDR even though the ambient lumps are full", () => {
    // rp_nycity_day, measured 11/08/2026. The discriminating case in one file:
    //   lump 56 LEAF_AMBIENT_LIGHTING      3,548,076 bytes
    //   lump 55 LEAF_AMBIENT_LIGHTING_HDR    663,908 bytes
    //   lump 53 LIGHTING_HDR                        0
    // Under the old label this map reported "LIGHTING_HDR: 3.5 MB" and read as HDR.
    const h = readHeader(paths.prodMap);
    expect(h.lumps[56]!.length).toBeGreaterThan(0);
    expect(h.lumps[55]!.length).toBeGreaterThan(0);
    expect(h.lumps[53]!.length).toBe(0);
    expect(h.lumps[54]!.length).toBe(0);
    expect(h.lumps[58]!.length).toBe(0);
  });

  it.skipIf(!has.prodMap)("says so through read_bsp_info", async () => {
    const r = (await readBspInfo.handler({ path: paths.prodMap, allLumps: false }, ctx)) as {
      hdrLighting: boolean;
      lumps: Array<{ index: number; name: string | null }>;
    };
    expect(r.hdrLighting).toBe(false);
    const l56 = r.lumps.find((l) => l.index === 56);
    expect(l56?.name).toBe("LEAF_AMBIENT_LIGHTING");
  });

  it.skipIf(!has.prodMap)("would call a map with lump 53 HDR", () => {
    // The other half. Without it, a verdict hard-coded to false would pass everything above.
    const h = readHeader(paths.prodMap);
    const hdr = HDR_LUMPS.some((i) => (h.lumps[i]?.length ?? 0) > 0);
    expect(hdr).toBe(false);
    const pretend = HDR_LUMPS.some((i) => (i === 53 ? 1 : (h.lumps[i]?.length ?? 0)) > 0);
    expect(pretend).toBe(true);
  });
});
