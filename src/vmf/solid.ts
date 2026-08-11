/**
 * Reading brush geometry back out of a `.vmf`, from the planes alone.
 *
 * This file exists to be an **oracle**, and the direction it runs in is the whole point.
 * A VMF stores a brush as a set of planes, each written as three points; a tool that
 * creates a brush starts from a volume and emits those planes. This module goes the other
 * way -- it takes the planes and rebuilds the volume by intersecting half-spaces. A sign
 * error, an inverted winding or a plane that does not bound anything cannot survive both
 * directions, so the writer and the reader check each other rather than sharing a bug.
 *
 * That matters because of what `../vmf/edit.ts` used to say: a brush writer without a
 * visual oracle produces maps that compile and are wrong. It is right about the risk. The
 * answer is not to keep refusing, it is to supply oracles -- this one is the algebraic
 * one, and it is the cheapest of the four. The compiler is the second (vbsp rejects what
 * it cannot bound), a sealed room that boots is the third, and a human looking at the
 * screen is the fourth and the only one that catches ugly.
 *
 * ## The plane convention, verified rather than recalled
 *
 * Valve winds a side's three points clockwise seen from outside, and vbsp takes the normal
 * as `cross(p0 - p1, p2 - p1)`. Checked here against the known-good `+z` face of
 * `test/fixtures/gen_probe.py`, which compiles and boots: its points give `(0, 0, +1)`,
 * pointing up and out of the brush, as they must. The solid is then the intersection of
 * `dot(n, x) <= dist` over every side.
 *
 * Getting this backwards is not a subtle failure -- every half-space inverts and the
 * intersection comes out empty -- which is exactly why it makes a good test.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import type { Finding } from "../schemas.js";

export type Vec3 = readonly [number, number, number];

/** `MAX_COORD_INTEGER` from `src/public/worldsize.h`: the world is -16384..+16384 per axis. */
export const WORLD_BOUND = 16384;

/**
 * How near a plane a point must be to count as lying on it, in Hammer units.
 *
 * Source's own `ON_EPSILON`. Coordinates here run to 16384, and a float32 carries about
 * seven significant digits, so tightening this would start rejecting real Hammer output
 * for rounding that Hammer itself accepts.
 */
export const ON_EPSILON = 0.01;

/** Below this determinant, three planes are too near parallel to give a usable corner. */
const PARALLEL_EPSILON = 1e-6;

/** Brushes have a handful of sides. Far past anything Hammer writes, and it bounds the O(n^3). */
const MAX_SIDES = 128;

export interface Plane {
  normal: Vec3;
  dist: number;
}

export interface TextureAxis {
  axis: Vec3;
  offset: number;
  scale: number;
}

export interface SolidSide {
  id: number | null;
  material: string;
  plane: Plane | null;
  points: [Vec3, Vec3, Vec3] | null;
  /** Hull vertices lying on this side's plane. Fewer than three means it bounds nothing. */
  vertices: Vec3[];
  /** Polygon area in square Hammer units. 0 when the side bounds nothing. */
  area: number;
  uaxis: TextureAxis | null;
  vaxis: TextureAxis | null;
  lightmapScale: number | null;
  /** A `dispinfo` sub-block: the rendered surface is not this plane. */
  hasDisplacement: boolean;
}

export interface SolidCheck {
  /** Hammer's own solid id, as shown in its entity report. */
  id: number | null;
  /** `world`, or the classname of the brush entity holding this solid. */
  owner: string;
  /** Index among all solids of the file, 0-based and stable within one read. */
  index: number;
  sides: SolidSide[];
  /** Corners of the convex hull the planes enclose. */
  vertices: Vec3[];
  mins: Vec3;
  maxs: Vec3;
  /** Volume in cubic Hammer units, by the divergence theorem over the faces. */
  volume: number;
  /** Coarsest grid every corner lands on, from `largestGrid`. 0 means not on whole units. */
  grid: number;
  findings: Finding[];
  /** No finding of severity `error`. */
  valid: boolean;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a: Vec3): number => Math.sqrt(dot(a, a));

