/**
 * Tracing rays and swept boxes against a `.vmf` scene.
 *
 * The per-brush test is Quake's `CM_ClipBoxToBrush`, unchanged in Source and unchanged
 * here: walk the brush's planes keeping the last fraction at which the segment *entered* a
 * half-space and the first at which it *left* one. If it entered after it left, the segment
 * misses the brush. It is four lines of arithmetic and it is exact for any convex polytope,
 * which is what a brush is.
 *
 * ## Sweeping a box costs one term
 *
 * A brush is `dot(n, x) <= d` for every plane. A box of half-extents `h` centred on `x`
 * touches that half-space as soon as its most advanced corner does, and that corner is
 * `dot(|n|, h)` further along the normal. So sweeping the box is tracing its **centre**
 * against the same brush with every plane pushed out by `dot(|n|, h)`. That is exact for an
 * axis-aligned box -- it is the Minkowski sum, written as a plane offset -- and it means the
 * swept case is the ray case with one extra term rather than a second implementation. Two
 * implementations is how the ray version gets fixed and the box version does not.
 *
 * This matters more than it sounds. "Is this corridor wide enough" is not a question about
 * a line; it is a question about a 32x32x72 player. Answering it with a ray reports a
 * doorway as passable when the frame is 24 units apart, and the measurement reads perfectly
 * reasonable.
 */
import { ON_EPSILON } from "../vmf/solid.js";
import type { Plane, Vec3 } from "../vmf/solid.js";
import { boxHit, slabHit } from "./bvh.js";
import { MASK_SOLID } from "./scene.js";
import type { Scene, SceneBrush } from "./scene.js";

/**
 * The nudge Quake applies when splitting on a plane, and Source kept.
 *
 * It backs the reported contact off the surface by a thirty-second of a unit so a point
 * left at the impact is outside the brush rather than exactly on it. `../bsp/trace.ts` uses
 * the same value, which is why the two agree far closer than the cross-check demands.
 */
export const DIST_EPSILON = 0.03125;

export interface SpaceTrace {
  /** How far along the segment the first contact happened; 1 when nothing was hit. */
  fraction: number;
  hit: boolean;
  /** Contact point, or the segment end when nothing was hit. */
  point: Vec3;
  /** Outward normal of the surface met, or null when nothing was hit. */
  normal: Vec3 | null;
  brushId: number | null;
  sideId: number | null;
  material: string | null;
  /** The segment began inside a brush, which makes `fraction` meaningless. */
  startSolid: boolean;
  /** It began inside and never got out. */
  allSolid: boolean;
}

/**
 * How much work a trace did, for the one thing correctness tests cannot see.
 *
 * A broadphase that prunes nothing is indistinguishable from a good one by every result it
 * produces -- it just tests every brush and returns the same answer slowly. So the tree's
 * *purpose* needs its own assertion, and an assertion needs a number. This is that number.
 */
export interface TraceStats {
  /** Brushes actually clipped against. Without a tree this is the whole scene, every time. */
  brushTests: number;
  /** Nodes whose box the ray entered. */
  nodeVisits: number;
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

interface ClipState {
  fraction: number;
  plane: Plane | null;
  brush: SceneBrush | null;
  face: number;
  startSolid: boolean;
  allSolid: boolean;
}

/**
 * Clips one segment against one brush, updating `out` when it hits nearer than before.
 *
 * `half` is null for a ray. For a swept box it is the half-extents, and every plane is
 * offset by the box's support along its normal.
 */
function clipToBrush(
  brush: SceneBrush,
  p1: Vec3,
  p2: Vec3,
  half: Vec3 | null,
  out: ClipState,
): void {
  let enterFrac = -1;
  let leaveFrac = 1;
  let enterPlane: Plane | null = null;
  let enterFace = -1;
  let startOut = false;
  let getOut = false;

  for (let i = 0; i < brush.planes.length; i++) {
    const plane = brush.planes[i]!;
    const n = plane.normal;
    const offset = half ? Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2] : 0;
    const dist = plane.dist + offset;

    const d1 = n[0] * p1[0] + n[1] * p1[1] + n[2] * p1[2] - dist;
    const d2 = n[0] * p2[0] + n[1] * p2[1] + n[2] * p2[2] - dist;

    if (d2 > 0) getOut = true;
    if (d1 > 0) startOut = true;

    // Wholly outside this plane: it misses the brush, and no other plane can change that.
    if (d1 > 0 && d2 > 0) return;
    // Wholly inside this one: it constrains nothing.
    if (d1 <= 0 && d2 <= 0) continue;

    if (d1 > d2) {
      const f = (d1 - DIST_EPSILON) / (d1 - d2);
      if (f > enterFrac) {
        enterFrac = f;
        enterPlane = plane;
        enterFace = i;
      }
    } else {
      const f = (d1 + DIST_EPSILON) / (d1 - d2);
      if (f < leaveFrac) leaveFrac = f;
    }
  }

