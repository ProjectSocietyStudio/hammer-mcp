/**
 * Affine transforms for brush geometry: move, turn, scale, mirror.
 *
 * The only rotation in this codebase before now was `rotateZ` in `./build.ts`, which turns
 * a box's four ground-plan corners once and reuses them at both heights, **rounding each
 * to whole units**. Its comment explains why: rotating all eight corners independently and
 * rounding them leaves the vertical faces no longer planar, and vbsp rejects a brush whose
 * face is not flat. That is a real trap and it shaped the plan for this file, which said to
 * "re-snap to the grid to defuse it".
 *
 * Writing it showed the plan had it backwards. **An affine map sends planes to planes
 * exactly** -- rotate a face and it is still a face, to within the last bit of a double.
 * Snapping is not the cure for non-planarity, it is the cause of it: it moves each vertex
 * independently, off the plane its neighbours are still on. `rotateZ` gets away with it
 * only because it snaps a 2D outline and extrudes, so its vertical faces are planar by
 * construction rather than by luck.
 *
 * So grid snapping here is **optional and verified**, never automatic. Without it the
 * result is exactly planar and off-grid, which is what Hammer itself does when you rotate
 * a brush by 30 degrees. With it, `planarityError` measures what the snap cost and the
 * caller refuses the write when it exceeds what vbsp tolerates. Refusing to write an
 * off-grid brush would be a worse lie than writing one: mappers rotate things.
 *
 * Quarter turns are exact. `Math.cos(Math.PI / 2)` is 6.1e-17 rather than zero, and a
 * brush turned four times by 90 degrees would drift off its own corners; multiples of 90
 * are answered from a table instead.
 */
import type { Vec3 } from "./solid.js";

/**
 * A 3x4 affine matrix, row-major: three rows of (x, y, z, translation).
 *
 * Three rows rather than four because the fourth is always (0, 0, 0, 1) for the transforms
 * a mapper applies -- there is no perspective in a brush.
 */
export type Mat34 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export const IDENTITY: Mat34 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** `a` applied after `b`, so `compose(rot, trans)` translates first and then turns. */
export function compose(a: Mat34, b: Mat34): Mat34 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 4]! * b[c]! + a[r * 4 + 1]! * b[4 + c]! + a[r * 4 + 2]! * b[8 + c]!);
    }
    out.push(
      a[r * 4]! * b[3]! + a[r * 4 + 1]! * b[7]! + a[r * 4 + 2]! * b[11]! + a[r * 4 + 3]!,
    );
  }
  return out as unknown as Mat34;
}

/** Transforms a position: the translation column applies. */
export function applyPoint(m: Mat34, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!,
    m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!,
    m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!,
  ];
}

/**
 * Transforms a direction: the translation column does not apply.
 *
 * Texture axes are directions, not positions. Moving a brush must not move its texture
 * axes, or the texture slides across the face -- which is what Hammer's "texture lock"
 * being off looks like.
 */
export function applyDirection(m: Mat34, d: Vec3): Vec3 {
  return [
    m[0]! * d[0] + m[1]! * d[1] + m[2]! * d[2],
    m[4]! * d[0] + m[5]! * d[1] + m[6]! * d[2],
    m[8]! * d[0] + m[9]! * d[1] + m[10]! * d[2],
  ];
}

/** Signed volume scale factor. Negative means the transform flips handedness. */
export function determinant(m: Mat34): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[1]! * (m[4]! * m[10]! - m[6]! * m[8]!) +
    m[2]! * (m[4]! * m[9]! - m[5]! * m[8]!)
  );
}

export function translation(delta: Vec3): Mat34 {
  return [1, 0, 0, delta[0], 0, 1, 0, delta[1], 0, 0, 1, delta[2]];
}

/** Exact at quarter turns, where the library functions are not. */
function cosDeg(deg: number): number {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0) return 1;
  if (q === 90 || q === 270) return 0;
  if (q === 180) return -1;
  return Math.cos((deg * Math.PI) / 180);
}

function sinDeg(deg: number): number {
  const q = ((deg % 360) + 360) % 360;
  if (q === 0 || q === 180) return 0;
  if (q === 90) return 1;
  if (q === 270) return -1;
  return Math.sin((deg * Math.PI) / 180);
}

function aroundPivot(linear: Mat34, pivot: Vec3): Mat34 {
  return compose(compose(translation(pivot), linear), translation([-pivot[0], -pivot[1], -pivot[2]]));
}

/**
 * Rotation of `degrees` about `axis` through `pivot`, by Rodrigues' formula.
 *
 * `axis` need not be a unit vector; a zero-length one is refused rather than producing a
 * matrix of NaN that would only be noticed as a brush of NaN.
 */
export function rotation(axis: Vec3, degrees: number, pivot: Vec3): Mat34 {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len === 0) throw new Error("rotation axis has no direction");
  const [x, y, z] = [axis[0] / len, axis[1] / len, axis[2] / len];
  const c = cosDeg(degrees);
  const s = sinDeg(degrees);
  const t = 1 - c;
  const linear: Mat34 = [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
  ];
  return aroundPivot(linear, pivot);
}

/** Scale about `pivot`, per axis. A zero factor is refused: it flattens the brush. */
export function scaling(factor: Vec3, pivot: Vec3): Mat34 {
  if (factor[0] === 0 || factor[1] === 0 || factor[2] === 0) {
    throw new Error("a scale factor of zero collapses the brush to a plane");
  }
  return aroundPivot([factor[0], 0, 0, 0, 0, factor[1], 0, 0, 0, 0, factor[2], 0], pivot);
}

/**
 * Mirror across the plane through `pivot` perpendicular to `axis`.
 *
 * This flips handedness -- `determinant` comes out negative -- so every face's loop winds
 * the other way afterwards. Callers must re-derive winding from the centroid rather than
 * carrying the old order over, which is what `buildSolidText` already does for new shapes.
 */
export function mirror(axis: "x" | "y" | "z", pivot: Vec3): Mat34 {
  const f: Vec3 = [axis === "x" ? -1 : 1, axis === "y" ? -1 : 1, axis === "z" ? -1 : 1];
  return aroundPivot([f[0], 0, 0, 0, 0, f[1], 0, 0, 0, 0, f[2], 0], pivot);
}

/** Nearest multiple of `grid` on every axis. `grid <= 0` leaves the point alone. */
export function snapPoint(p: Vec3, grid: number): Vec3 {
  if (grid <= 0) return p;
  // `+ 0` collapses the negative zero Math.round produces for small negatives: it prints
  // as "0" and compares equal under ==, but not under Object.is, which has cost a test.
  return [
    Math.round(p[0] / grid) * grid + 0,
    Math.round(p[1] / grid) * grid + 0,
    Math.round(p[2] / grid) * grid + 0,
  ];
}

/**
 * How far the furthest vertex sits off the plane its face claims, in Hammer units.
 *
 * The measurement that decides whether a snapped transform may be written. Zero for any
 * unsnapped affine transform of a valid brush, because an affine map preserves planes.
 */
export function planarityError(
  vertices: readonly Vec3[],
  normal: Vec3,
  dist: number,
): number {
  let worst = 0;
  for (const v of vertices) {
    const d = Math.abs(normal[0] * v[0] + normal[1] * v[1] + normal[2] * v[2] - dist);
    if (d > worst) worst = d;
  }
  return worst;
}
