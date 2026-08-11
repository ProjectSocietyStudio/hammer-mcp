import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readLightmapBudget } from "../src/bsp/lightmap.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { setLightmapScaleTool } from "../src/tools/optimise.js";
import { MAX_BRUSH_LUXELS_PER_AXIS, setLightmapScale, VmfLightmapError } from "../src/vmf/lightmap.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-lm-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const probe = (): string => readFileSync(PROBE, "utf8");
const scales = (text: string): number[] =>
  checkVmfSolids("x", text).solids.flatMap((s) => s.sides.map((f) => f.lightmapScale ?? -1));

describe("setLightmapScale", () => {
  it("changes every face when asked, and reports the luxel bill both ways", () => {
    const r = setLightmapScale(probe(), 32, {});
    expect(r.unchanged).toBe(false);
    expect(new Set(scales(r.text))).toEqual(new Set([32]));
    // The probe ships at 16 throughout, so doubling the scale must quarter the luxels --
    // the cost is an area, and this is the arithmetic the whole tool exists to expose.
    expect(r.luxelsAfter).toBeLessThan(r.luxelsBefore / 3);
    expect(r.changed).toHaveLength(36);
  });

  it("selects by which way a face points", () => {
    const r = setLightmapScale(probe(), 64, { facing: "up" });
    // One up-facing side per box: six brushes, six floors.
    expect(r.changed).toHaveLength(6);
    for (const c of r.changed) expect(c.to).toBe(64);
    expect(scales(r.text).filter((s) => s === 64)).toHaveLength(6);
  });

  it("selects by material and by area", () => {
    expect(setLightmapScale(probe(), 32, { material: "DEV" }).changed).toHaveLength(36);
    expect(setLightmapScale(probe(), 32, { material: "brick" }).changed).toHaveLength(0);

    // The probe's face areas, measured: 331776, 147456, 131072, 18432, 16384, 8192.
    // 147456 keeps the eight largest and drops the rest, which is the shape of the real
    // use -- coarsen the big flat surfaces, leave the trim alone.
    const big = setLightmapScale(probe(), 32, { minArea: 147456 });
    expect(big.changed).toHaveLength(8);
    for (const c of big.changed) expect(c.areaUnits).toBeGreaterThanOrEqual(147456);
  });

  it("selects by solid", () => {
    const r = setLightmapScale(probe(), 8, { solidIds: [7] });
    expect(r.changed).toHaveLength(6);
    for (const c of r.changed) expect(c.solidId).toBe(7);
  });

  it("leaves faces already at the target scale alone", () => {
    const once = setLightmapScale(probe(), 32, {});
    const twice = setLightmapScale(once.text, 32, {});
    expect(twice.unchanged).toBe(true);
    expect(twice.text).toBe(once.text);
    expect(twice.alreadyAtScale).toBe(36);
    expect(twice.changed).toHaveLength(0);
  });

  it("warns about the per-axis cap rather than letting vbsp split faces quietly", () => {
    // The probe's floor is 576 units across. At scale 4 that is 145 luxels per axis,
    // far past the 32 vbsp allows on a brush face -- so it will subdivide the face.
    const r = setLightmapScale(probe(), 4, { solidIds: [7] });
    expect(r.warnings.join(" ")).toMatch(/MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER/);
    expect(r.warnings.join(" ")).toMatch(/splits the face/);
    expect(r.changed.some((c) => c.worstAxisAfter > MAX_BRUSH_LUXELS_PER_AXIS)).toBe(true);
  });

  it("carries the brush cap, not the displacement one", () => {
    // bspfile.h aliases MAX_LIGHTMAP_DIM_WITHOUT_BORDER to the *displacement* value of 125.
    // Reading the obvious name gives four times the real limit for a brush face.
    expect(MAX_BRUSH_LUXELS_PER_AXIS).toBe(32);
  });

  it("warns on a scale that is not a power of two, without refusing it", () => {
    const r = setLightmapScale(probe(), 24, { solidIds: [7] });
    expect(r.warnings.join(" ")).toMatch(/power of two/);
    expect(r.changed.length).toBeGreaterThan(0);
  });

  it("refuses a scale that is not a positive number", () => {
    expect(() => setLightmapScale(probe(), 0, {})).toThrow(VmfLightmapError);
    expect(() => setLightmapScale(probe(), -16, {})).toThrow(/positive/);
  });

  it("keeps every byte it did not change", () => {
    const before = probe();
    const after = setLightmapScale(before, 32, { solidIds: [7] }).text;
    expect(after.length).toBe(before.length);
    expect(after.replace(/"lightmapscale" "32"/g, '"lightmapscale" "16"')).toBe(before);
  });
});