  if (!startOut) {
    // The segment began inside this brush. Reporting a fraction here would be a number for
    // a question that has no answer, so the caller is told instead -- and no brush is named
    // either: a point inside a wall is usually inside several brushes at once, and picking
    // one of them would be reporting the search order as if it were the map. `pointInSolid`
    // is the tool for "which brush am I in", and it answers deliberately.
    out.startSolid = true;
    if (!getOut) out.allSolid = true;
    out.fraction = 0;
    out.brush = null;
    out.plane = null;
    out.face = -1;
    return;
  }

  if (enterFrac >= leaveFrac || enterFrac <= -1) return;

  // A tie is not rare and not academic: two brushes meeting at a corner are hit at exactly
  // the same fraction by any box sweep that reaches the join, which on a map made of boxes
  // is most of them. Taking whichever was visited first makes the reported brush depend on
  // the traversal order, so the broadphase and brute force would name different walls while
  // agreeing on the distance -- a difference the cross-check cannot tell from a real fault.
  // The lowest id wins, which is a property of the map rather than of the search.
  const nearer = enterFrac < out.fraction;
  const tie = enterFrac === out.fraction && out.brush !== null && brush.id < out.brush.id;
  if (!nearer && !tie) return;

  out.fraction = enterFrac < 0 ? 0 : enterFrac;
  out.plane = enterPlane;
  out.brush = brush;
  out.face = enterFace;
}

/**
 * Turns the clip state into the reported result.
 *
 * One function rather than one per entry point: the broadphase and the brute-force version
 * exist precisely so their results can be compared, and two copies of this would let them
 * differ in the reporting rather than in the tracing -- which is the one difference the
 * cross-check could not tell apart from a real bug.
 */
function finish(out: ClipState, start: Vec3, end: Vec3): SpaceTrace {
  const face = out.brush && out.face >= 0 ? out.brush.faces[out.face] : undefined;
  return {
    fraction: out.fraction,
    hit: out.fraction < 1 || out.startSolid,
    point: lerp(start, end, out.fraction),
    normal: out.plane ? out.plane.normal : null,
    brushId: out.brush ? out.brush.id : null,
    sideId: face?.sideId ?? null,
    material: face?.material ?? null,
    startSolid: out.startSolid,
    allSolid: out.allSolid,
  };
}

/**
 * Traces a segment, or a swept axis-aligned box, through the scene.
 *
 * `mask` selects what counts as an obstacle: `MASK_SIGHT` sees through clip brushes,
 * `MASK_PLAYER` does not. Passing the wrong one is the difference between "can they see the
 * door" and "can they reach it", and both questions come up in the same conversation.
 */