function normalise(a: Vec3): Vec3 | null {
  const l = length(a);
  if (l < PARALLEL_EPSILON) return null;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/**
 * The plane through three points, wound Valve's way.
 *
 * Null when the points are collinear: there is no plane through them, and inventing one
 * would turn a malformed brush into a plausible wrong volume.
 */
export function planeFromPoints(p0: Vec3, p1: Vec3, p2: Vec3): Plane | null {
  const normal = normalise(cross(sub(p0, p1), sub(p2, p1)));
  if (!normal) return null;
  return { normal, dist: dot(normal, p1) };
}

/** Parses `(x y z) (x y z) (x y z)` as a VMF `plane` value. */
export function parsePlanePoints(value: string): [Vec3, Vec3, Vec3] | null {
  const groups = value.match(/\(([^)]*)\)/g);
  if (!groups || groups.length !== 3) return null;
  const points: Vec3[] = [];
  for (const g of groups) {
    const n = g
      .slice(1, -1)
      .trim()
      .split(/\s+/)
      .map((s) => Number(s));
    if (n.length !== 3 || n.some((x) => !Number.isFinite(x))) return null;
    points.push([n[0]!, n[1]!, n[2]!]);
  }
  return points as unknown as [Vec3, Vec3, Vec3];
}

/** Parses `[x y z offset] scale` as a VMF `uaxis`/`vaxis` value. */
export function parseTextureAxis(value: string): TextureAxis | null {
  const m = value.match(/\[([^\]]*)\]\s*(\S+)/);
  if (!m) return null;
  const n = m[1]!.trim().split(/\s+/).map(Number);
  const scale = Number(m[2]);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x)) || !Number.isFinite(scale)) return null;
  return { axis: [n[0]!, n[1]!, n[2]!], offset: n[3]!, scale };
}

/** The point where three planes meet, or null when they are too near parallel. */
function intersect(a: Plane, b: Plane, c: Plane): Vec3 | null {
  const bc = cross(b.normal, c.normal);
  const det = dot(a.normal, bc);
  if (Math.abs(det) < PARALLEL_EPSILON) return null;
  const ca = cross(c.normal, a.normal);
  const ab = cross(a.normal, b.normal);
  return [
    (a.dist * bc[0] + b.dist * ca[0] + c.dist * ab[0]) / det,
    (a.dist * bc[1] + b.dist * ca[1] + c.dist * ab[1]) / det,
    (a.dist * bc[2] + b.dist * ca[2] + c.dist * ab[2]) / det,
  ];
}

/** Centroid of a point set. Undefined for an empty one, which no caller has. */
function centroid(vertices: readonly Vec3[]): Vec3 {
  const n = vertices.length;
  return [
    vertices.reduce((s, v) => s + v[0], 0) / n,
    vertices.reduce((s, v) => s + v[1], 0) / n,
    vertices.reduce((s, v) => s + v[2], 0) / n,
  ];
}

/**
 * Sorts a coplanar point set into the loop that walks its perimeter.
 *
 * Exact for a convex face, which is the only kind a brush has: sorting by angle around
 * the centroid cannot skip a vertex or cross an edge when every vertex is on the hull.
 * The order is counter-clockwise seen from the `normal` side -- angles increase from the
 * arbitrary first vertex towards `cross(normal, u)`, which is the right-hand turn.
 *
 * This existed inside `polygonArea`, which threw the loop away and returned a scalar.
 * Clipping a brush and moving one of its vertices both need the loop itself: a face
 * inherited from a cut has a plane and a corner set, and re-emitting it means writing
 * three points that wind the right way round.
 */
export function orderedLoop(vertices: readonly Vec3[], normal: Vec3): Vec3[] {
  if (vertices.length < 3) return [...vertices];
  const c = centroid(vertices);
  const u = normalise(sub(vertices[0]!, c));
  if (!u) return [...vertices];
  const v = cross(normal, u);
  return [...vertices].sort((p, q) => {
    const dp = sub(p, c);
    const dq = sub(q, c);
    return Math.atan2(dot(dp, v), dot(dp, u)) - Math.atan2(dot(dq, v), dot(dq, u));
  });
}