describe("set_lightmap_scale", () => {
  const shape = z.object(setLightmapScaleTool.outputSchema!);

  it("refuses to touch the whole map without being told to", async () => {
    const path = join(scratch, "guard.vmf");
    writeFileSync(path, probe());
    expect(() => setLightmapScaleTool.handler({ path, scale: 32, confirm: true }, ctx)).toThrow(
      /all:true/,
    );
    expect(readFileSync(path, "utf8")).toBe(probe());
  });

  it("acts on the whole map when told to", async () => {
    const path = join(scratch, "all.vmf");
    writeFileSync(path, probe());
    const out = shape.parse(
      await setLightmapScaleTool.handler({ path, scale: 32, all: true, confirm: true }, ctx),
    );
    expect(out.written).toBe(true);
    expect(out.facesChanged).toBe(36);
    expect(out.luxelsAfter).toBeLessThan(out.luxelsBefore);
    expect(out.facesOverCap).toBe(0);
  });

  it("writes nothing on a dry run but still projects the bill", async () => {
    const path = join(scratch, "dry.vmf");
    writeFileSync(path, probe());
    const out = shape.parse(
      await setLightmapScaleTool.handler(
        { path, scale: 8, all: true, dryRun: true, confirm: true },
        ctx,
      ),
    );
    expect(out.written).toBe(false);
    expect(out.luxelsAfter).toBeGreaterThan(out.luxelsBefore);
    expect(readFileSync(path, "utf8")).toBe(probe());
  });
});

/**
 * The oracle: what vrad actually allocates.
 *
 * The projection above counts luxels from face extents. What matters is what fills
 * MAX_MAP_LIGHTING, and only vrad knows that -- so the same room is compiled at two scales
 * and the compiled budgets are compared.
 */
describe("what vrad does with the scale it was given", () => {
  const canCompile = has.toolchain;

  async function compiledLuxels(name: string, scale?: number): Promise<number> {
    const path = join(scratch, `${name}.vmf`);
    writeFileSync(path, probe());
    if (scale !== undefined) {
      await setLightmapScaleTool.handler({ path, scale, all: true, confirm: true }, ctx);
    }
    const r = (await runCompile.handler(
      {
        vmf: path,
        fast: true,
        hdr: false,
        stages: ["vbsp", "vvis", "vrad"],
        toolchain: "stock",
        cull: false,
        timeoutMinutes: 5,
        confirm: true,
      },
      ctx,
    )) as { leaked: boolean; bspExists: boolean };
    expect(r.leaked, name).toBe(false);
    expect(r.bspExists, name).toBe(true);
    return readLightmapBudget(path.replace(/\.vmf$/, ".bsp")).totalLuxels;
  }

  it.skipIf(!canCompile)(
    "allocates roughly a quarter of the luxels when the scale doubles",
    async () => {
      const fine = await compiledLuxels("vrad16");
      const coarse = await compiledLuxels("vrad32", 32);
      expect(coarse).toBeLessThan(fine);
      // Not asserted as exactly a quarter: vrad's off-by-one convention and its own face
      // splitting both round in the compiler's favour, and pinning the ratio would break
      // on a compiler nobody changed anything for. Halving is the claim.
      expect(coarse).toBeLessThan(fine / 2);
    },
    600_000,
  );
});
