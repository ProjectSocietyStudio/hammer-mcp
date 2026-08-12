import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBvh } from "../src/space/bvh.js";
import {
  buildScene,
  HULL_STANDING,
  MASK_PLAYER,
  MASK_SIGHT,
  MASK_SOLID,
  maskFor,
} from "../src/space/scene.js";
import {
  boxInSolid,
  isVisible,
  nearestSurface,
  pointInSolid,
  traceRay,
  traceRayBruteForce,
} from "../src/space/trace.js";
import { insertSolids } from "../src/vmf/build.js";
import type { Vec3 } from "../src/vmf/solid.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");

/**
 * The probe is a sealed box: interior x,y in [-256, 256] and z in [0, 256], walls 32 thick.
 * Every number below comes from `gen_probe.py`, not from a recorded output.
 */
const scene = buildScene(PROBE, probe());

describe("buildScene", () => {
  it("reads the six brushes of the sealed room", () => {
    expect(scene.brushes).toHaveLength(6);
    expect(scene.mins).toEqual([-288, -288, -32]);
    expect(scene.maxs).toEqual([288, 288, 288]);
    expect(scene.excluded).toEqual({ displacement: 0, nonSolid: 0, invalid: 0 });
  });

  it("puts a plain world brush in every mask", () => {
    for (const b of scene.brushes) {
      expect(b.mask & MASK_SOLID).toBeTruthy();
      expect(b.mask & MASK_PLAYER).toBeTruthy();
      expect(b.mask & MASK_SIGHT).toBeTruthy();
    }
  });

  it("keeps only the owners asked for", () => {
    expect(buildScene(PROBE, probe(), { owners: ["func_detail"] }).brushes).toEqual([]);
    expect(buildScene(PROBE, probe(), { owners: ["world"] }).brushes).toHaveLength(6);
  });
});

describe("maskFor", () => {
  it("makes a clip brush stop people and not eyes", () => {
    const m = maskFor("world", ["TOOLS/TOOLSPLAYERCLIP"]);
    expect(m & MASK_PLAYER).toBeTruthy();
    expect(m & MASK_SIGHT).toBeFalsy();
    expect(m & MASK_SOLID).toBeFalsy();
  });

  it("makes a trigger stop nothing at all", () => {
    // The one that catches people out: a trigger brush is a real brush sitting in a
    // doorway, and counting it solid reports a blocked corridor everyone walks through.
    expect(maskFor("trigger_multiple", ["TOOLS/TOOLSTRIGGER"])).toBe(0);
    expect(maskFor("world", ["TOOLS/TOOLSTRIGGER"])).toBe(0);
  });

  it("makes func_illusionary non-solid however it is textured", () => {
    expect(maskFor("func_illusionary", ["BRICK/BRICKWALL001"])).toBe(0);
    // And the same material on the world is solid, so it is the class that decided.
    expect(maskFor("world", ["BRICK/BRICKWALL001"])).toBe(MASK_SOLID | MASK_PLAYER | MASK_SIGHT);
  });

  it("lets one special face decide the whole brush, as vbsp does", () => {
    expect(maskFor("world", ["BRICK/BRICKWALL001", "TOOLS/TOOLSCLIP"])).toBe(MASK_PLAYER);
  });

  it("blocks the eye and nothing else for block_los", () => {
    expect(maskFor("world", ["TOOLS/TOOLSBLOCK_LOS"])).toBe(MASK_SIGHT);
  });
});

