import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readGeometry } from "../src/bsp/geometry.js";
import { METRES_PER_UNIT, readModels, worldExtents } from "../src/bsp/models.js";
import type { Config } from "../src/config.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readMapExtents, readMapGeometry, readPropSurvey } from "../src/tools/measure.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const REPO = join(FIXTURES, "..", "..", "..");
const NYCITY = join(
  REPO,
  "srcds/garrysmod/addons/rp_nycity_day/maps/rp_nycity_day.bsp",
);
const hasProd = existsSync(NYCITY);

const ctx = {
  config: { repoRoot: FIXTURES, stateDir: FIXTURES, toolAllowlist: [] } as unknown as Config,
  audit: { record: () => undefined },
} as unknown as ToolContext;

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
