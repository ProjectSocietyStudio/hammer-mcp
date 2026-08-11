import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { readVisleafStats } from "../src/bsp/visleaf.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { writeVmfSolidTool } from "../src/tools/build.js";
import { setSolidClassTool } from "../src/tools/optimise.js";
import { reclassSolids, VmfReclassError } from "../src/vmf/reclass.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-reclass-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const probe = (): string => readFileSync(PROBE, "utf8");
const owners = (text: string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of checkVmfSolids("x", text).solids) out[s.owner] = (out[s.owner] ?? 0) + 1;
  return out;
};
/** The probe's six world solids: floor, ceiling, then four walls. */
const FLOOR = 7;
const WALL = 21;

describe("reclassSolids", () => {
  it("moves a world brush into a new func_detail, geometry untouched", () => {
    const before = probe();
    const r = reclassSolids(before, [WALL], { to: "entity", classname: "func_detail" });
    expect(r.unchanged).toBe(false);
    expect(r.moved).toEqual([{ id: WALL, from: "world", to: "func_detail" }]);
    expect(r.createdEntityId).not.toBeNull();
    expect(owners(r.text)).toEqual({ world: 5, func_detail: 1 });

    // A move changes ownership and nothing else. Same count, same shape.
    const was = checkVmfSolids("x", before).solids.find((s) => s.id === WALL)!;
    const now = checkVmfSolids("x", r.text).solids.find((s) => s.id === WALL)!;
    expect(now.volume).toBe(was.volume);
    expect(now.mins).toEqual(was.mins);
    expect(now.sides.map((s) => s.material)).toEqual(was.sides.map((s) => s.material));
  });

  it("moves several into one entity, and back to the world again", () => {
    const detailed = reclassSolids(probe(), [WALL, 28], {
      to: "entity",
      classname: "func_detail",
    });
    expect(owners(detailed.text)).toEqual({ world: 4, func_detail: 2 });

    const back = reclassSolids(detailed.text, [WALL, 28], { to: "world" });
    // The func_detail entity survives with no solids in it; `owners` counts solids, so it
    // simply stops appearing. Hammer prunes empty brush entities on save.
    expect(owners(back.text)).toEqual({ world: 6 });
  });

  it("adds to an existing entity when given its id", () => {
    const first = reclassSolids(probe(), [WALL], { to: "entity", classname: "func_detail" });
    const second = reclassSolids(first.text, [28], {
      to: "entity",
      classname: "func_detail",
      entityId: first.createdEntityId!,
    });
    expect(second.createdEntityId).toBeNull();
    expect(owners(second.text)).toEqual({ world: 4, func_detail: 2 });
  });

  it("refuses an entity whose class is not the one asked for", () => {
    const first = reclassSolids(probe(), [WALL], { to: "entity", classname: "func_detail" });
    expect(() =>
      reclassSolids(first.text, [28], {
        to: "entity",
        classname: "func_illusionary",
        entityId: first.createdEntityId!,
      }),
    ).toThrow(/is a func_detail, not a func_illusionary/);
  });

  it("leaves a solid already in the target alone rather than rewriting it", () => {
    const first = reclassSolids(probe(), [WALL], { to: "entity", classname: "func_detail" });
    const again = reclassSolids(first.text, [WALL], { to: "entity", classname: "func_detail" });
    expect(again.unchanged).toBe(true);
    expect(again.text).toBe(first.text);
    expect(again.warnings.join(" ")).toMatch(/already belongs/);
  });

  it("names the ids it could not find", () => {
    expect(() => reclassSolids(probe(), [999], { to: "world" })).toThrow(/999/);
  });

  it("refuses to unhide a brush as a side effect of moving it", () => {
    // Hammer wraps a visgroup-hidden brush in `hidden { solid { ... } }`. Moving it out
    // would make it visible again, which is not what the caller asked for.
    const text = probe().replace(
      /(\tsolid\n\t\{\n\t\t"id" "21"[\s\S]*?\n\t\}\n)/,
      "\thidden\n\t{\n$1\t}\n",
    );
    expect(owners(text)).toEqual({ world: 6 });
    expect(() => reclassSolids(text, [WALL], { to: "entity", classname: "func_detail" })).toThrow(
      /hidden/,
    );
  });

  it("warns when nothing is left holding the hull", () => {
    const all = [7, 14, 21, 28, 35, 42];
    const r = reclassSolids(probe(), all, { to: "entity", classname: "func_detail" });
    expect(r.warnings.join(" ")).toMatch(/no brushes at all/);
    expect(r.warnings.join(" ")).toMatch(/leak/);
  });

  it("keeps every byte it did not move exactly where it was", () => {
    const before = probe();
    const after = reclassSolids(before, [WALL], { to: "entity", classname: "func_detail" }).text;
    // The moved block is cut from one place and appears at another; what must hold is that
    // its text is identical, not merely equivalent.
    const block = before.match(/\tsolid\n\t\{\n\t\t"id" "21"[\s\S]*?\n\t\}\n/)![0];
    expect(after).toContain(block);
    expect(after.split(block)).toHaveLength(2);
  });
});