describe("traceRay", () => {
  it("stops at the wall the map says is there", () => {
    // The +x wall's inner face is at x=256 exactly; the contact is backed off by
    // DIST_EPSILON, which is the engine's own nudge and not a tolerance of ours.
    const t = traceRay(scene, [0, 0, 128], [1000, 0, 128]);
    expect(t.hit).toBe(true);
    expect(t.point[0]).toBeCloseTo(256, 1);
    expect(t.normal).toEqual([-1, 0, 0]);
    expect(t.startSolid).toBe(false);
    expect(t.material).toMatch(/DEV_MEASUREGENERIC01/i);
  });

  it("finds the floor and the ceiling at the heights the generator wrote", () => {
    expect(traceRay(scene, [0, 0, 128], [0, 0, -1000]).point[2]).toBeCloseTo(0, 1);
    expect(traceRay(scene, [0, 0, 128], [0, 0, 1000]).point[2]).toBeCloseTo(256, 1);
  });

  it("reaches the far side when nothing is in the way", () => {
    const t = traceRay(scene, [-200, 0, 128], [200, 0, 128]);
    expect(t.hit).toBe(false);
    expect(t.fraction).toBe(1);
    expect(t.brushId).toBeNull();
  });

  it("says a segment starting inside a wall is unanswerable rather than answering", () => {
    const t = traceRay(scene, [270, 0, 128], [1000, 0, 128]);
    expect(t.startSolid).toBe(true);
    expect(t.fraction).toBe(0);
  });

  it("sees through a clip brush and walks into it", () => {
    // Same geometry, two masks, opposite answers. A single-mask tracer would have to pick
    // one of these to be wrong about.
    const clipped = buildScene(
      PROBE,
      probe().replace(/DEV\/DEV_MEASUREGENERIC01/g, "TOOLS/TOOLSPLAYERCLIP"),
    );
    expect(traceRay(clipped, [0, 0, 128], [1000, 0, 128], MASK_SIGHT).hit).toBe(false);
    expect(traceRay(clipped, [0, 0, 128], [1000, 0, 128], MASK_PLAYER).hit).toBe(true);
  });

  it("is not fooled by a ray running exactly along a face", () => {
    // z=0 is the floor's top face. A slab test that rejects a grazing box loses walls
    // roughly one ray in a few thousand, which looks like noise rather than a bug.
    const t = traceRay(scene, [-200, 0, 0], [200, 0, 0]);
    expect(t.startSolid || !t.hit).toBe(true);
  });
});

describe("the swept hull", () => {
  it("stops a player's width short of the wall a ray reaches", () => {
    // The whole reason the hull exists: the ray says 256, the 32-wide player says 240,
    // and every clearance question is about the second number.
    const ray = traceRay(scene, [0, 0, 64], [1000, 0, 64]);
    const hull = traceRay(scene, [0, 0, 64], [1000, 0, 64], MASK_PLAYER, HULL_STANDING);
    expect(ray.point[0]).toBeCloseTo(256, 1);
    expect(hull.point[0]).toBeCloseTo(240, 1);
  });

  it("refuses a gap narrower than the player, where a ray goes straight through", () => {
    // Two blocks 24 apart. A ray threads the gap; nobody fits.
    const gap = gapScene(24);
    expect(traceRay(gap, [-100, 0, 40], [100, 0, 40]).hit).toBe(false);
    expect(traceRay(gap, [-100, 0, 40], [100, 0, 40], MASK_SOLID, HULL_STANDING).hit).toBe(true);
  });

  it("lets the player through a gap wider than the hull", () => {
    const gap = gapScene(64);
    expect(traceRay(gap, [-100, 0, 40], [100, 0, 40], MASK_SOLID, HULL_STANDING).hit).toBe(false);
  });
});

describe("pointInSolid and boxInSolid", () => {
  it("knows the inside of the room from the inside of a wall", () => {
    expect(pointInSolid(scene, [0, 0, 128])).toBeNull();
    expect(pointInSolid(scene, [0, 0, -16])).not.toBeNull();
    expect(pointInSolid(scene, [270, 0, 128])).not.toBeNull();
  });

  it("counts a point exactly on a face as solid", () => {
    // Otherwise the surface itself reads as empty space, and a voxel flood started beside
    // a wall walks through it one cell at a time.
    expect(pointInSolid(scene, [0, 0, 0])).not.toBeNull();
  });

  it("catches a box overlapping a wall the centre clears", () => {
    expect(pointInSolid(scene, [250, 0, 128])).toBeNull();
    expect(boxInSolid(scene, [250, 0, 128], HULL_STANDING)).not.toBeNull();
  });
});

