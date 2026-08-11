import { readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader } from "./header.js";
import type { Vec3 } from "../entity/model.js";

const LUMP_PLANES = 1;
const LUMP_NODES = 5;
const LUMP_LEAFS = 10;

const PLANE_BYTES = 20;
const NODE_BYTES = 32;
/** `dleaf_t` as of lump version 1: the compressed light cube moved out to lump 56. */
const LEAF_BYTES_V1 = 32;

/** From `bspflags.h`. The only content flag a line of sight cares about. */
export const CONTENTS_SOLID = 0x1;

/**
 * Nudge used when splitting a segment on a plane, from Quake's hull check and unchanged
 * through Source. Without it a segment that grazes a plane can be assigned to the wrong
 * side and slip through a wall.
 */
const DIST_EPSILON = 0.03125;

export class BspGeometryError extends Error {}

export interface BspTree {
  header: BspHeader;
  planeNormals: Float32Array;
  planeDists: Float32Array;
  nodePlane: Int32Array;
  nodeChildren: Int32Array;
  leafContents: Int32Array;
  nodeCount: number;
  leafCount: number;
}

/**
 * Loads the collision tree of the world model: planes, nodes and leaf contents.
 *
 * This is the same structure the engine walks for a `util.TraceLine`, so a line of sight
 * computed here is the one the game would agree with -- for world geometry. What it does
 * NOT include is brush entities (`func_*`, whose geometry is a separate model) and props,
 * which are not in this tree at all. A door counts as open, a parked car as absent.
 *
 * Reads three lumps and nothing else: on the 1.13 GB production map that is about 1.6 MB.
 */
export function readTree(path: string): BspTree {
  const header = readHeader(path);

  const planesLump = requireLump(header, LUMP_PLANES);
  const nodesLump = requireLump(header, LUMP_NODES);
  const leafsLump = requireLump(header, LUMP_LEAFS);

  if (leafsLump.version !== 1) {
    // Version 0 carries a 24-byte CompressedLightCube per leaf and is 56 bytes wide.
    // Guessing would silently read garbage contents and report walls where there are
    // none, so refuse instead.
    throw new BspGeometryError(
      `${path}: LEAFS lump is version ${leafsLump.version}; only version 1 ` +
        `(32-byte leaves) is supported`,
    );
  }
  for (const [name, lump, size] of [
    ["PLANES", planesLump, PLANE_BYTES],
    ["NODES", nodesLump, NODE_BYTES],
    ["LEAFS", leafsLump, LEAF_BYTES_V1],
  ] as const) {
    if (lump.length % size !== 0) {
      throw new BspGeometryError(
        `${path}: ${name} lump is ${lump.length} bytes, not a multiple of ${size}`,
      );
    }
  }

  const planeCount = planesLump.length / PLANE_BYTES;
  const planeRaw = readAt(path, planesLump.offset, planesLump.length);
  const planeView = new DataView(
    planeRaw.buffer,
    planeRaw.byteOffset,
    planeRaw.byteLength,
  );
  const planeNormals = new Float32Array(planeCount * 3);
  const planeDists = new Float32Array(planeCount);
  for (let i = 0; i < planeCount; i++) {
    const at = i * PLANE_BYTES;
    planeNormals[i * 3] = planeView.getFloat32(at, true);
    planeNormals[i * 3 + 1] = planeView.getFloat32(at + 4, true);
    planeNormals[i * 3 + 2] = planeView.getFloat32(at + 8, true);
    planeDists[i] = planeView.getFloat32(at + 12, true);
  }

  const nodeCount = nodesLump.length / NODE_BYTES;
  const nodeRaw = readAt(path, nodesLump.offset, nodesLump.length);
  const nodeView = new DataView(nodeRaw.buffer, nodeRaw.byteOffset, nodeRaw.byteLength);
  const nodePlane = new Int32Array(nodeCount);
  const nodeChildren = new Int32Array(nodeCount * 2);
  for (let i = 0; i < nodeCount; i++) {
    const at = i * NODE_BYTES;
    nodePlane[i] = nodeView.getInt32(at, true);
    nodeChildren[i * 2] = nodeView.getInt32(at + 4, true);
    nodeChildren[i * 2 + 1] = nodeView.getInt32(at + 8, true);
  }

  const leafCount = leafsLump.length / LEAF_BYTES_V1;
  const leafRaw = readAt(path, leafsLump.offset, leafsLump.length);
  const leafView = new DataView(leafRaw.buffer, leafRaw.byteOffset, leafRaw.byteLength);
  const leafContents = new Int32Array(leafCount);
  for (let i = 0; i < leafCount; i++) {
    leafContents[i] = leafView.getInt32(i * LEAF_BYTES_V1, true);
  }

  return {
    header,
    planeNormals,
    planeDists,
    nodePlane,
    nodeChildren,
    leafContents,
    nodeCount,
    leafCount,
  };
}

/** Contents of the leaf a point falls in. */
export function pointContents(tree: BspTree, p: Vec3): number {
  let node = 0;
  while (node >= 0) {
    const plane = tree.nodePlane[node]!;
    const d =
      tree.planeNormals[plane * 3]! * p[0] +
      tree.planeNormals[plane * 3 + 1]! * p[1] +
      tree.planeNormals[plane * 3 + 2]! * p[2] -
      tree.planeDists[plane]!;
    node = tree.nodeChildren[node * 2 + (d >= 0 ? 0 : 1)]!;
  }
  return tree.leafContents[-1 - node] ?? CONTENTS_SOLID;
}