/** Area of a coplanar point set, ordered around its own centroid before summing. */
function polygonArea(vertices: Vec3[], normal: Vec3): number {
  if (vertices.length < 3) return 0;
  const ordered = orderedLoop(vertices, normal);
  if (ordered.length < 3) return 0;
  const c = centroid(vertices);

  let area = 0;
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    const q = ordered[(i + 1) % ordered.length]!;
    area += dot(normal, cross(sub(p, c), sub(q, c)));
  }
  return Math.abs(area) / 2;
}

/**
 * Picks the three points a `.vmf` side needs to state `plane`, from that face's corners.
 *
 * The missing half of the write path. `buildSolidText` emits planes from an explicit mesh
 * loop it built itself; a face that came out of a clip or a vertex move has only a plane
 * and a set of corners, and nothing turned that back into something writable.
 *
 * Two things decide correctness, and both are checked here rather than reasoned about:
 *
 * **The triple must not be collinear**, or the plane it states is degenerate -- so the
 * widest triangle available is chosen rather than the first three corners, which on a
 * face with a nearly-flat corner can be almost a line.
 *
 * **The winding must reproduce the plane it came from.** VMF states a face by three points
 * clockwise seen from outside the solid, and `planeFromPoints` is the same reading in
 * reverse. So the result is fed back through it and the triple is flipped when the normal
 * comes out facing the wrong way. A brush whose faces are wound inwards compiles into a
 * solid that encloses nothing, and vbsp does not always say so -- it can spin instead.
 */
export function pointsFromPlane(plane: Plane, vertices: readonly Vec3[]): [Vec3, Vec3, Vec3] | null {
  if (vertices.length < 3) return null;
  const loop = orderedLoop(vertices, plane.normal);

  let best: [Vec3, Vec3, Vec3] | null = null;
  let bestArea = 0;
  for (let i = 0; i < loop.length; i++) {
    for (let j = i + 1; j < loop.length; j++) {
      for (let k = j + 1; k < loop.length; k++) {
        const a = loop[i]!;
        const b = loop[j]!;
        const c = loop[k]!;
        const area = length(cross(sub(a, b), sub(c, b)));
        if (area > bestArea) {
          bestArea = area;
          best = [a, b, c];
        }
      }
    }
  }
  if (!best || bestArea <= ON_EPSILON) return null;

  const check = planeFromPoints(best[0], best[1], best[2]);
  if (!check) return null;
  return dot(check.normal, plane.normal) < 0 ? [best[2], best[1], best[0]] : best;
}

/**
 * Rebuilds the convex hull a set of planes encloses.
 *
 * Every triple of planes gives a candidate corner; a candidate survives only if it lies
 * inside every other half-space. That is the textbook method and it is O(n^3), which is
 * nothing at the six to twenty sides a brush actually has.
 */
export function hullFromPlanes(planes: readonly Plane[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      for (let k = j + 1; k < planes.length; k++) {
        const p = intersect(planes[i]!, planes[j]!, planes[k]!);
        if (!p) continue;
        let inside = true;
        for (const q of planes) {
          if (dot(q.normal, p) - q.dist > ON_EPSILON) {
            inside = false;
            break;
          }
        }
        if (!inside) continue;
        if (out.some((v) => Math.abs(v[0] - p[0]) < ON_EPSILON &&
          Math.abs(v[1] - p[1]) < ON_EPSILON &&
          Math.abs(v[2] - p[2]) < ON_EPSILON)) {
          continue;
        }
        out.push(p);
      }
    }
  }
  return out;
}

/** The grids a mapper actually works on, coarsest first. Hammer's own ladder is powers of two. */
export const GRID_LADDER = [512, 256, 128, 64, 32, 16, 8, 4, 2, 1] as const;

/**
 * The coarsest grid every corner of a solid lands on, or 0 when they are not whole units.
 *
 * This is a measurement, not a judgement. "Build everything on 8" is a real and widely
 * held discipline, and it buys real things -- brushes meet exactly instead of leaving the
 * hairline cracks that produce light leaks, and vbsp splits along fewer planes. But it is
 * a house rule, not something the engine checks, and a rotated brush breaks it by
 * construction without being wrong. Reporting the distribution lets someone see whether a
 * map is uniform instead of believing it is.
 */