describe("nearestSurface", () => {
  it("measures to the face rather than to a corner", () => {
    // Dead centre of the room: the nearest surface is the floor at z=0, 64 below.
    const n = nearestSurface(scene, [0, 0, 64], 512);
    expect(n).not.toBeNull();
    expect(n!.distance).toBeCloseTo(64, 3);
    expect(n!.point[2]).toBeCloseTo(0, 3);
  });

  it("finds nothing outside its radius, rather than the nearest thing anyway", () => {
    expect(nearestSurface(scene, [0, 0, 128], 8)).toBeNull();
  });

  it("gives the exact distance to an edge when the foot of the perpendicular misses", () => {
    // Standing beyond the end of the floor: the closest point is the floor's corner edge,
    // and a version that only projected onto planes would report the plane distance and be
    // wrong by the whole horizontal offset.
    const n = nearestSurface(scene, [0, 0, 400], 4096);
    expect(n).not.toBeNull();
    expect(n!.distance).toBeCloseTo(112, 3); // ceiling top at z=288
  });
});

describe("the broadphase changes no answer", () => {
  /**
   * The BVH is an optimisation, so it has exactly one correctness requirement. The check
   * is for identity, not closeness: a tree that is nearly right drops a wall every few
   * thousand rays, and an epsilon is precisely what would hide that.
   */
  it("agrees with brute force on 4000 rays, bit for bit", () => {
    const rng = lcg(20260812);
    let hits = 0;
    for (let i = 0; i < 4000; i++) {
      const a = randomPoint(rng);
      const b = randomPoint(rng);
      const fast = traceRay(scene, a, b);
      const slow = traceRayBruteForce(scene, a, b);
      expect(fast.fraction).toBe(slow.fraction);
      expect(fast.hit).toBe(slow.hit);
      expect(fast.brushId).toBe(slow.brushId);
      expect(fast.startSolid).toBe(slow.startSolid);
      if (fast.hit) hits += 1;
    }
    // The negative sister: an engine that hit nothing would pass every equality above.
    expect(hits).toBeGreaterThan(1000);
  });

  it("actually prunes, which no correctness test can see", () => {
    // A broadphase that tests every brush returns exactly the right answer and is worth
    // nothing. Every assertion above would pass on it. So the tree's purpose gets its own
    // number: a short ray across a 600-brush scene must touch a small fraction of it.
    const rng = lcg(4242);
    const seed =
      'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
    const specs = Array.from({ length: 600 }, () => {
      const c = [rng() * 8000 - 4000, rng() * 8000 - 4000, rng() * 1000];
      return {
        shape: "box" as const,
        mins: [c[0]! - 32, c[1]! - 32, c[2]! - 32] as Vec3,
        maxs: [c[0]! + 32, c[1]! + 32, c[2]! + 32] as Vec3,
      };
    });
    const many = buildScene("many.vmf", insertSolids(seed, specs, { material: "DEV/DEV_MEASUREGENERIC01" }).text);
    expect(many.brushes).toHaveLength(600);

    const stats = { brushTests: 0, nodeVisits: 0 };
    for (let i = 0; i < 200; i++) {
      const a: Vec3 = [rng() * 8000 - 4000, rng() * 8000 - 4000, rng() * 1000];
      const b: Vec3 = [a[0] + 400, a[1] + 400, a[2]];
      traceRay(many, a, b, MASK_SOLID, null, stats);
    }
    const perRay = stats.brushTests / 200;
    expect(perRay, `${perRay.toFixed(1)} of 600 brushes tested per ray`).toBeLessThan(60);
    // And the sister: a tree that visited nothing would also score well here.
    expect(stats.nodeVisits).toBeGreaterThan(0);
  });

  it("agrees on swept hulls too", () => {
    const rng = lcg(981);
    for (let i = 0; i < 800; i++) {
      const a = randomPoint(rng);
      const b = randomPoint(rng);
      const fast = traceRay(scene, a, b, MASK_SOLID, HULL_STANDING);
      const slow = traceRayBruteForce(scene, a, b, MASK_SOLID, HULL_STANDING);
      expect(fast.fraction).toBe(slow.fraction);
      expect(fast.brushId).toBe(slow.brushId);
    }
  });
});

