import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readEntityLump } from "../src/bsp/entities.js";
import { readModels, worldExtents } from "../src/bsp/models.js";
import {
  columnSurfaces,
  CONTENTS_SOLID,
  isVisible,
  pointContents,
  readTree,
  traceRay,
} from "../src/bsp/trace.js";
import type { Vec3 } from "../src/entity/model.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readSightlines } from "../src/tools/measure.js";
import { FIXTURES, ctx as sharedCtx, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const NYCITY = paths.prodMap;
const hasProd = has.prodMap;

const ctx = sharedCtx as unknown as ToolContext;

describe("world tree tracing, against the sealed probe room", () => {
  const tree = readTree(PROBE);
  const extents = worldExtents(readModels(PROBE));
  const spawn = readEntityLump(PROBE).entities.find(
    (e) => e.classname === "info_player_start",
  )!;
  const inside: Vec3 = [spawn.origin![0], spawn.origin![1], spawn.origin![2] + 40];
  const outside: Vec3 = [
    extents.maxs[0] + 512,
    extents.maxs[1] + 512,
    extents.maxs[2] + 512,
  ];

  it("calls the room empty and the outside solid", () => {
    expect(pointContents(tree, inside) & CONTENTS_SOLID).toBe(0);
    expect(pointContents(tree, outside) & CONTENTS_SOLID).toBe(CONTENTS_SOLID);
  });

  it("sees across the room", () => {
    expect(isVisible(tree, inside, [inside[0] + 64, inside[1] + 64, inside[2]])).toBe(true);
  });

  it("cannot see out of a sealed room", () => {
    // The negative control that matters: the probe map is one sealed box, so a ray
    // leaving it MUST be stopped. A tracer that reported clear here would report clear
    // everywhere, and every sightline it produced would be the map diagonal.
    const t = traceRay(tree, inside, outside);
    expect(t.hit).toBe(true);
    expect(t.fraction).toBeLessThan(1);
  });

  it("finds the floor under the spawn", () => {
    const levels = columnSurfaces(
      tree,
      spawn.origin![0],
      spawn.origin![1],
      extents.maxs[2] - 16,
      extents.mins[2] + 1,
      64,
    );
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[levels.length - 1]!.groundZ).toBeLessThan(spawn.origin![2] + 8);
  });
});

describe("the tracer agrees with dense point sampling", () => {
  // The oracle for the recursion itself, independent of any map semantics: walking the
  // segment and asking for contents at each step must reach the same verdict as one
  // tree descent. Deterministic seed so a failure is reproducible.
  const check = (path: string, pairs: number, steps: number): { agree: number; total: number } => {
    const tree = readTree(path);
    const e = worldExtents(readModels(path));
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const rp = (): Vec3 => [
      e.mins[0] + rnd() * (e.maxs[0] - e.mins[0]),
      e.mins[1] + rnd() * (e.maxs[1] - e.mins[1]),
      e.mins[2] + rnd() * (e.maxs[2] - e.mins[2]),
    ];

    let agree = 0;
    let total = 0;
    for (let k = 0; k < pairs; k++) {
      const a = rp();
      const b = rp();
      if (pointContents(tree, a) & CONTENTS_SOLID) continue;
      if (pointContents(tree, b) & CONTENTS_SOLID) continue;
      let sampledSolid = false;
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const p: Vec3 = [
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f,
        ];
        if (pointContents(tree, p) & CONTENTS_SOLID) {
          sampledSolid = true;
          break;
        }
      }
      total++;
      if (traceRay(tree, a, b).hit === sampledSolid) agree++;
    }
    return { agree, total };
  };

  it("on the probe", () => {
    const { agree, total } = check(PROBE, 400, 400);
    expect(total).toBeGreaterThan(0);
    expect(agree).toBe(total);
  });

  it.skipIf(!hasProd)("on the production map", () => {
    // Sampling can miss a wall thinner than its step, so a handful of disagreements
    // is expected and only a rate matters. Measured 1275/1276 on 11/08/2026.
    const { agree, total } = check(NYCITY, 1500, 600);
    expect(total).toBeGreaterThan(500);
    expect(agree / total).toBeGreaterThan(0.99);
  }, 120_000);
});

describe("read_sightlines", () => {
  it("returns a schema-shaped answer on the probe", async () => {
    const out = await readSightlines.handler(
      {
        path: PROBE,
        spacing: 64,
        eyeHeight: 64,
        elevationTolerance: 512,
        requireNearbyContent: false,
        limit: 3,
      },
      ctx,
    );
    expect(() => z.object(readSightlines.outputSchema!).parse(out)).not.toThrow();
    const r = out as { samplePoints: number; longest: Array<{ units: number }> };
    expect(r.samplePoints).toBeGreaterThan(0);
    // A 576-unit room cannot hold a longer line than its own diagonal.
    for (const l of r.longest) expect(l.units).toBeLessThan(1100);
  });

  it.skipIf(!hasProd)("samples at the elevation where the map's content lives", async () => {
    // Not the first surface a downward trace meets, which is the roof, and not the
    // lowest, which is the floor of the skybox shell at z=-6144. Both were tried and
    // both produced confident nonsense.
    const out = (await readSightlines.handler(
      {
        path: NYCITY,
        spacing: 1024,
        eyeHeight: 64,
        elevationTolerance: 512,
        requireNearbyContent: true,
        limit: 3,
      },
      ctx,
    )) as { elevation: number; samplePoints: number; longest: Array<{ metres: number }> };

    expect(out.elevation).toBeGreaterThan(-500);
    expect(out.elevation).toBeLessThan(1000);
    expect(out.samplePoints).toBeGreaterThan(100);
    expect(out.longest[0]!.metres).toBeGreaterThan(50);
    // Nothing can be longer than the map itself.
    expect(out.longest[0]!.metres).toBeLessThan(1200);
  }, 120_000);
});
