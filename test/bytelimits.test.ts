import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LUMP_SPECS, readGeometry } from "../src/bsp/geometry.js";
import { FIXTURES, has, paths } from "./support/env.js";

const LIGHTING = 8;
const VISIBILITY = 4;
const MAX_MAP_LIGHTING = 0x100_0000; // 16 MiB, bspfile.h

const lump = (path: string, index: number) =>
  readGeometry(path).lumps.find((l) => l.index === index)!;

describe("ceilings measured in bytes", () => {
  it("declares no ceiling it cannot evaluate", () => {
    // The fault this fixes. TEXDATA_STRING_DATA carried limit: 256000 with no record
    // size, so `count` was always null and the ceiling was never once applied -- a limit
    // this reader claimed to watch and did not. Any spec with a limit must now be able to
    // reach a fraction: either it has a record size, or its ceiling is in bytes.
    const probe = readGeometry(join(FIXTURES, "hmcp_probe.bsp"));
    for (const spec of LUMP_SPECS) {
      if (spec.limit === undefined) continue;
      const report = probe.lumps.find((l) => l.index === spec.index);
      // Empty lumps are not reported at all, which is its own answer.
      if (!report) continue;
      const evaluated = report.usedFraction !== undefined;
      // Either the ceiling produces a fraction, or the report says why it cannot. What is
      // forbidden is the third state: a limit carried in the output and silently unused.
      expect(
        evaluated || (report.note ?? "").includes("cannot derive"),
        `lump ${spec.index} (${spec.limitName}) carries a limit that is neither evaluated nor explained`,
      ).toBe(true);
    }
  });

  it("says out loud when a ceiling is out of its reach", () => {
    // MAX_MAP_ENTITIES counts entities; this reader measures bytes. The limit is real and
    // unreachable here, and the output points at the tool that can answer.
    const entities = lump(join(FIXTURES, "hmcp_probe.bsp"), 0);
    expect(entities.usedFraction).toBeUndefined();
    expect(entities.note).toMatch(/MAX_MAP_ENTITIES/);
    expect(entities.note).toMatch(/read_bsp_entities/);
  });

  it("measures LIGHTING against 16 MiB, not against a record count", () => {
    const probe = lump(join(FIXTURES, "hmcp_probe.bsp"), LIGHTING);
    expect(probe.count).toBeNull(); // no record size: this lump has none
    expect(probe.usedFraction).toBeDefined(); // and a fraction all the same
    expect(probe.usedFraction).toBeCloseTo(probe.bytes / MAX_MAP_LIGHTING, 3);
  });

  it.skipIf(!has.prodMap)("reports the production map past MAX_MAP_LIGHTING", () => {
    // 44,343,028 bytes against 0x1000000 = 264%. Found by a second session running every
    // criterion instead of the interesting ones; this reader had the number and never
    // compared it. Verified LDR-only first -- lumps 53/54/58 are empty, so this is not two
    // sets of lighting added together, which would have been a tidy and wrong explanation.
    const l = lump(paths.prodMap, LIGHTING);
    expect(l.bytes).toBe(44_343_028);
    expect(l.usedFraction).toBeCloseTo(2.643, 2);
    expect(l.note).toMatch(/exceeds the stock SDK 2013 MAX_MAP_LIGHTING/);
    expect(readGeometry(paths.prodMap).nearLimit.map((x) => x.name)).toContain("LIGHTING");
  });

  it.skipIf(!has.navPair)("does not cry wolf on a map Valve shipped", () => {
    // The other half. gm_construct is at 73.2% of the same ceiling -- high enough to show
    // the limit is tight even for an official map, low enough that a guard reporting
    // everything as over would fail here.
    const l = lump(join(paths.mapsDir, "gm_construct.bsp"), LIGHTING);
    expect(l.usedFraction).toBeLessThan(1);
    expect(l.usedFraction).toBeGreaterThan(0.5);
    expect(l.note).toBeUndefined();
    expect(readGeometry(join(paths.mapsDir, "gm_construct.bsp")).nearLimit).toHaveLength(0);
  });

  it.skipIf(!has.prodMap)("leaves VISIBILITY well under its own 16 MiB", () => {
    // Same ceiling constant, different lump: a fraction copied from LIGHTING would show up
    // here as the same number.
    const vis = lump(paths.prodMap, VISIBILITY);
    expect(vis.usedFraction).toBeCloseTo(vis.bytes / MAX_MAP_LIGHTING, 3);
    expect(vis.usedFraction).toBeLessThan(0.5);
  });
});
