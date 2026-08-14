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
import { findRooms } from "../src/space/rooms.js";
import { voxelise } from "../src/space/voxel.js";
import { insertSolids } from "../src/vmf/build.js";
import { deleteSolids } from "../src/vmf/modify.js";
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

// #73. Found building hmcp_backyard: a rules file asked that the garden NOT be visible from
// the living room, check_vmf_rules reported pass, and read_vmf_trace with mask "sight" set
// explicitly named the window pane as what stopped it. A mustBe:"blocked" that passes because
// of a window is a green asserting the opposite of the truth, and rp_nycity_day is a city of
// shopfronts.
describe("maskFor and glass (#73)", () => {
  it("lets an eye through a pane while a body still stops at it", () => {
    const m = maskFor("world", ["GLASS/GLASSWINDOW002A"]);
    expect(m & MASK_SOLID).toBeTruthy();
    expect(m & MASK_PLAYER).toBeTruthy();
    expect(m & MASK_SIGHT).toBeFalsy();
  });

  it("does not make a wall see-through because one face of it is glazed", () => {
    // A window frame textured glass on its reveal and brick everywhere else is a wall.
    const m = maskFor("world", ["GLASS/GLASSWINDOW002A", "BRICK/BRICKWALL014A"]);
    expect(m & MASK_SIGHT).toBeTruthy();
  });

  it("ignores nodraw beside the glass, which is how a pane is usually built", () => {
    const m = maskFor("world", ["GLASS/GLASSWINDOW002A", "TOOLS/TOOLSNODRAW"]);
    expect(m & MASK_SIGHT).toBeFalsy();
    expect(m & MASK_SOLID).toBeTruthy();
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

/**
 * #73, end to end: a glazed partition across the probe.
 *
 * Found building `hmcp_backyard`, whose rules file asked that the garden not be visible from
 * the living room. `check_vmf_rules` said pass; `read_vmf_trace` with `mask: "sight"` set
 * explicitly named the window pane as what stopped it. A `mustBe: "blocked"` that passes
 * because of a window is a green asserting the opposite of what a player sees, and
 * `rp_nycity_day` is a city of shopfronts.
 *
 * Built here rather than measured on that map, so the assertion is about the tracer and not
 * about one map's design.
 */
describe("a line of sight through glass (#73)", () => {
  const glazed = (material: string): ReturnType<typeof buildScene> =>
    buildScene(
      PROBE,
      insertSolids(probe(), [{ shape: "box", mins: [-8, -256, 0], maxs: [8, 256, 256] }], {
        material,
      }).text,
    );

  const across: [Vec3, Vec3] = [
    [-128, 0, 64],
    [128, 0, 64],
  ];

  it("passes an eye and stops a body", () => {
    const scene = glazed("GLASS/GLASSWINDOW002A");
    expect(isVisible(scene, ...across, MASK_SIGHT)).toBe(true);
    expect(isVisible(scene, ...across, MASK_SOLID)).toBe(false);
    expect(isVisible(scene, ...across, MASK_PLAYER)).toBe(false);
  });

  it("stops both when the same partition is brick", () => {
    const scene = glazed("BRICK/BRICKWALL014A");
    expect(isVisible(scene, ...across, MASK_SIGHT)).toBe(false);
    expect(isVisible(scene, ...across, MASK_SOLID)).toBe(false);
  });
});

/**
 * #74, and the same defect #48 and #60 named from three other angles.
 *
 * Found building `hmcp_backyard`: one `write_vmf_fitting` call put a counter against a wall,
 * 24 units deep -- `COUNTER.depth` from the toolkit's own measured table -- running from
 * `y 40` to `y 200` in a room whose far wall is at 224. Nothing else changed, and
 * `read_vmf_rooms` went from 3 rooms and 2 doorways to one room and none, with every merge
 * reporting `bar: 16`.
 *
 * The 26 × 24 pocket left at the counter's end peaks at one cell of clearance. It merges as a
 * not-a-constriction, which is right. What was wrong is what happened next: the merged region
 * kept the POCKET's peak rather than the room's, so for the rest of that pass the bar for
 * every boundary in the map was 16 -- and a doorway measuring 64 or 80 "narrows nothing"
 * against 16. Nine merges, one room.
 *
 * `building.md` blamed furniture depth on this evidence and was wrong; 24 is under both
 * numbers it gave. The variable was never depth.
 */
describe("a pocket must not set the merge bar for the whole map (#74)", () => {
  const BACKYARD = join(FIXTURES, "hmcp_backyard.vmf");

  /** The fixture with its wall-to-wall counter replaced by one that leaves an end pocket. */
  const withPocket = (): string => {
    const cut = deleteSolids(readFileSync(BACKYARD, "utf8"), {
      within: { mins: [418, -2, -2], maxs: [450, 226, 60] },
    }).text;
    return insertSolids(
      cut,
      [
        { shape: "box", mins: [426, 40, 0], maxs: [446, 200, 6] },
        { shape: "box", mins: [422, 40, 6], maxs: [446, 200, 52] },
        { shape: "box", mins: [420, 40, 52], maxs: [446, 200, 56] },
      ],
      { material: "WOOD/WOODWALL009A" },
    ).text;
  };

  const rooms = (source: string): ReturnType<typeof findRooms> =>
    findRooms(voxelise(buildScene("m.vmf", source), [[112, 112, 16]], { step: 16 }));

  it("keeps every room and every doorway when a counter leaves a pocket", () => {
    const r = rooms(withPocket());
    expect(r.rooms).toHaveLength(3);
    expect(r.portals).toHaveLength(2);
  });

  it("still merges the pocket itself, which is what the rule is for", () => {
    // The pocket is not a room. It should be absorbed -- and say so -- without taking the
    // map's doorways with it.
    const r = rooms(withPocket());
    expect(r.merges.some((m) => m.reason === "not-a-constriction")).toBe(true);
  });

  it("agrees with the same counter run wall to wall", () => {
    const shipped = rooms(readFileSync(BACKYARD, "utf8"));
    expect(shipped.rooms).toHaveLength(3);
    expect(shipped.portals).toHaveLength(2);
  });
});

/**
 * #81. Found building `hmcp_tenement`, the first map here with a staircase.
 *
 * `STEP_CELLS = 1` let a walk climb **one cell**, and its comment said that was Source's
 * 18 — which is true at `step: 16` and at no other value. The allowance scaled with the
 * segmentation parameter, so a stair of 10 rise on 16 run was walked at 16 and fragmented
 * into three unreachable slivers at 8, while at 32 a 30-unit ledge nobody can climb would
 * have read as walkable.
 *
 * `step` is documented as a resolution knob. It was also, silently, the body's step height.
 */
describe("a walk climbs Source's step, not one cell (#81)", () => {
  const TENEMENT = join(FIXTURES, "hmcp_tenement.vmf");

  /** The tallest z extent of any REACHED region: how far one walk climbs. */
  const tallestWalk = (step: number): number => {
    const scene = buildScene(TENEMENT, readFileSync(TENEMENT, "utf8"));
    const r = findRooms(voxelise(scene, [[320, 88, 16]], { step }));
    return Math.max(...r.rooms.map((room) => room.maxs[2] - room.mins[2]));
  };

  it("walks the same staircase at every cell size fine enough to resolve it", () => {
    // The stair rises 160 over 16 treads. A walk that climbs it spans far more than the
    // 16-24 units a single-storey region does.
    for (const step of [16, 8]) {
      expect(tallestWalk(step), `step ${step}`).toBeGreaterThan(48);
    }
  });

  it("does not let a walk climb what a player cannot", () => {
    // A 30-unit rise is past Source's 18: no cell size may make it walkable, and a coarse
    // grid must not buy the allowance back by having big cells.
    const scene = buildScene(
      PROBE,
      insertSolids(probe(), [{ shape: "box", mins: [0, -256, 0], maxs: [256, 256, 30] }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    // At step 16 the allowance is one cell, 16 units, and the ledge is 30: unreachable. A
    // sabotage that widens the allowance -- which is exactly what the constant did -- makes
    // it reachable and turns this red. At step 32 it could not: one cell is already 32.
    const r = findRooms(voxelise(scene, [[-128, 0, 16]], { step: 16 }));
    const onTheLedge = [...r.rooms, ...r.unreachable].filter((x) => x.mins[2] > 24);
    expect(onTheLedge.length, "the ledge has to be a region for this to say anything").toBeGreaterThan(0);
    expect(onTheLedge.every((x) => r.unreachable.includes(x))).toBe(true);
  });
});

/**
 * #82 and #84, which are one defect: `remap` applied to ids that had already been remapped.
 *
 * `regionOf` is renumbered in place to a dense 0..n-1 so the ids mean something to a reader.
 * Two places downstream then looked those dense ids up in `remap` again -- a table keyed by
 * the *raw* ids -- and fell back to the raw value on a miss. A double remap either misses
 * (right by accident) or hits a different region's entry (wrong, and indistinguishable).
 *
 * On one storey every id happened to line up and six rounds never saw it. On `hmcp_tenement`
 * it produced portals joining rooms 150 units apart in z, and a reachability walk that
 * returned the same answer whatever seed it was given.
 *
 * Same shape as round 1's finding about `into` carrying an internal number that looks exactly
 * like a room id -- the fix for which is three lines further down this same file.
 */
describe("region ids survive being reported (#82, #84)", () => {
  const TENEMENT = join(FIXTURES, "hmcp_tenement.vmf");

  const rooms = (path: string, seeds: Vec3[], step = 16): ReturnType<typeof findRooms> =>
    findRooms(voxelise(buildScene(path, readFileSync(path, "utf8")), seeds, { step }));

  it("puts every portal inside both of the rooms it says it joins", () => {
    const r = rooms(TENEMENT, [[320, 88, 16]]);
    const byId = new Map([...r.rooms, ...r.unreachable].map((x) => [x.id, x]));
    expect(r.portals.length).toBeGreaterThan(0);
    for (const p of r.portals) {
      for (const id of p.between) {
        const room = byId.get(id);
        expect(room, `portal ${p.between} names room ${id}, which is not reported`).toBeDefined();
        for (const axis of [0, 1, 2] as const) {
          // One cell of slack: the col sits on the boundary between the two, and a room's
          // bounds are cell centres.
          expect(p.at[axis]!, `portal ${p.between} at axis ${axis}`).toBeGreaterThanOrEqual(
            room!.mins[axis]! - 16,
          );
          expect(p.at[axis]!, `portal ${p.between} at axis ${axis}`).toBeLessThanOrEqual(
            room!.maxs[axis]! + 16,
          );
        }
      }
    }
  });

  it("answers a different question when given a different seed", () => {
    // Two standable places with no walk between them: the probe's floor, and a platform 64
    // tall in one corner -- past Source's 18 by a long way, so nobody climbs it.
    const split = insertSolids(
      probe(),
      [{ shape: "box", mins: [64, 64, 0], maxs: [256, 256, 64] }],
      { material: "DEV/DEV_MEASUREGENERIC01" },
    ).text;
    const path = join(FIXTURES, "hmcp_probe.vmf");
    const scene = buildScene(path, split);

    const fromFloor = findRooms(voxelise(scene, [[-128, -128, 16]], { step: 16 }));
    const fromLedge = findRooms(voxelise(scene, [[160, 160, 80]], { step: 16 }));

    const reachable = (r: ReturnType<typeof findRooms>): number[] =>
      r.rooms.map((x) => Math.round(x.mins[2])).sort((a, b) => a - b);

    // Standing on the floor, the ledge is not a room. Standing on the ledge, the floor is not.
    expect(reachable(fromFloor)).not.toEqual(reachable(fromLedge));

    // The invariant the seed lookup exists to hold, and the one a double remap breaks: the
    // region you are standing in is reachable. Asserted rather than inferred from the pair
    // above, because two answers can differ and both still be about the wrong region.
    const holds = (r: ReturnType<typeof findRooms>, at: Vec3): boolean =>
      r.rooms.some(
        (room) =>
          at[0] >= room.mins[0] - 16 &&
          at[0] <= room.maxs[0] + 16 &&
          at[1] >= room.mins[1] - 16 &&
          at[1] <= room.maxs[1] + 16 &&
          at[2] >= room.mins[2] - 16 &&
          at[2] <= room.maxs[2] + 48,
      );
    expect(holds(fromFloor, [-128, -128, 16]), "the floor you seeded from").toBe(true);
    expect(holds(fromLedge, [160, 160, 80]), "the ledge you seeded from").toBe(true);
  });
});