describe("set_solid_class", () => {
  const shape = z.object(setSolidClassTool.outputSchema!);

  it("writes nothing on a dry run", async () => {
    const path = join(scratch, "dry.vmf");
    writeFileSync(path, probe());
    const out = shape.parse(
      await setSolidClassTool.handler(
        { path, solidIds: [WALL], to: "func_detail", dryRun: true, confirm: true },
        ctx,
      ),
    );
    expect(out.written).toBe(false);
    expect(out.moved).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe(probe());
  });

  it("reports what still holds the world, and what to compile next", async () => {
    const path = join(scratch, "one.vmf");
    writeFileSync(path, probe());
    const out = shape.parse(
      await setSolidClassTool.handler(
        { path, solidIds: [WALL], to: "func_detail", confirm: true },
        ctx,
      ),
    );
    expect(out.written).toBe(true);
    expect(out.worldSolidsAfter).toBe(5);
    expect(out.nextStep).toMatch(/leak/);
    expect(owners(readFileSync(path, "utf8"))).toEqual({ world: 5, func_detail: 1 });
  });

  it("does not touch the file when there is nothing to move", async () => {
    const path = join(scratch, "noop.vmf");
    writeFileSync(path, probe());
    await setSolidClassTool.handler(
      { path, solidIds: [WALL], to: "func_detail", confirm: true },
      ctx,
    );
    const once = readFileSync(path, "utf8");
    const out = shape.parse(
      await setSolidClassTool.handler(
        { path, solidIds: [WALL], to: "func_detail", confirm: true },
        ctx,
      ),
    );
    expect(out.unchanged).toBe(true);
    expect(out.written).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(once);
  });
});

/**
 * The differential oracle, and the negative control that gives it meaning.
 *
 * func_detail is worth doing because it takes brushes out of the BSP tree. That claim is
 * checkable: compile the same room both ways and count the leaves. And the trap is
 * checkable too -- move a wall of a sealed room into a func_detail and vbsp must leak,
 * because func_detail does not seal.
 */
describe("what func_detail actually does to the tree", () => {
  const canCompile = has.toolchain;

  async function compileAt(
    path: string,
  ): Promise<{ leaked: boolean; leafCount: number; clusterCount: number | null }> {
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
    )) as { leaked: boolean; bspExists: boolean };
    if (r.leaked || !r.bspExists) {
      return { leaked: true, leafCount: 0, clusterCount: null };
    }
    const v = readVisleafStats(path.replace(/\.vmf$/, ".bsp"));
    return { leaked: false, leafCount: v.leafCount, clusterCount: v.clusterCount };
  }

  async function compiled(
    name: string,
    move?: { ids: number[]; to: string },
  ): Promise<{ leaked: boolean; leafCount: number; clusterCount: number | null }> {
    const path = join(scratch, `c_${name}.vmf`);
    writeFileSync(path, probe());
    if (move) {
      await setSolidClassTool.handler({ path, solidIds: move.ids, to: move.to, confirm: true }, ctx);
    }
    return compileAt(path);
  }

  it.skipIf(!canCompile)(
    "leaks when a wall of the sealed hull is made detail -- the trap, proven",
    async () => {
      const r = await compiled("wall_detail", { ids: [WALL], to: "func_detail" });
      expect(r.leaked).toBe(true);
    },
    600_000,
  );

  it.skipIf(!canCompile)(
    "takes an interior pillar out of the tree, and the room still seals",
    async () => {
      // Every one of the probe's six brushes is hull -- including the floor, which was
      // measured leaking when detailed, because the void is directly under it. A bare
      // sealed box has no brush that is safe to detail, which is itself the lesson.
      //
      // So the positive case needs a brush that is not holding anything up: a pillar
      // standing inside the room. Structural, it splits the space around it into slivers
      // for no benefit. That is precisely what func_detail is for.
      // Off-centre on purpose: the probe's info_player_start sits at the origin, and a
      // pillar built around it puts an entity inside solid, which vbsp reports as a leak.
      // Measured, not guessed -- the centred version of this test failed exactly that way.
      const pillar: { shape: "box"; mins: [number, number, number]; maxs: [number, number, number] } =
        { shape: "box", mins: [96, 96, 0], maxs: [160, 160, 256] };

      const structural = join(scratch, "pillar_world.vmf");
      writeFileSync(structural, probe());
      const made = (await writeVmfSolidTool.handler(
        { path: structural, solids: [pillar], material: "DEV/DEV_MEASUREGENERIC01", confirm: true },
        ctx,
      )) as { solidIds: number[] };
      const pillarId = made.solidIds[0]!;

      const detailed = join(scratch, "pillar_detail.vmf");
      writeFileSync(detailed, readFileSync(structural, "utf8"));
      await setSolidClassTool.handler(
        { path: detailed, solidIds: [pillarId], to: "func_detail", confirm: true },
        ctx,
      );

      const a = await compileAt(structural);
      const b = await compileAt(detailed);

      expect(a.leaked, "structural pillar").toBe(false);
      expect(b.leaked, "detail pillar").toBe(false);
      // The whole point: the same room, the same pillar, fewer leaves.
      expect(b.leafCount).toBeLessThan(a.leafCount);
    },
    600_000,
  );
});
