import { describe, expect, it } from "vitest";
import {
  applyDirection,
  applyPoint,
  compose,
  determinant,
  IDENTITY,
  mirror,
  planarityError,
  rotation,
  scaling,
  snapPoint,
  translation,
} from "../src/vmf/transform.js";
import { hullFromPlanes, planeFromPoints } from "../src/vmf/solid.js";
import type { Vec3 } from "../src/vmf/solid.js";

const ORIGIN: Vec3 = [0, 0, 0];

/** The eight corners of an axis-aligned box, which is what a transform has to survive. */
const box = (mn: Vec3, mx: Vec3): Vec3[] => {
  const out: Vec3[] = [];
  for (const x of [mn[0], mx[0]])
    for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) out.push([x, y, z]);
  return out;
};

describe("matrices", () => {
  it("leaves a point alone under the identity", () => {
    expect(applyPoint(IDENTITY, [3, -7, 11])).toEqual([3, -7, 11]);
  });

  it("composes right to left: the second argument applies first", () => {
    const m = compose(rotation([0, 0, 1], 90, ORIGIN), translation([10, 0, 0]));
    // Translate to (10,0,0), then a quarter turn about z takes +x to +y.
    const p = applyPoint(m, ORIGIN);
    expect(p[0]).toBeCloseTo(0);
    expect(p[1]).toBeCloseTo(10);
  });

  it("moves a position but not a direction", () => {
    // Texture axes are directions. If a move shifted them, the texture would slide across
    // the face -- Hammer calls that texture lock being off, and it is not the default.
    const m = translation([128, -64, 32]);
    expect(applyPoint(m, ORIGIN)).toEqual([128, -64, 32]);
    expect(applyDirection(m, [1, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe("rotation", () => {
  it("is exact at a quarter turn", () => {
    // Math.cos(PI/2) is 6.1e-17, and a brush turned four times would drift off its own
    // corners. Multiples of 90 come from a table instead.
    const p = applyPoint(rotation([0, 0, 1], 90, ORIGIN), [64, 0, 0]);
    expect(p).toEqual([0, 64, 0]);
  });

  it("returns a box to itself after four quarter turns", () => {
    const m = rotation([0, 0, 1], 90, ORIGIN);
    let p: Vec3 = [17, -43, 8];
    for (let i = 0; i < 4; i++) p = applyPoint(m, p);
    expect(p).toEqual([17, -43, 8]);
  });

  it("turns about the pivot it was given, not the origin", () => {
    const p = applyPoint(rotation([0, 0, 1], 180, [64, 0, 0]), [0, 0, 0]);
    expect(p[0]).toBeCloseTo(128);
    expect(p[1]).toBeCloseTo(0);
  });

  it("preserves volume: its determinant is one", () => {
    for (const deg of [30, 45, 90, 137]) {
      expect(determinant(rotation([1, 2, 3], deg, ORIGIN))).toBeCloseTo(1);
    }
  });

  it("refuses an axis with no direction rather than producing NaN", () => {
    expect(() => rotation([0, 0, 0], 45, ORIGIN)).toThrow(/no direction/);
  });
});

describe("scaling and mirroring", () => {
  it("scales volume by the product of its factors", () => {
    expect(determinant(scaling([2, 3, 4], ORIGIN))).toBeCloseTo(24);
  });

  it("refuses a factor of zero, which would flatten the brush", () => {
    expect(() => scaling([1, 0, 1], ORIGIN)).toThrow(/collapses/);
  });

  it("flips handedness, which is why winding has to be re-derived", () => {
    expect(determinant(mirror("x", ORIGIN))).toBeCloseTo(-1);
  });

  it("mirrors across the plane through its pivot", () => {
    expect(applyPoint(mirror("x", [64, 0, 0]), [0, 5, 5])).toEqual([128, 5, 5]);
  });
});

describe("planarity", () => {
  /**
   * The property the whole file rests on, and the one the plan for it got backwards: an
   * affine map sends planes to planes. Snapping is what breaks that, not what fixes it.
   */
  it("keeps every face exactly flat under an awkward rotation", () => {
    const corners = box([0, 0, 0], [64, 128, 32]);
    const m = rotation([1, 1, 1], 37, [12, 5, 9]);
    const moved = corners.map((c) => applyPoint(m, c));

    // The four corners that share x = 0 stay coplanar, whatever the rotation did to them.
    const face = corners
      .map((c, i) => [c, moved[i]!] as const)
      .filter(([c]) => c[0] === 0)
      .map(([, t]) => t);
    expect(face).toHaveLength(4);
    const plane = planeFromPoints(face[0]!, face[1]!, face[2]!)!;
    expect(planarityError(face, plane.normal, plane.dist)).toBeLessThan(1e-9);
  });

  it("measures what a snap costs, instead of hiding it", () => {
    const corners = box([0, 0, 0], [64, 128, 32]);
    const m = rotation([1, 1, 1], 37, [12, 5, 9]);
    const face = corners
      .filter((c) => c[0] === 0)
      .map((c) => snapPoint(applyPoint(m, c), 1));
    const plane = planeFromPoints(face[0]!, face[1]!, face[2]!)!;
    // Snapping each corner independently moves it off the plane its neighbours are on.
    // The number is small, and it is not zero -- which is the whole point of measuring it.
    expect(planarityError(face, plane.normal, plane.dist)).toBeGreaterThan(0);
  });

  it("snaps to the grid it was given, and to nothing when told zero", () => {
    expect(snapPoint([17.4, -3.2, 0.6], 16)).toEqual([16, 0, 0]);
    expect(snapPoint([17.4, -3.2, 0.6], 0)).toEqual([17.4, -3.2, 0.6]);
  });

  it("does not produce a negative zero", () => {
    // "-0" prints as 0 and compares equal under ==, but not under Object.is, and it has
    // already cost this repository a test once.
    const [x] = snapPoint([-0.2, 0, 0], 16);
    expect(Object.is(x, -0)).toBe(false);
  });
});

describe("a transformed brush is still a brush", () => {
  /**
   * The round trip that matters: turn a box by an angle that lands on no grid, rebuild the
   * planes from the moved corners, and hand them to the reader that goes the other way.
   * It must recover eight corners and the original volume.
   */
  it("survives planes -> hull -> volume after a 45 degree turn", () => {
    const mn: Vec3 = [0, 0, 0];
    const mx: Vec3 = [64, 64, 32];
    const m = rotation([0, 0, 1], 45, [32, 32, 16]);
    const moved = box(mn, mx).map((c) => applyPoint(m, c));

    const centre: Vec3 = [
      moved.reduce((s, v) => s + v[0], 0) / 8,
      moved.reduce((s, v) => s + v[1], 0) / 8,
      moved.reduce((s, v) => s + v[2], 0) / 8,
    ];
    // The six face normals of the original box, turned the same way.
    const axes: Vec3[] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    const normals: Vec3[] = axes.map((n) => applyDirection(m, n));
    const planes = normals.map((n) => {
      const far = Math.max(
        ...moved.map((v) => n[0] * v[0] + n[1] * v[1] + n[2] * v[2]),
      );
      return { normal: n, dist: far };
    });

    const hull = hullFromPlanes(planes);
    expect(hull).toHaveLength(8);
    for (const v of hull) {
      expect(Math.hypot(v[0] - centre[0], v[1] - centre[1], v[2] - centre[2])).toBeCloseTo(
        Math.hypot(32, 32, 16),
      );
    }
  });
});
