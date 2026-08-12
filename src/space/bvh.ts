/**
 * A bounding volume hierarchy over a map's brushes.
 *
 * ## Why a tree and not a grid
 *
 * A uniform grid is the obvious broadphase and the wrong one here, because of what a Source
 * map actually contains: door frames eight units thick sit inside a skybox brush sixteen
 * thousand units across. A cell small enough to separate the frames makes the skybox occupy
 * millions of them; a cell large enough for the skybox puts a whole building in one cell and
 * prunes nothing. A BVH has no cell size to get wrong -- it adapts to whatever the map is.
 *
 * ## Binned SAH, and what that buys
 *
 * Splits are chosen by the surface area heuristic: the cost of a split is the chance a
 * random ray enters each child times how many brushes it would then have to test. Trying
 * every possible split is O(n^2); binning the centroids into sixteen buckets along the
 * longest axis and only considering the fifteen boundaries between them costs O(n) per node
 * and lands within a few percent of the exhaustive answer. This is the standard result and
 * not something measured here.
 *
 * The tree is built once per file and is pure derived data, so the caller may cache it by
 * path and mtime.
 *
 * ## The oracle
 *
 * A broadphase is an optimisation, which means it has exactly one correctness requirement:
 * it must not change any answer. So the tests trace the same rays through the tree and
 * through every brush in turn and demand results identical **to the bit** -- not to an
 * epsilon. An acceleration structure that is nearly right is a structure that drops a wall
 * every few thousand rays, and an epsilon would hide it.
 */
import type { Vec3 } from "../vmf/solid.js";

/** Boxes to a leaf. Deeper trees cost more traversal than the brush tests they save. */
const LEAF_SIZE = 4;
/** Buckets per split axis. Sixteen is the usual figure and the returns are flat past it. */
const BINS = 16;

export interface BvhInput {
  mins: Vec3;
  maxs: Vec3;
}

export interface Bvh {
  /** 6 floats per node: minX minY minZ maxX maxY maxZ. */
  bounds: Float64Array;
  /**
   * Index of the **right** child, or -1 in a leaf.
   *
   * The left child is always `node + 1`: nodes are emitted depth-first, parent before
   * children, so the left subtree starts immediately after its parent. The right one does
   * not -- it sits past the whole left subtree, at a distance nothing local knows. Storing
   * the left index instead and assuming `left + 1` for the right is a tree that silently
   * traverses the wrong half of itself; it costs no crash and roughly a third of the map.
   */
  right: Int32Array;
  /** Leaves only: where this node's slice of `order` starts, and how long it is. */
  start: Int32Array;
  count: Int32Array;
  /** Item indices, permuted so every leaf owns a contiguous run. */
  order: Int32Array;
  nodeCount: number;
}

interface Build {
  bounds: number[];
  right: number[];
  start: number[];
  count: number[];
}

