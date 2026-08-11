import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/mcp/registry.js";
import {
  GMOD_DARKRP,
  LIMITS,
  overallVerdict,
  reportMap,
  SOURCE_STOCK,
} from "../src/report/budget.js";
import type { BudgetProfile } from "../src/report/budget.js";
import { readMapReportTool } from "../src/tools/report.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const ctx = sharedCtx as unknown as ToolContext;

const scratch = mkdtempSync(join(tmpdir(), "hammer-report-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lumpDescAt = (i: number): number => 8 + i * 16;
const LUMP_VISIBILITY = 4;

/** Erases the PVS the way a map shipped without vvis would have none. */
function withoutVis(): string {
  const buf = Buffer.from(readFileSync(PROBE));
  buf.writeInt32LE(0, lumpDescAt(LUMP_VISIBILITY) + 4);
  const path = join(scratch, "no-vis.bsp");
  writeFileSync(path, buf);
  return path;
}

const find = (r: ReturnType<typeof reportMap>, id: string) => r.criteria.find((c) => c.id === id);

describe("budget profiles", () => {
  it("state the provenance of every threshold they carry", () => {
    for (const profile of [SOURCE_STOCK, GMOD_DARKRP]) {
      for (const [key, t] of Object.entries(profile)) {
        if (t && typeof t === "object" && "warnAt" in t) {
          expect(t.source, `${profile.id}.${key}`).toBeTruthy();
        }
      }
    }
  });

  it("keeps the raised edict ceiling marked unverified, because it is", () => {
    expect(GMOD_DARKRP.edictLimit?.source).toMatch(/UNVERIFIED/);
    expect(SOURCE_STOCK.edictLimit).toBeNull();
  });

  it("carries the world bound as 16384, not the 32768 extent", () => {
    expect(LIMITS.worldBound).toBe(16384);
    expect(LIMITS.edicts).toBe(2048);
  });
});

describe("overallVerdict", () => {
  it("calls a run where nothing was judged `skipped`, never `pass`", () => {
    expect(overallVerdict({ pass: 0, warn: 0, fail: 0, skipped: 7 })).toBe("skipped");
  });

  it("takes the worst of what was judged", () => {
    expect(overallVerdict({ pass: 9, warn: 0, fail: 0, skipped: 3 })).toBe("pass");
    expect(overallVerdict({ pass: 9, warn: 1, fail: 0, skipped: 0 })).toBe("warn");
    expect(overallVerdict({ pass: 9, warn: 5, fail: 1, skipped: 0 })).toBe("fail");
  });
});

describe("reportMap", () => {
  it("passes the probe against stock limits, and says vvis ran", () => {
    const r = reportMap(PROBE, SOURCE_STOCK);
    expect(r.overall).not.toBe("fail");
    const vis = find(r, "vis-run");
    expect(vis?.verdict).toBe("pass");
    expect(vis?.value).toBe(1);
  });

  it("fails the same map once its PVS is gone", () => {
    const r = reportMap(withoutVis(), SOURCE_STOCK);
    expect(find(r, "vis-run")?.verdict).toBe("fail");
    expect(r.overall).toBe("fail");
    expect(r.summary.fail).toBeGreaterThan(0);
  });

  it("judges the lighting ceiling exactly once, through the lump table", () => {
    // It briefly had a criterion of its own as well, and the two agreed to three decimals
    // on the same map -- which is what a duplicated fact looks like just before the copies
    // start disagreeing.
    const r = reportMap(PROBE, SOURCE_STOCK);
    expect(find(r, "lighting-bytes")).toBeUndefined();
    expect(r.criteria.filter((c) => c.id.includes("LIGHTING"))).toHaveLength(1);
  });

  it("reports luxel density as skipped, naming the missing calibration", () => {
    const c = find(reportMap(PROBE, SOURCE_STOCK), "luxel-density");
    expect(c?.verdict).toBe("skipped");
    expect(c?.value).toBeNull();
    expect(c?.message).toMatch(/calibrated/);
  });

  it("switches criteria off with the profile, and still judges what remains", () => {
    const quiet: BudgetProfile = {
      ...SOURCE_STOCK,
      id: "quiet",
      edicts: null,
      requireVis: false,
    };
    const r = reportMap(PROBE, quiet);
    expect(find(r, "edicts")).toBeUndefined();
    expect(find(r, "vis-run")).toBeUndefined();
    expect(r.summary.skipped).toBeGreaterThan(0);
  });

  it("demands cubemaps only where the profile asks for them", () => {
    expect(find(reportMap(PROBE, SOURCE_STOCK), "cubemaps")).toBeUndefined();
    const c = find(reportMap(PROBE, GMOD_DARKRP), "cubemaps");
    expect(c).toBeDefined();
    // The probe is a bare sealed room: no env_cubemap was ever placed in it.
    expect(c?.verdict).toBe("fail");
    expect(c?.message).toMatch(/buildcubemaps/);
  });

  it("names the entity ceiling it judged against, so the answer is not ambiguous", () => {
    const stock = find(reportMap(PROBE, SOURCE_STOCK), "edicts");
    expect(stock?.message).toMatch(/2048/);
    const gmod = find(reportMap(PROBE, GMOD_DARKRP), "edicts");
    expect(gmod?.message).toMatch(/8192/);
    expect(gmod?.message).toMatch(/UNVERIFIED/);
  });
});

describe("read_map_report", () => {
  it("refuses an unknown profile and names the ones that exist", () => {
    expect(() => readMapReportTool.handler({ path: PROBE, profile: "nope" }, ctx)).toThrow(
      /source-stock, gmod-darkrp/,
    );
  });

  it("matches its declared output schema", async () => {
    const out = await readMapReportTool.handler({ path: PROBE }, ctx);
    expect(() => z.object(readMapReportTool.outputSchema!).parse(out)).not.toThrow();
  });

  it("says how many criteria a filter hid, so a short list is not a short map", async () => {
    const shape = z.object(readMapReportTool.outputSchema!);
    const all = shape.parse(await readMapReportTool.handler({ path: PROBE }, ctx));
    const only = shape.parse(
      await readMapReportTool.handler({ path: PROBE, verdicts: ["skipped"] }, ctx),
    );
    expect(only.criteria.length).toBeLessThan(all.criteria.length);
    expect(only.filteredOut).toBe(all.criteria.length - only.criteria.length);
    expect(all.filteredOut).toBeUndefined();
  });

  it.skipIf(!has.prodMap)("on the production map, reports MODELS past its stock ceiling", () => {
    const r = reportMap(paths.prodMap, SOURCE_STOCK);
    const models = find(r, "lump-fill:MODELS");
    expect(models?.verdict).toBe("fail");
    expect(models?.message).toMatch(/raise it|refused/);
    // The map ships and loads daily: the verdict is about stock limits, not about it.
    expect(find(r, "vis-run")?.verdict).toBe("pass");
  });
});
