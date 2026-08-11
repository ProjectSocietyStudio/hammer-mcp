import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readVisleafStats } from "../src/bsp/visleaf.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { writeHintBrushTool } from "../src/tools/optimise.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-optimise-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const probe = (): string => readFileSync(PROBE, "utf8");
const shape = z.object(writeHintBrushTool.outputSchema!);

async function hint(
  name: string,
  extra: Record<string, unknown> = {},
): Promise<{ path: string; out: z.infer<typeof shape> }> {
  const path = join(scratch, `${name}.vmf`);
  writeFileSync(path, probe());
  const out = shape.parse(
    await writeHintBrushTool.handler(
      { path, mins: [-256, -8, 0], maxs: [256, 8, 256], confirm: true, ...extra },
      ctx,
    ),
  );
  return { path, out };
}

describe("write_hint_brush", () => {
  it("hints the two largest faces and skips the rest", async () => {
    const { path, out } = await hint("axial");
    expect(out.valid).toBe(true);
    expect(out.hintFaceCount).toBe(2);
    expect(out.skipFaceCount).toBe(4);

    const solid = checkVmfSolids(path, readFileSync(path, "utf8")).solids.find(
      (s) => s.id === out.solidId,
    )!;
    const hinted = solid.sides.filter((s) => s.material === "TOOLS/TOOLSHINT");
    expect(hinted).toHaveLength(2);
    // The two hinted faces must be the opposing pair, or the slab gets hinted edge-on and
    // vvis is asked to cut along a sliver.
    // `+ 0` collapses the negative zero unary minus produces on an axis-aligned normal.
    expect(hinted[0]!.plane!.normal.map((c) => -c + 0)).toEqual(
      hinted[1]!.plane!.normal.map((c) => c + 0),
    );
  });

  it("hints every face when told to", async () => {
    const { out } = await hint("all", { hintFaces: "all" });
    expect(out.hintFaceCount).toBe(6);
    expect(out.skipFaceCount).toBe(0);
  });

  it("turns the slab and keeps it a closed volume", async () => {
    for (const rotateZ of [15, 30, 45, 60, 90, 137]) {
      const { out } = await hint(`rot${rotateZ}`, { rotateZ });
      expect(out.valid, `${rotateZ} degrees`).toBe(true);
      expect(out.hintFaceCount, `${rotateZ} degrees`).toBe(2);
    }
  });

  it("reports the volume it really made, rounding included", async () => {
    // Rotating a thin slab and rounding its corners to whole units changes its thickness
    // by up to a unit, so the volume moves. Reported rather than smoothed over: a caller
    // asking for a 16-unit slab at 45 degrees does not get exactly 16 units.
    const straight = await hint("vol0");
    const turned = await hint("vol45", { rotateZ: 45 });
    expect(straight.out.volume).toBe(512 * 16 * 256);
    expect(turned.out.volume).not.toBe(straight.out.volume);
    expect(turned.out.grid).toBe(1);
  });

  it("writes nothing on a dry run", async () => {
    const path = join(scratch, "dry.vmf");
    writeFileSync(path, probe());
    const out = shape.parse(
      await writeHintBrushTool.handler(
        { path, mins: [-256, -8, 0], maxs: [256, 8, 256], dryRun: true, confirm: true },
        ctx,
      ),
    );
    expect(out.written).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(probe());
  });
});

/**
 * The differential oracle.
 *
 * Everything above checks that the brush is well formed. None of it checks that it does
 * anything, and a hint brush that changes no leaf count is worse than none -- it still
 * costs a plane in the tree. So the room is compiled three ways and the visibility split
 * is compared.
 */
describe("does the hint actually split anything", () => {
  const canCompile = has.toolchain;

  async function leaves(name: string, extra?: Record<string, unknown>): Promise<{
    leafCount: number;
    clusterCount: number | null;
    visibilityBytes: number;
  }> {
    const path = join(scratch, `vis_${name}.vmf`);
    writeFileSync(path, probe());
    if (extra) {
      await writeHintBrushTool.handler(
        { path, mins: [-256, -8, 0], maxs: [256, 8, 256], confirm: true, ...extra },
        ctx,
      );
    }
    const r = (await runCompile.handler(
      {
        vmf: path,
        fast: false,
        hdr: false,
        stages: ["vbsp", "vvis"],
        toolchain: "stock",
        cull: false,
        timeoutMinutes: 5,
        confirm: true,
      },
      ctx,
    )) as { bspExists: boolean; leaked: boolean };
    expect(r.leaked, name).toBe(false);
    expect(r.bspExists, name).toBe(true);
    return readVisleafStats(path.replace(/\.vmf$/, ".bsp"));
  }

  it.skipIf(!canCompile)(
    "splits more with a hint than without, and more again on the diagonal",
    async () => {
      const control = await leaves("control");
      const axial = await leaves("axial", {});
      const diagonal = await leaves("diagonal", { rotateZ: 45 });

      // Measured 11/08/2026 with the stock GMod compilers: 29/4/44, 33/8/84, 35/10/124
      // for control, axial and diagonal. The exact numbers are a compiler's business and
      // are not asserted; the ordering is the claim.
      expect(axial.clusterCount!).toBeGreaterThan(control.clusterCount!);
      expect(axial.leafCount).toBeGreaterThan(control.leafCount);

      // The finding this tool exists for: a diagonal cut is not the same cut turned round,
      // it subdivides further. That is what a city whose streets do not follow the axes
      // needs, and it is why one author's maps carry ~80x the diagonal split planes of a
      // same-genre control.
      expect(diagonal.clusterCount!).toBeGreaterThan(axial.clusterCount!);
      expect(diagonal.visibilityBytes).toBeGreaterThan(axial.visibilityBytes);
    },
    600_000,
  );
});