export function largestGrid(vertices: readonly Vec3[]): number {
  if (vertices.length === 0) return 0;
  for (const g of GRID_LADDER) {
    const fits = vertices.every((v) =>
      v.every((c) => Math.abs(c / g - Math.round(c / g)) * g < ON_EPSILON),
    );
    if (fits) return g;
  }
  return 0;
}

export interface CheckOptions {
  /**
   * Grid size vertices are expected to land on. 1 accepts any integer; 0 disables the
   * check. Off-grid vertices are a warning, never an error -- rotated brushes are legal
   * and land wherever the rotation puts them.
   */
  grid?: number;
}

/** Checks one parsed `solid` block. */
export function checkSolid(
  block: KvBlock,
  owner: string,
  index: number,
  options: CheckOptions = {},
): SolidCheck {
  const grid = options.grid ?? 1;
  const findings: Finding[] = [];
  const idText = get(block, "id");
  const id = idText !== undefined && /^\d+$/.test(idText) ? Number(idText) : null;
  const where = `solid ${id ?? `#${index}`} in ${owner}`;

  const sideBlocks = children(block, "side");
  const sides: SolidSide[] = [];

  if (sideBlocks.length > MAX_SIDES) {
    findings.push({
      severity: "error",
      rule: "too-many-sides",
      message:
        `${where} has ${sideBlocks.length} sides; this reader stops at ${MAX_SIDES}. ` +
        `Hammer never writes a brush anywhere near that, so this is a malformed file ` +
        `rather than an unusual one.`,
    });
  }

  for (const sideBlock of sideBlocks.slice(0, MAX_SIDES)) {
    const sideIdText = get(sideBlock, "id");
    const sideId = sideIdText !== undefined && /^\d+$/.test(sideIdText) ? Number(sideIdText) : null;
    const planeText = get(sideBlock, "plane");
    const points = planeText !== undefined ? parsePlanePoints(planeText) : null;
    const plane = points ? planeFromPoints(...points) : null;
    const lightmapText = get(sideBlock, "lightmapscale");

    if (planeText === undefined) {
      findings.push({
        severity: "error",
        rule: "missing-plane",
        message: `${where}: side ${sideId ?? "?"} has no plane`,
        entityId: sideId ?? undefined,
      });
    } else if (!points) {
      findings.push({
        severity: "error",
        rule: "unreadable-plane",
        message: `${where}: side ${sideId ?? "?"} plane ${JSON.stringify(planeText)} is not three points`,
        entityId: sideId ?? undefined,
      });
    } else if (!plane) {
      findings.push({
        severity: "error",
        rule: "degenerate-plane",
        message:
          `${where}: side ${sideId ?? "?"} has three collinear points, so they define no ` +
          `plane. vbsp will drop this side and the brush stops being closed.`,
        entityId: sideId ?? undefined,
      });
    }

    sides.push({
      id: sideId,
      material: get(sideBlock, "material") ?? "",
      plane,
      points,
      vertices: [],
      area: 0,
      uaxis: parseTextureAxis(get(sideBlock, "uaxis") ?? ""),
      vaxis: parseTextureAxis(get(sideBlock, "vaxis") ?? ""),
      lightmapScale:
        lightmapText !== undefined && Number.isFinite(Number(lightmapText))
          ? Number(lightmapText)
          : null,
      hasDisplacement: children(sideBlock, "dispinfo").length > 0,
    });
  }

  if (sides.length < 4) {
    findings.push({
      severity: "error",
      rule: "too-few-sides",
      message:
        `${where} has ${sides.length} sides. A closed volume needs at least four; fewer ` +
        `cannot bound anything, whatever the planes say.`,
    });
  }

  const planes = sides.map((s) => s.plane).filter((p): p is Plane => p !== null);
  const vertices = planes.length >= 4 ? hullFromPlanes(planes) : [];

  // Assign hull corners to the sides they lie on, and measure each face.
  for (const side of sides) {
    if (!side.plane) continue;
    const plane = side.plane;
    side.vertices = vertices.filter((v) => Math.abs(dot(plane.normal, v) - plane.dist) < ON_EPSILON);
    side.area = polygonArea(side.vertices, plane.normal);

    if (vertices.length >= 4 && side.vertices.length < 3) {
      findings.push({
        severity: "error",
        rule: "redundant-side",
        message:
          `${where}: side ${side.id ?? "?"} touches ${side.vertices.length} of the hull's ` +
          `corners, so it bounds no face. It is either redundant or the brush is not the ` +
          `shape its planes describe.`,
        entityId: side.id ?? undefined,
      });
    } else if (side.vertices.length >= 3 && side.area < ON_EPSILON) {
      findings.push({
        severity: "error",
        rule: "zero-area-face",
        message: `${where}: side ${side.id ?? "?"} has a face of no area`,
        entityId: side.id ?? undefined,
      });
    }

    // The texture axes: where a hand-rolled brush writer goes wrong far more often than
    // it does on the planes. An axis lying along the face normal has no extent across the
    // surface, so the texture stretches without bound -- and the map still compiles.
    for (const [name, axis] of [
      ["uaxis", side.uaxis],
      ["vaxis", side.vaxis],
    ] as const) {
      if (!axis) {
        findings.push({
          severity: "warning",
          rule: "missing-texture-axis",
          message: `${where}: side ${side.id ?? "?"} has no readable ${name}`,
          entityId: side.id ?? undefined,
        });
        continue;
      }
      const unit = normalise(axis.axis);
      if (!unit) {
        findings.push({
          severity: "error",
          rule: "degenerate-texture-axis",
          message: `${where}: side ${side.id ?? "?"} ${name} is a zero-length vector`,
          entityId: side.id ?? undefined,
        });
        continue;
      }
      if (Math.abs(dot(unit, plane.normal)) > 1 - 1e-3) {
        findings.push({
          severity: "error",
          rule: "texture-axis-along-normal",
          message:
            `${where}: side ${side.id ?? "?"} ${name} points along the face normal, so the ` +
            `texture has no extent across this surface and stretches without bound. ` +
            `The map compiles either way; only the eye catches it.`,
          entityId: side.id ?? undefined,
        });
      }
      if (axis.scale === 0) {
        findings.push({
          severity: "error",
          rule: "zero-texture-scale",
          message: `${where}: side ${side.id ?? "?"} ${name} has a scale of 0`,
          entityId: side.id ?? undefined,
        });
      }
    }
  }

  const axes = [0, 1, 2] as const;
  // `+ 0` collapses negative zero, which Math.min produces whenever a corner sits exactly
  // on an axis. It prints as "0" and compares equal to 0 under ==, so it survives every
  // casual check and then fails an Object.is comparison in a caller's test.
  const mins: Vec3 = vertices.length
    ? (axes.map((a) => Math.min(...vertices.map((v) => v[a])) + 0) as unknown as Vec3)
    : [0, 0, 0];
  const maxs: Vec3 = vertices.length
    ? (axes.map((a) => Math.max(...vertices.map((v) => v[a])) + 0) as unknown as Vec3)
    : [0, 0, 0];

  // Divergence theorem: for a closed convex hull, 3V = sum over faces of (n . p) * area,
  // and (n . p) is exactly the plane's own distance. No tetrahedra to fan out.
  let volume = 0;
  for (const side of sides) {
    if (side.plane && side.area > 0) volume += side.plane.dist * side.area;
  }
  volume = Math.abs(volume) / 3;

  // The closure test, and the reason it comes after the volume rather than before it.
  //
  // The obvious check -- "fewer than four corners" -- misses the case this oracle was
  // built for. Reverse one side's winding on a box and its half-space flips outward; the
  // solid becomes an infinite prism, open at one end. The four corners at the closed end
  // still exist and still satisfy every half-space, so a corner count alone says four and
  // looks healthy. What gives it away is that those four corners are coplanar, so the
  // enclosed volume is zero. Measured, not reasoned about: this is what the probe does
  // when its first side is reversed.
  if (planes.length >= 4 && (vertices.length < 4 || volume < ON_EPSILON)) {
    findings.push({
      severity: "error",
      rule: "unbounded-solid",
      message:
        `${where} encloses no volume: ${planes.length} planes yield ${vertices.length} ` +
        `corners and a volume of ${volume.toFixed(2)}. The usual cause is one side wound ` +
        `the wrong way -- its half-space then faces outward and the solid is open at that ` +
        `end, however many corners survive at the other.`,
    });
  }

  const outside = vertices.filter((v) => v.some((c) => Math.abs(c) > WORLD_BOUND));
  if (outside.length > 0) {
    findings.push({
      severity: "error",
      rule: "outside-world",
      message:
        `${where} has ${outside.length} corner(s) beyond +/-${WORLD_BOUND}. ` +
        `That bound is MAX_COORD_INTEGER; the often-quoted 32768 is COORD_EXTENT, the ` +
        `width of the range, and building to it leaves the world by a factor of two.`,
    });
  }

  const gridSize = largestGrid(vertices);

  if (gridSize === 0 && vertices.length > 0) {
    findings.push({
      severity: "warning",
      rule: "off-grid",
      message:
        `${where} has corners that are not whole units. Legal, and unavoidable on a rotated ` +
        `brush -- but on an axis-aligned one it means the geometry drifted, and drift is ` +
        `what produces the hairline cracks and light leaks that no log ever mentions.`,
    });
  } else if (grid > 0 && gridSize > 0 && gridSize < grid) {
    findings.push({
      severity: "warning",
      rule: "below-grid",
      message:
        `${where} sits on a ${gridSize}-unit grid, finer than the ${grid} asked for. Not an ` +
        `error: it is how uniform the geometry is, which is a house rule, not an engine one.`,
    });
  }

  return {
    id,
    owner,
    index,
    sides,
    vertices,
    mins,
    maxs,
    volume: Math.round(volume * 100) / 100,
    grid: gridSize,
    findings,
    valid: !findings.some((f) => f.severity === "error"),
  };
}

