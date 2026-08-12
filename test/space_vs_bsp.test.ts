/**
 * The cross-check that makes the VMF engine believable.
 *
 * `src/space/trace.ts` traces a map that has never been compiled. `src/bsp/trace.ts`
 * traces one that has, using the engine's own recursion over vbsp's own tree. They share no
 * code, no file format and no author's afternoon: one intersects half-spaces read out of
 * text, the other descends a binary tree read out of three lumps. If both are wrong they
 * have to be wrong in the same way about the same 5 000 rays, which is not a thing that
 * happens by accident.
 *
 * `hmcp_probe.bsp` is committed, so this runs on a bare machine with no toolchain. That was
 * worth checking before the plan relied on it: an oracle that only runs where wine is
 * installed is an oracle that runs nowhere in CI.
 *
 * ## What is deliberately excluded, and why saying so matters
 *
 * The two disagree in three places that are not faults, and each is neutralised by
 * construction rather than absorbed into a wide tolerance -- a tolerance loose enough to
 * cover them would be loose enough to cover a real sign error too.
 *
 * **Outside the map is solid to vbsp and empty to us.** The compiler fills the void beyond
 * the sealed hull with solid leaves; a `.vmf` simply has no brush there. So every ray starts
 * inside the room, where both engines agree about what exists.
 *
 * **Brush entities are not in the world tree.** vbsp gives each `func_*` its own model, and
 * `readTree` only reads model 0. The scene here is therefore restricted to `world` and
 * `func_detail`, which is exactly what vbsp merges into that model.
 *
 * **Displacements are not their flat quad.** Both sides drop them; the probe has none.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTree, traceRay as bspTrace } from "../src/bsp/trace.js";
import { buildScene } from "../src/space/scene.js";
import { traceRay as vmfTrace } from "../src/space/trace.js";
import { FIXTURES } from "./support/env.js";

const PROBE_VMF = join(FIXTURES, "hmcp_probe.vmf");
const PROBE_BSP = join(FIXTURES, "hmcp_probe.bsp");

/** vbsp merges these into model 0, which is the only model `readTree` reads. */
const WORLD_OWNERS = ["world", "func_detail"];

/** The probe's sealed interior, from `gen_probe.py`: x,y in [-256, 256] and z in [0, 256]. */
const INTERIOR = { lo: [-250, -250, 6] as Pt, hi: [250, 250, 250] as Pt };

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A mutable triple, because the two engines disagree about the type and not the maths.
 *
 * `src/vmf/solid.ts` calls a point `readonly [number, number, number]`; `src/entity/model.ts`,
 * which the BSP side takes, calls it mutable. A tuple written here satisfies both, so the
 * test does not have to convert points on the way into one of the two engines -- which is
 * the sort of adapter that eventually converts something else as well.
 */
type Pt = [number, number, number];

const length = (a: Pt, b: Pt): number =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);

describe("the VMF engine against the BSP engine", () => {
  const tree = readTree(PROBE_BSP);
  const scene = buildScene(PROBE_VMF, readFileSync(PROBE_VMF, "utf8"), { owners: WORLD_OWNERS });

  it("agrees on where 5000 rays first meet solid", () => {
    const rng = lcg(12082026);
    let compared = 0;
    let hits = 0;
    let worstUnits = 0;
    let disagreements = 0;
    let firstDisagreement = "";

    for (let i = 0; i < 5000; i++) {
      // Start inside the sealed room, where both engines describe the same world.
      const start: Pt = [
        INTERIOR.lo[0] + rng() * (INTERIOR.hi[0] - INTERIOR.lo[0]),
        INTERIOR.lo[1] + rng() * (INTERIOR.hi[1] - INTERIOR.lo[1]),
        INTERIOR.lo[2] + rng() * (INTERIOR.hi[2] - INTERIOR.lo[2]),
      ];
      // End anywhere in a box larger than the map, so most rays cross a wall and the
      // measurement is about where the wall is rather than about empty space.
      const end: Pt = [rng() * 1200 - 600, rng() * 1200 - 600, rng() * 1200 - 600];

      const a = vmfTrace(scene, start, end);
      const b = bspTrace(tree, start, end);

      // A start inside the room is never inside solid for either engine; if one of them
      // thinks so, that is the finding, not something to skip past.
      expect(a.startSolid, `VMF: start inside solid at ${start}`).toBe(false);
      expect(b.startSolid, `BSP: start inside solid at ${start}`).toBe(false);

      compared += 1;
      if (a.hit) hits += 1;

      if (a.hit !== b.hit) {
        disagreements += 1;
        if (!firstDisagreement) {
          firstDisagreement = `hit ${a.hit} vs ${b.hit} for ${start} -> ${end}`;
        }
        continue;
      }
      if (!a.hit) continue;

      // Compared in units rather than in fractions: a fraction of a 1200-unit ray and a
      // fraction of a 20-unit one are not the same claim, and the number that matters is
      // how far apart the two engines put the wall.
      const units = Math.abs(a.fraction - b.fraction) * length(start, end);
      if (units > worstUnits) worstUnits = units;
      if (units > 0.5 && !firstDisagreement) {
        firstDisagreement = `${units.toFixed(3)} units apart for ${start} -> ${end}`;
      }
    }

    expect(firstDisagreement, "first disagreement").toBe("");
    expect(disagreements).toBe(0);
    expect(worstUnits).toBeLessThan(0.5);

    // The negative sisters. Both would pass if the engines agreed by doing nothing: one
    // that hit everything, or one that hit nothing, would be perfectly consistent with a
    // twin that did the same.
    expect(compared).toBe(5000);
    expect(hits, "rays that met a wall").toBeGreaterThan(3000);
    expect(hits, "rays that met nothing").toBeLessThan(5000);
  });

  it("puts the six surfaces of the room at the same place to the thousandth of a unit", () => {
    // The axis rays, named. The bulk test above can only say the two agree; this says what
    // they agree *on*, so a reader can check it against `gen_probe.py` by eye.
    const centre: Pt = [0, 0, 128];
    const targets: Array<[string, Pt, number]> = [
      ["+x wall", [1000, 0, 128], 256],
      ["-x wall", [-1000, 0, 128], 256],
      ["+y wall", [0, 1000, 128], 256],
      ["-y wall", [0, -1000, 128], 256],
      ["ceiling", [0, 0, 1000], 128],
      ["floor", [0, 0, -1000], 128],
    ];
    for (const [name, end, expected] of targets) {
      const a = vmfTrace(scene, centre, end);
      const b = bspTrace(tree, centre, end);
      const distA = a.fraction * length(centre, end);
      const distB = b.fraction * length(centre, end);
      expect(a.hit, name).toBe(true);
      expect(distA, `${name}: VMF`).toBeCloseTo(expected, 1);
      expect(distB, `${name}: BSP`).toBeCloseTo(expected, 1);
      expect(Math.abs(distA - distB), `${name}: the two engines`).toBeLessThan(0.001);
    }
  });

  it("agrees about a ray that meets nothing", () => {
    const a = vmfTrace(scene, [-200, 0, 128], [200, 0, 128]);
    const b = bspTrace(tree, [-200, 0, 128], [200, 0, 128]);
    expect(a.hit).toBe(false);
    expect(b.hit).toBe(false);
  });
});
