import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readGeometry } from "../src/bsp/geometry.js";
import { METRES_PER_UNIT, readModels, worldExtents } from "../src/bsp/models.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { FIXTURES, ctx as sharedCtx, has, paths } from "./support/env.js";
import {
  readBrushVolumes,
  readMapExtents,
  readMapGeometry,
  readPakfile,
  readPropSurvey,
} from "../src/tools/measure.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const NYCITY = paths.prodMap;
const hasProd = has.prodMap;
const hasSidecar = has.sidecar;

// The shared context carries the real stateDir: it is where the sidecar venv lives, and a
// context pointing elsewhere makes sidecar-backed tools fail while `hasSidecar` still says yes.
const ctx = sharedCtx as unknown as ToolContext;

describe("world extents", () => {
  it("reads the probe's single world model", () => {
    const lump = readModels(PROBE);
    expect(lump.models.length).toBeGreaterThanOrEqual(1);
    const e = worldExtents(lump);
    expect(e.sizeUnits[0]).toBeGreaterThan(0);
    expect(e.sizeMetres[0]).toBeCloseTo(e.sizeUnits[0] * METRES_PER_UNIT, 1);
  });

  it("uses one inch per unit", () => {
    // Not a convention we picked: it is what makes rp_nycity_day come out at the 802 m
    // the vehicles spec measured by hand.
    expect(METRES_PER_UNIT).toBe(0.0254);
  });

  it.skipIf(!hasProd)("reproduces the 802 m and the mins the vehicles spec recorded", () => {
    // docs/specs/2026-07-25-rvehicles-design.md:624 read lump 14 by hand and wrote
    // "la map fait 802 mètres", mins (-15424, -15936, ...). An independent reader
    // landing on the same numbers is what makes both trustworthy.
    const e = worldExtents(readModels(NYCITY));
    expect(e.mins[0]).toBe(-15424);
    expect(e.mins[1]).toBe(-15936);
    expect(Math.round(e.spanMetres)).toBe(803);
    expect(e.spanMetres).toBeGreaterThan(800);
    expect(e.spanMetres).toBeLessThan(805);
  });
});

describe("lump geometry", () => {
  it("derives counts only when the record size divides the lump exactly", () => {
    const g = readGeometry(PROBE);
    const models = g.lumps.find((l) => l.name === "MODELS");
    expect(models?.count).toBe(1);
    for (const l of g.lumps) {
      if (l.count === null && l.bytes > 0) {
        // Either we never claimed a record size, or we said why the count is missing.
        expect(l.note === undefined || l.note.includes("multiple")).toBe(true);
      }
    }
  });

  it("never reports a fractional count", () => {
    // The negative control for the divisibility guard: a wrong struct size would
    // otherwise produce a plausible non-integer that reads as a real measurement.
    for (const l of readGeometry(PROBE).lumps) {
      if (l.count !== null) expect(Number.isInteger(l.count)).toBe(true);
    }
  });

  it.skipIf(!hasProd)("flags the production map's headroom, and the raised model ceiling", () => {
    const g = readGeometry(NYCITY);
    const byName = new Map(g.lumps.map((l) => [l.name, l]));
    expect(byName.get("VERTEXES")?.count).toBe(62270);
    expect(byName.get("BRUSHES")?.count).toBe(6913);

    // 1218 models against a stock ceiling of 1024, on a map that loads: the compilers
    // that built it raise the limit. Reported as evidence, not as an error.
    const models = byName.get("MODELS");
    expect(models?.count).toBe(1218);
    expect(models?.note).toMatch(/raise it/);
  });
});

describe("prop survey", () => {
  it.skipIf(!hasProd)("counts the 59 prop_dynamic r-estate found independently", async () => {
    const r = (await readPropSurvey.handler({ path: NYCITY, limit: 10 }, ctx)) as {
      byClass: Record<string, number>;
      staticCandidates: { total: number };
    };
    expect(r.byClass["prop_dynamic"]).toBe(59);
  });

  it.skipIf(!hasProd)("does not call every prop a conversion candidate, nor none", async () => {
    // Both degenerate answers are useless and both look like success. The first cut of
    // this filter keyed on key PRESENCE and returned 0 of 59, because Hammer writes
    // every key of the class with its default value.
    const r = (await readPropSurvey.handler({ path: NYCITY, limit: 200 }, ctx)) as {
      byClass: Record<string, number>;
      staticCandidates: { total: number };
    };
    const dynamic = r.byClass["prop_dynamic"]!;
    expect(r.staticCandidates.total).toBeGreaterThan(0);
    expect(r.staticCandidates.total).toBeLessThan(dynamic);
  });
});