export function traceRay(
  scene: Scene,
  start: Vec3,
  end: Vec3,
  mask = MASK_SOLID,
  half: Vec3 | null = null,
  stats?: TraceStats,
): SpaceTrace {
  const out: ClipState = {
    fraction: 1,
    plane: null,
    brush: null,
    face: -1,
    startSolid: false,
    allSolid: false,
  };

  const dir: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const invDir: Vec3 = [1 / dir[0], 1 / dir[1], 1 / dir[2]];
  // A box sweep meets a node's box whenever the ray meets it inflated by the half-extents;
  // testing the ray alone would let the broadphase reject a brush the box really touches.
  const expand = half ? Math.max(half[0], half[1], half[2]) : 0;

  const { bvh } = scene;
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!slabHit(bvh, node, start, invDir, out.fraction, expand)) continue;
    if (stats) stats.nodeVisits += 1;
    const right = bvh.right[node]!;
    if (right < 0) {
      const from = bvh.start[node]!;
      const to = from + bvh.count[node]!;
      for (let i = from; i < to; i++) {
        const brush = scene.brushes[bvh.order[i]!]!;
        if ((brush.mask & mask) === 0) continue;
        if (stats) stats.brushTests += 1;
        clipToBrush(brush, start, end, half, out);
        if (out.startSolid) break;
      }
    } else {
      stack.push(node + 1, right);
    }
    // Nothing further can be learned: the segment starts inside solid, so every remaining
    // brush would only compete to be named in a result that is already meaningless.
    if (out.startSolid) break;
  }

  return finish(out, start, end);
}

/** The same trace with the standing player hull, which is what "can someone walk here" means. */
export function traceHull(
  scene: Scene,
  start: Vec3,
  end: Vec3,
  half: Vec3,
  mask = MASK_SOLID,
): SpaceTrace {
  return traceRay(scene, start, end, mask, half);
}

/** True when nothing in `mask` stands between the two points. */
export function isVisible(scene: Scene, a: Vec3, b: Vec3, mask = MASK_SOLID): boolean {
  const t = traceRay(scene, a, b, mask);
  return !t.hit;
}

/**
 * The brush a point is inside, or null.
 *
 * A point exactly on a face counts as inside. The alternative leaves the surface itself
 * classified as empty space, and a voxel flood started next to a wall then leaks through it
 * one cell at a time.
 */
export function pointInSolid(scene: Scene, p: Vec3, mask = MASK_SOLID): SceneBrush | null {
  const { bvh } = scene;
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!boxHit(bvh, node, p, p)) continue;
    const right = bvh.right[node]!;
    if (right < 0) {
      const from = bvh.start[node]!;
      const to = from + bvh.count[node]!;
      for (let i = from; i < to; i++) {
        const brush = scene.brushes[bvh.order[i]!]!;
        if ((brush.mask & mask) === 0) continue;
        let inside = true;
        for (const plane of brush.planes) {
          const d =
            plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
          if (d > ON_EPSILON) {
            inside = false;
            break;
          }
        }
        if (inside) return brush;
      }
    } else {
      stack.push(node + 1, right);
    }
  }
  return null;
}

/** True when a box centred at `p` overlaps anything in `mask`. */
export function boxInSolid(scene: Scene, p: Vec3, half: Vec3, mask = MASK_SOLID): SceneBrush | null {
  const mins: Vec3 = [p[0] - half[0], p[1] - half[1], p[2] - half[2]];
  const maxs: Vec3 = [p[0] + half[0], p[1] + half[1], p[2] + half[2]];
  const { bvh } = scene;
  const stack: number[] = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!boxHit(bvh, node, mins, maxs)) continue;
    const right = bvh.right[node]!;
    if (right < 0) {
      const from = bvh.start[node]!;
      const to = from + bvh.count[node]!;
      for (let i = from; i < to; i++) {
        const brush = scene.brushes[bvh.order[i]!]!;
        if ((brush.mask & mask) === 0) continue;
        let inside = true;
        for (const plane of brush.planes) {
          const n = plane.normal;
          const support = Math.abs(n[0]) * half[0] + Math.abs(n[1]) * half[1] + Math.abs(n[2]) * half[2];
          const d = n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - (plane.dist + support);
          if (d > ON_EPSILON) {
            inside = false;
            break;
          }
        }
        if (inside) return brush;
      }
    } else {
      stack.push(node + 1, right);
    }
  }
  return null;
}