export interface TraceResult {
  /** Where along the segment the first solid was met; 1 when nothing was hit. */
  fraction: number;
  hit: boolean;
  /** The segment began inside solid, which makes the result meaningless. */
  startSolid: boolean;
}

/**
 * Traces a segment against the world tree and reports where it first meets solid.
 *
 * The recursion is Quake's `SV_RecursiveHullCheck`, unchanged in Source: descend the
 * tree, split the segment at each plane it crosses, and take the near side first so the
 * first solid found is the nearest one.
 */
export function traceRay(tree: BspTree, start: Vec3, end: Vec3): TraceResult {
  const out: TraceResult = { fraction: 1, hit: false, startSolid: false };

  const recurse = (node: number, p1f: number, p2f: number, p1: Vec3, p2: Vec3): boolean => {
    if (node < 0) {
      const contents = tree.leafContents[-1 - node] ?? CONTENTS_SOLID;
      if ((contents & CONTENTS_SOLID) !== 0) {
        if (p1f === 0) out.startSolid = true;
        out.hit = true;
        out.fraction = p1f;
        return false;
      }
      return true;
    }

    const plane = tree.nodePlane[node]!;
    const nx = tree.planeNormals[plane * 3]!;
    const ny = tree.planeNormals[plane * 3 + 1]!;
    const nz = tree.planeNormals[plane * 3 + 2]!;
    const dist = tree.planeDists[plane]!;

    const t1 = nx * p1[0] + ny * p1[1] + nz * p1[2] - dist;
    const t2 = nx * p2[0] + ny * p2[1] + nz * p2[2] - dist;

    if (t1 >= 0 && t2 >= 0) {
      return recurse(tree.nodeChildren[node * 2]!, p1f, p2f, p1, p2);
    }
    if (t1 < 0 && t2 < 0) {
      return recurse(tree.nodeChildren[node * 2 + 1]!, p1f, p2f, p1, p2);
    }

    let frac: number;
    if (t1 < t2) frac = (t1 + DIST_EPSILON) / (t1 - t2);
    else if (t1 > t2) frac = (t1 - DIST_EPSILON) / (t1 - t2);
    else frac = 0;
    frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;

    const midf = p1f + (p2f - p1f) * frac;
    const mid: Vec3 = [
      p1[0] + frac * (p2[0] - p1[0]),
      p1[1] + frac * (p2[1] - p1[1]),
      p1[2] + frac * (p2[2] - p1[2]),
    ];
    const near = t1 < 0 ? 1 : 0;

    if (!recurse(tree.nodeChildren[node * 2 + near]!, p1f, midf, p1, mid)) return false;
    return recurse(tree.nodeChildren[node * 2 + (near ^ 1)]!, midf, p2f, mid, p2);
  };

  recurse(0, 0, 1, start, end);
  return out;
}

/** True when nothing solid stands between the two points. */
export function isVisible(tree: BspTree, a: Vec3, b: Vec3): boolean {
  const t = traceRay(tree, a, b);
  return !t.hit;
}

export interface GroundPoint {
  /** Eye position: the ground contact, raised by the eye height. */
  eye: Vec3;
  groundZ: number;
}

/**
 * Finds standable ground under a column, and returns an eye point above it.
 *
 * Written because the obvious shortcut is wrong. Sampling entity origins looks
 * reasonable and is not: on `rp_nycity_day` the `path_track` entities run up to z=3980
 * because they are tower elevator routes, and the median `info_player_start` sits at
 * z=-380 in a spawn room beneath the map. Lines of sight measured between those points
 * are real lines over the rooftops, and have nothing to do with what a player on a
 * street can see. Ground is found here, not assumed.
 *
 * Returns undefined when the column has no floor, which is the usual case over the void
 * outside the playable area.
 */
export function columnSurfaces(
  tree: BspTree,
  x: number,
  y: number,
  topZ: number,
  bottomZ: number,
  eyeHeight: number,
  step = 32,
  maxLevels = 24,
): GroundPoint[] {
  const found: GroundPoint[] = [];
  let z = topZ;

  while (z > bottomZ && found.length < maxLevels) {
    // Skip solid: the top of a column is usually inside the sky brush, and later
    // passes start inside the floor we just landed on.
    while (z > bottomZ && (pointContents(tree, [x, y, z]) & CONTENTS_SOLID) !== 0) {
      z -= step;
    }
    if (z <= bottomZ) break;

    const t = traceRay(tree, [x, y, z], [x, y, bottomZ]);
    if (!t.hit || t.startSolid) break;

    const groundZ = z + (bottomZ - z) * t.fraction;
    const eye: Vec3 = [x, y, groundZ + eyeHeight];
    // A ceiling below eye height is a crawlspace, not somewhere to stand.
    if ((pointContents(tree, eye) & CONTENTS_SOLID) === 0) {
      found.push({ eye, groundZ });
    }
    const next = groundZ - step;
    if (next >= z) break; // no progress; refuse to spin
    z = next;
  }

  return found;
}

/**
 * The lowest standable surface in a column, which on a city map is the street.
 *
 * Taking the FIRST surface a downward trace meets is the trap: it is the roof. On
 * `rp_nycity_day` that put sample points as high as z=7232 and produced 852 m "lines of
 * sight" across the skyline. Descending to the bottom of the column is what makes the
 * measurement about the place players walk.
 */
export function groundSample(
  tree: BspTree,
  x: number,
  y: number,
  topZ: number,
  bottomZ: number,
  eyeHeight: number,
  step = 32,
): GroundPoint | undefined {
  const levels = columnSurfaces(tree, x, y, topZ, bottomZ, eyeHeight, step);
  return levels[levels.length - 1];
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