describe("declared output schemas match the measure handlers", () => {
  it("read_map_extents", async () => {
    const out = await readMapExtents.handler({ path: PROBE }, ctx);
    expect(() => z.object(readMapExtents.outputSchema!).parse(out)).not.toThrow();
  });

  it("read_map_geometry", async () => {
    const out = await readMapGeometry.handler({ path: PROBE, nearLimitOnly: false }, ctx);
    expect(() => z.object(readMapGeometry.outputSchema!).parse(out)).not.toThrow();
  });

  it.skipIf(!hasProd)("read_prop_survey", async () => {
    const out = await readPropSurvey.handler({ path: NYCITY, limit: 5 }, ctx);
    expect(() => z.object(readPropSurvey.outputSchema!).parse(out)).not.toThrow();
  });
});

describe("pakfile audit", () => {
  it.skipIf(!hasSidecar)("reads the probe's pakfile through the sidecar", async () => {
    const out = (await readPakfile.handler({ path: PROBE, limit: 10 }, ctx)) as {
      fileCount: number;
      cubemapTextures: number;
    };
    expect(out.fileCount).toBeGreaterThan(0);
    // The probe has only vbsp's default cubemap placeholder: the compile log said so
    // ("Skybox vtf files ... weren't compiled with the same size texture"), and no
    // buildcubemaps was ever run on it.
    expect(out.cubemapTextures).toBe(0);
    expect(() => z.object(readPakfile.outputSchema!).parse(out)).not.toThrow();
  });

  it.skipIf(!hasSidecar || !hasProd)("finds the shipped map's baked lighting proof", async () => {
    // Both counts are evidence about how the map was compiled, recoverable from the
    // file alone rather than from anyone's memory of the compile settings.
    const out = (await readPakfile.handler({ path: NYCITY, limit: 3 }, ctx)) as {
      fileCount: number;
      cubemapTextures: number;
      staticPropLighting: number;
    };
    expect(out.fileCount).toBe(15258);
    expect(out.cubemapTextures).toBeGreaterThan(0);
    expect(out.staticPropLighting).toBeGreaterThan(0);
    // Explicit: opening a 1 GB pakfile takes ~1.3 s alone and more under a parallel
    // run. On the 5 s default this passed in isolation and failed in the full suite,
    // which is the worst kind of flake -- it accuses the code rather than the clock.
  }, 60_000);
});

describe("brush volumes", () => {
  it.skipIf(!hasProd)("attributes every brush model to the entity that claims it", async () => {
    // Model 0 is the world and 1..n belong to brush entities through "model" "*N".
    // Anything unattributed would mean the mapping is wrong, not that a model is
    // ownerless, so the two counts must agree exactly.
    const out = (await readBrushVolumes.handler(
      { path: NYCITY, limit: 5 },
      ctx,
    )) as {
      brushModels: number;
      attributed: number;
      byClass: Array<{ classname: string; count: number; medianFloorSquareMetres: number }>;
    };
    expect(out.brushModels).toBe(1217);
    expect(out.attributed).toBe(out.brushModels);
    expect(() => z.object(readBrushVolumes.outputSchema!).parse(out)).not.toThrow();

    // The door counts match the entity histogram measured at milestone 1.
    const byName = new Map(out.byClass.map((g) => [g.classname, g]));
    expect(byName.get("func_door_rotating")?.count).toBe(451);
    expect(byName.get("func_door")?.count).toBe(171);
    // A door's footprint is a thin slab; a soundscape covers a room. If those two came
    // out the same, the bounding boxes would be being read wrong.
    expect(byName.get("func_door")!.medianFloorSquareMetres).toBeLessThan(5);
    expect(byName.get("trigger_soundscape")!.medianFloorSquareMetres).toBeGreaterThan(20);
  }, 60_000);
});