export interface SolidsReport {
  path: string;
  solidCount: number;
  /** Solids with no error-severity finding. */
  validCount: number;
  solids: SolidCheck[];
  findings: Finding[];
  /**
   * How many solids sit on each grid, coarsest first, with key `"0"` for off-grid ones.
   *
   * A map built to one discipline concentrates here; a map built by accretion spreads.
   * Which of those is better is not this tool's call -- it reports the shape and stops.
   */
  gridHistogram: Record<string, number>;
}

/** Reads every `solid` of a VMF -- in `world` and in every brush entity -- and checks it. */
export function checkVmfSolids(path: string, source: string, options: CheckOptions = {}): SolidsReport {
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const solids: SolidCheck[] = [];
  let index = 0;

  const collect = (block: KvBlock, owner: string): void => {
    for (const solid of children(block, "solid")) {
      solids.push(checkSolid(solid, owner, index++, options));
    }
    // Hammer wraps a solid hidden by a visgroup in a `hidden` block rather than removing
    // it. It still compiles into the map, so an oracle that skipped these would report a
    // clean file whose hidden half is broken.
    for (const hidden of children(block, "hidden")) {
      for (const solid of children(hidden, "solid")) {
        solids.push(checkSolid(solid, owner, index++, options));
      }
    }
  };

  for (const root of roots) {
    if (root.name === "world") {
      collect(root, "world");
    } else if (root.name === "entity") {
      collect(root, get(root, "classname") ?? "entity");
    }
  }

  const gridHistogram: Record<string, number> = {};
  for (const s of solids) {
    const key = String(s.grid);
    gridHistogram[key] = (gridHistogram[key] ?? 0) + 1;
  }

  return {
    path,
    solidCount: solids.length,
    validCount: solids.filter((s) => s.valid).length,
    solids,
    findings: solids.flatMap((s) => s.findings),
    gridHistogram,
  };
}