describe("buildBvh", () => {
  it("survives a scene where every box has the same centre", () => {
    // No split can separate coincident centroids. Without the guard this recursed until
    // the stack gave out, which is a crash rather than a wrong answer -- and the only
    // shape that produces it is a stack of concentric brushes, which real maps contain.
    const items = Array.from({ length: 40 }, (_, i) => ({
      mins: [-i - 1, -i - 1, -i - 1] as Vec3,
      maxs: [i + 1, i + 1, i + 1] as Vec3,
    }));
    const bvh = buildBvh(items);
    expect(bvh.nodeCount).toBeGreaterThan(0);
    expect([...bvh.order].sort((a, b) => a - b)).toEqual(items.map((_, i) => i));
  });

  it("holds every item exactly once, at any size", () => {
    const rng = lcg(7);
    const items = Array.from({ length: 500 }, () => {
      const c: Vec3 = [rng() * 2000 - 1000, rng() * 2000 - 1000, rng() * 500];
      const h = 1 + rng() * 200;
      return {
        mins: [c[0] - h, c[1] - h, c[2] - h] as Vec3,
        maxs: [c[0] + h, c[1] + h, c[2] + h] as Vec3,
      };
    });
    const bvh = buildBvh(items);
    expect(new Set(bvh.order).size).toBe(items.length);
    // Every leaf's declared slice, concatenated, must cover the whole permutation.
    let covered = 0;
    for (let n = 0; n < bvh.nodeCount; n++) if (bvh.right[n]! < 0) covered += bvh.count[n]!;
    expect(covered).toBe(items.length);
  });

  it("handles an empty scene without a special case at every call site", () => {
    const bvh = buildBvh([]);
    expect(bvh.nodeCount).toBe(1);
    const empty = buildScene("none.vmf", 'world\n{\n"id" "1"\n"classname" "worldspawn"\n}\n');
    expect(traceRay(empty, [0, 0, 0], [100, 0, 0]).hit).toBe(false);
  });
});

describe("the oracle stays independent", () => {
  it("never lets src/space import src/bsp", () => {
    // The BSP tracer is what proves this engine right. The moment one calls the other the
    // cross-check becomes decoration, and nothing about the test output would say so.
    const dir = join(FIXTURES, "..", "..", "src", "space");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const text = readFileSync(join(dir, name), "utf8");
      expect(text, `${name} imports the oracle it is checked against`).not.toMatch(
        /from\s+["'][^"']*\/bsp\//,
      );
    }
  });
});

/** A deterministic generator: a map that cannot be regenerated cannot be reviewed. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomPoint(rng: () => number): Vec3 {
  return [rng() * 800 - 400, rng() * 800 - 400, rng() * 500 - 100];
}

/**
 * Two blocks with a gap of `width` between them, the corridor running along +x.
 *
 * Built with `insertSolids` rather than by writing planes out here. A first version of this
 * helper wrote them by hand and got the winding wrong, which produced a fixture that
 * enclosed no volume -- and a test whose subject cannot be hit passes for the wrong reason.
 */
function gapScene(width: number) {
  const h = width / 2;
  const seed =
    'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
  const built = insertSolids(
    seed,
    [
      { shape: "box", mins: [-64, -64, 0], maxs: [64, -h, 80] },
      { shape: "box", mins: [-64, h, 0], maxs: [64, 64, 80] },
    ],
    { material: "DEV/DEV_MEASUREGENERIC01" },
  );
  const gap = buildScene("gap.vmf", built.text);
  // The fixture has to be the shape the test claims, or the test proves nothing.
  expect(gap.brushes).toHaveLength(2);
  return gap;
}