export interface NearestSurface {
  distance: number;
  point: Vec3;
  brushId: number;
  sideId: number | null;
  material: string;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Closest point to `p` on the segment `[a, b]`. */
function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 <= 0) return a;
  let t = dot(sub(p, a), ab) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
}

/** Closest point to `p` on a planar convex polygon given as an ordered loop. */
function closestOnFace(p: Vec3, loop: readonly Vec3[], plane: Plane): Vec3 {
  const d = dot(plane.normal, p) - plane.dist;
  const projected: Vec3 = [
    p[0] - plane.normal[0] * d,
    p[1] - plane.normal[1] * d,
    p[2] - plane.normal[2] * d,
  ];

  // Inside the polygon when it stays on the inner side of every edge, tested with the
  // face's own normal so the winding decides the sense rather than an assumption.
  let inside = true;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    const edge = sub(b, a);
    const outward: Vec3 = [
      edge[1] * plane.normal[2] - edge[2] * plane.normal[1],
      edge[2] * plane.normal[0] - edge[0] * plane.normal[2],
      edge[0] * plane.normal[1] - edge[1] * plane.normal[0],
    ];
    if (dot(outward, sub(projected, a)) > ON_EPSILON) {
      inside = false;
      break;
    }
  }
  if (inside) return projected;

  let best: Vec3 = loop[0]!;
  let bestD = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const q = closestOnSegment(p, loop[i]!, loop[(i + 1) % loop.length]!);
    const dd = dot(sub(q, p), sub(q, p));
    if (dd < bestD) {
      bestD = dd;
      best = q;
    }
  }
  return best;
}

/**
 * The nearest point of any surface in `mask`, within `radius`.
 *
 * Exact rather than sampled: the closest point on a convex polytope's boundary is the
 * closest over its faces, and the closest on a planar convex face is either the foot of the
 * perpendicular or a point on an edge. Sampling would be simpler and would report a
 * clearance that changes when the sample step does.
 */
export function nearestSurface(
  scene: Scene,
  p: Vec3,
  radius: number,
  mask = MASK_SOLID,
): NearestSurface | null {
  let best: NearestSurface | null = null;
  let bestD = radius;

  const { bvh } = scene;
  const stack: number[] = [0];
  const mins: Vec3 = [p[0] - radius, p[1] - radius, p[2] - radius];
  const maxs: Vec3 = [p[0] + radius, p[1] + radius, p[2] + radius];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!boxHit(bvh, node, mins, maxs)) continue;
    const right = bvh.right[node]!;
    if (right >= 0) {
      stack.push(node + 1, right);
      continue;
    }
    const from = bvh.start[node]!;
    const to = from + bvh.count[node]!;
    for (let i = from; i < to; i++) {
      const brush = scene.brushes[bvh.order[i]!]!;
      if ((brush.mask & mask) === 0) continue;
      for (const face of brush.faces) {
        if (face.loop.length < 3) continue;
        const q = closestOnFace(p, face.loop, face.plane);
        const dd = Math.sqrt(dot(sub(q, p), sub(q, p)));
        if (dd < bestD) {
          bestD = dd;
          best = {
            distance: dd,
            point: q,
            brushId: brush.id,
            sideId: face.sideId,
            material: face.material,
          };
        }
      }
    }
  }

  return best;
}

/** Every brush in the scene, ignoring the tree. The broadphase's own oracle. */
export function traceRayBruteForce(
  scene: Scene,
  start: Vec3,
  end: Vec3,
  mask = MASK_SOLID,
  half: Vec3 | null = null,
): SpaceTrace {
  const out: ClipState = {
    fraction: 1,
    plane: null,
    brush: null,
    face: -1,
    startSolid: false,
    allSolid: false,
  };
  for (const brush of scene.brushes) {
    if ((brush.mask & mask) === 0) continue;
    clipToBrush(brush, start, end, half, out);
    if (out.startSolid) break;
  }
  return finish(out, start, end);
}