export function buildBvh(items: readonly BvhInput[]): Bvh {
  const n = items.length;
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;

  const centroid = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      centroid[i * 3 + a] = (items[i]!.mins[a]! + items[i]!.maxs[a]!) * 0.5;
    }
  }

  const build: Build = { bounds: [], right: [], start: [], count: [] };

  const boundsOf = (from: number, to: number): [number[], number[]] => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = from; i < to; i++) {
      const it = items[order[i]!]!;
      for (let a = 0; a < 3; a++) {
        if (it.mins[a]! < lo[a]!) lo[a] = it.mins[a]!;
        if (it.maxs[a]! > hi[a]!) hi[a] = it.maxs[a]!;
      }
    }
    return [lo, hi];
  };

  const area = (lo: readonly number[], hi: readonly number[]): number => {
    const dx = Math.max(0, hi[0]! - lo[0]!);
    const dy = Math.max(0, hi[1]! - lo[1]!);
    const dz = Math.max(0, hi[2]! - lo[2]!);
    return 2 * (dx * dy + dy * dz + dz * dx);
  };

  /** Builds the subtree for `order[from..to)` and returns its node index. */
  const recurse = (from: number, to: number): number => {
    const node = build.right.length;
    const [lo, hi] = boundsOf(from, to);
    build.bounds.push(lo[0]!, lo[1]!, lo[2]!, hi[0]!, hi[1]!, hi[2]!);
    build.right.push(-1);
    build.start.push(from);
    build.count.push(to - from);

    const span = to - from;
    if (span <= LEAF_SIZE) return node;

    // Split along the axis the centroids spread over most: splitting a flat axis moves
    // nothing and recurses forever.
    let axis = 0;
    let cLo = [Infinity, Infinity, Infinity];
    let cHi = [-Infinity, -Infinity, -Infinity];
    for (let i = from; i < to; i++) {
      for (let a = 0; a < 3; a++) {
        const c = centroid[order[i]! * 3 + a]!;
        if (c < cLo[a]!) cLo[a] = c;
        if (c > cHi[a]!) cHi[a] = c;
      }
    }
    let best = -1;
    for (let a = 0; a < 3; a++) {
      const extent = cHi[a]! - cLo[a]!;
      if (extent > best) {
        best = extent;
        axis = a;
      }
    }
    // Every centroid coincides: no split can separate them, so this stays a leaf however
    // many items it holds. Twenty coincident brushes are cheaper to test than a tree that
    // never terminates.
    if (best <= 0) return node;

    const scale = BINS / best;
    const binCount = new Int32Array(BINS);
    const binLo: number[][] = [];
    const binHi: number[][] = [];
    for (let b = 0; b < BINS; b++) {
      binLo.push([Infinity, Infinity, Infinity]);
      binHi.push([-Infinity, -Infinity, -Infinity]);
    }
    const binOf = (item: number): number => {
      const b = Math.floor((centroid[item * 3 + axis]! - cLo[axis]!) * scale);
      return b < 0 ? 0 : b >= BINS ? BINS - 1 : b;
    };
    for (let i = from; i < to; i++) {
      const item = order[i]!;
      const b = binOf(item);
      binCount[b]! += 1;
      const it = items[item]!;
      for (let a = 0; a < 3; a++) {
        if (it.mins[a]! < binLo[b]![a]!) binLo[b]![a] = it.mins[a]!;
        if (it.maxs[a]! > binHi[b]![a]!) binHi[b]![a] = it.maxs[a]!;
      }
    }

    // Sweep the bin boundaries once from each side, so each candidate split knows the
    // bounds and count of both halves in O(1).
    const leftArea = new Float64Array(BINS);
    const leftCount = new Int32Array(BINS);
    let accLo = [Infinity, Infinity, Infinity];
    let accHi = [-Infinity, -Infinity, -Infinity];
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      for (let a = 0; a < 3; a++) {
        if (binLo[b]![a]! < accLo[a]!) accLo[a] = binLo[b]![a]!;
        if (binHi[b]![a]! > accHi[a]!) accHi[a] = binHi[b]![a]!;
      }
      acc += binCount[b]!;
      leftArea[b] = area(accLo, accHi);
      leftCount[b] = acc;
    }

    let bestCost = Infinity;
    let bestSplit = -1;
    accLo = [Infinity, Infinity, Infinity];
    accHi = [-Infinity, -Infinity, -Infinity];
    acc = 0;
    for (let b = BINS - 1; b > 0; b--) {
      for (let a = 0; a < 3; a++) {
        if (binLo[b]![a]! < accLo[a]!) accLo[a] = binLo[b]![a]!;
        if (binHi[b]![a]! > accHi[a]!) accHi[a] = binHi[b]![a]!;
      }
      acc += binCount[b]!;
      const lc = leftCount[b - 1]!;
      if (lc === 0 || acc === 0) continue;
      const cost = leftArea[b - 1]! * lc + area(accLo, accHi) * acc;
      if (cost < bestCost) {
        bestCost = cost;
        bestSplit = b;
      }
    }
    if (bestSplit < 0) return node;

    // Partition in place around the chosen bin boundary.
    let i = from;
    let j = to - 1;
    while (i <= j) {
      if (binOf(order[i]!) < bestSplit) {
        i += 1;
      } else {
        const t = order[i]!;
        order[i] = order[j]!;
        order[j] = t;
        j -= 1;
      }
    }
    if (i === from || i === to) return node;

    recurse(from, i);
    build.right[node] = recurse(i, to);
    build.count[node] = 0;
    return node;
  };

  if (n > 0) recurse(0, n);
  else {
    build.bounds.push(0, 0, 0, 0, 0, 0);
    build.right.push(-1);
    build.start.push(0);
    build.count.push(0);
  }

  return {
    bounds: Float64Array.from(build.bounds),
    right: Int32Array.from(build.right),
    start: Int32Array.from(build.start),
    count: Int32Array.from(build.count),
    order,
    nodeCount: build.right.length,
  };
}

/**
 * Whether a ray meets a node's box within `[0, maxT]`, by the slab method.
 *
 * `invDir` may be infinite for an axis-aligned ray; that is deliberate and correct as long
 * as the multiplication is not `0 * Infinity`, which is why the caller passes the reciprocal
 * rather than dividing here.
 */
export function slabHit(
  bvh: Bvh,
  node: number,
  origin: Vec3,
  invDir: Vec3,
  maxT: number,
  expand = 0,
): boolean {
  let tmin = 0;
  let tmax = maxT;
  const at = node * 6;
  for (let a = 0; a < 3; a++) {
    const lo = (bvh.bounds[at + a]! - expand - origin[a]!) * invDir[a]!;
    const hi = (bvh.bounds[at + 3 + a]! + expand - origin[a]!) * invDir[a]!;
    const near = lo < hi ? lo : hi;
    const far = lo < hi ? hi : lo;
    if (near > tmin) tmin = near;
    if (far < tmax) tmax = far;
    // Strictly greater, so a ray that grazes the box at exactly one point is kept. Nothing
    // here proves that matters: changing it to `>=` leaves every test in the suite green,
    // because an exact graze does not occur among random floats. It is kept because a
    // broadphase should err towards testing a brush it did not need to, never towards
    // skipping one it did -- and because an untested branch that leans the safe way is a
    // different thing from one that leans the other way.
    if (tmin > tmax) return false;
  }
  return true;
}

/** Whether a box overlaps a node's box, inflated by `expand`. */
export function boxHit(bvh: Bvh, node: number, mins: Vec3, maxs: Vec3, expand = 0): boolean {
  const at = node * 6;
  for (let a = 0; a < 3; a++) {
    if (maxs[a]! < bvh.bounds[at + a]! - expand) return false;
    if (mins[a]! > bvh.bounds[at + 3 + a]! + expand) return false;
  }
  return true;
}
