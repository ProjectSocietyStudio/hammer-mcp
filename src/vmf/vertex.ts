/**
 * Moving a brush's corners: Hammer's vertex manipulation tool.
 *
 * The last thing standing between "an assembly of boxes, cut" and an arbitrary convex
 * shape. `clip_solids` can take a piece off a brush; only this can pull one corner of a
 * wall outward to meet a street that does not run square.
 *
 * It is the most refusal-heavy tool here, and deliberately so. **A brush's faces must stay
 * flat**, and moving one corner moves it on every face that shares it -- three of them on a
 * box. Move a corner of a cube diagonally and three faces each acquire a fourth point off
 * their own plane. Hammer shows that as a red "invalid solid" and will not let you build
 * it; vbsp, handed one anyway, either drops the brush or wedges itself. So refusing is
 * parity with the editor, not a shortfall against it.
 *
 * What that means in practice, and it is worth saying because it surprises people: on a
 * six-sided box, the moves that keep every face flat are the ones that slide a corner
 * *along* an edge or *within* a face, plus whole-face moves. Anything else needs the face
 * triangulated first, which means more sides, which is a different operation and not this
 * one.
 *
 * Texture axes are left exactly as they were, which is what Hammer does: the plane under a
 * face moves, the projection onto it does not, and the texture slides with the geometry.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { findSolids } from "./select.js";
import {
  checkVmfSolids,
  hullFromPlanes,
  ON_EPSILON,
  planeFromPoints,
  pointsFromPlane,
} from "./solid.js";
import type { Plane, SolidCheck, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfVertexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfVertexError";
  }
}

export interface VertexMove {
  /** A corner of the brush, as `read_vmf_solids` reports it. */
  from: Vec3;
  to: Vec3;
}

export interface VertexResult {
  text: string;
  solidId: number;
  moved: number;
  volumeBefore: number;
  volumeAfter: number;
  minsAfter: Vec3;
  maxsAfter: Vec3;
  /** Worst distance from a corner to the plane of a face it belongs to, after the move. */
  worstPlanarityError: number;
  warnings: string[];
  unchanged: boolean;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const near = (a: Vec3, b: Vec3, eps: number): boolean =>
  Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps && Math.abs(a[2] - b[2]) <= eps;

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
const vec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;

/** Plane through a corner set, oriented away from `inside`. Null when they are collinear. */
function planeThrough(corners: readonly Vec3[], inside: Vec3): Plane | null {
  let best: [Vec3, Vec3, Vec3] | null = null;
  let bestArea = 0;
  for (let i = 0; i < corners.length; i++) {
    for (let j = i + 1; j < corners.length; j++) {
      for (let k = j + 1; k < corners.length; k++) {
        const a = corners[i]!;
        const b = corners[j]!;
        const c = corners[k]!;
        const u = sub(a, b);
        const v = sub(c, b);
        const area = Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        );
        if (area > bestArea) {
          bestArea = area;
          best = [a, b, c];
        }
      }
    }
  }
  if (!best || bestArea <= ON_EPSILON) return null;
  const p = planeFromPoints(best[0], best[1], best[2]);
  if (!p) return null;
  // Outward: the solid's interior must be on the `<= dist` side.
  return dot(p.normal, inside) - p.dist > 0
    ? { normal: [-p.normal[0], -p.normal[1], -p.normal[2]], dist: -p.dist }
    : p;
}

const centroid = (vs: readonly Vec3[]): Vec3 => [
  vs.reduce((s, v) => s + v[0], 0) / vs.length,
  vs.reduce((s, v) => s + v[1], 0) / vs.length,
  vs.reduce((s, v) => s + v[2], 0) / vs.length,
];

/**
 * Moves named corners of one brush and rewrites every face that touches them.
 *
 * `tolerance` is how close a caller's coordinate has to be to a real corner to name it. It
 * exists because a caller reading corners back through JSON gets them rounded, and
 * demanding exact equality would make the tool unusable from the outside.
 */
export function moveVertices(
  source: string,
  solidId: number,
  moves: readonly VertexMove[],
  tolerance = 0.5,
): VertexResult {
  if (moves.length === 0) throw new VmfVertexError("no vertices were named to move");

  const nodes = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const found = findSolids(nodes).find((f) => f.id === solidId);
  if (!found) {
    throw new VmfVertexError(`no solid with id ${solidId} in this map`);
  }
  if (found.hidden) {
    throw new VmfVertexError(
      `solid ${solidId} sits inside a hidden block; reshaping something invisible is the ` +
        `hardest kind of change to notice`,
    );
  }

  const report = checkVmfSolids("(memory)", source);
  const check: SolidCheck | undefined = report.solids.find((s) => s.id === solidId);
  if (!check) throw new VmfVertexError(`solid ${solidId} could not be read`);
  if (!check.valid) {
    throw new VmfVertexError(
      `solid ${solidId} is not a valid brush before the move, so reshaping it would only ` +
        `hide why: ` +
        check.findings
          .filter((f) => f.severity === "error")
          .map((f) => f.message)
          .join(" | "),
    );
  }
  if (check.sides.some((s) => s.hasDisplacement)) {
    throw new VmfVertexError(
      `solid ${solidId} carries a displacement. Its vertex grid is mapped onto a face of a ` +
        `fixed shape, and moving that face's corners leaves the grid describing a surface ` +
        `that is no longer there.`,
    );
  }

  // Name each move against a real corner, and refuse the ones that name none. A caller who
  // mistypes a coordinate must hear about it rather than watch nothing happen.
  const mapping = new Map<number, Vec3>();
  for (const move of moves) {
    const index = check.vertices.findIndex((v) => near(v, move.from, tolerance));
    if (index < 0) {
      throw new VmfVertexError(
        `(${vec(move.from)}) is not a corner of solid ${solidId}. Its corners are: ` +
          check.vertices.map((v) => `(${vec(v)})`).join(" "),
      );
    }
    if (mapping.has(index)) {
      throw new VmfVertexError(`(${vec(move.from)}) was named twice, with two destinations`);
    }
    mapping.set(index, move.to);
  }

  const movedHull = check.vertices.map((v, i) => mapping.get(i) ?? v);
  const inside = centroid(movedHull);

  const blocks = found.block.entries.filter(
    (n): n is KvBlock => n.kind === "block" && n.name === "side",
  );
  if (blocks.length !== check.sides.length) {
    throw new VmfVertexError(
      `solid ${solidId} has ${blocks.length} side blocks and ${check.sides.length} readable ` +
        `sides; refusing rather than rewriting the wrong one`,
    );
  }

  const splices: Splice[] = [];
  const warnings: string[] = [];
  const newPlanes: Plane[] = [];
  let worst = 0;

  for (let i = 0; i < check.sides.length; i++) {
    const side = check.sides[i]!;
    // Which hull corners this face owns, by position in the original corner list.
    const owned: number[] = [];
    for (const v of side.vertices) {
      const idx = check.vertices.findIndex((c) => near(c, v, ON_EPSILON));
      if (idx >= 0 && !owned.includes(idx)) owned.push(idx);
    }
    if (owned.length < 3) {
      throw new VmfVertexError(
        `solid ${solidId} has a face bounded by fewer than three corners, so it cannot be ` +
          `rebuilt from them`,
      );
    }
    const corners = owned.map((idx) => movedHull[idx]!);
    const plane = planeThrough(corners, inside);
    if (!plane) {
      throw new VmfVertexError(
        `after this move, one face of solid ${solidId} has all its corners in a line. A ` +
          `face with no area cannot state a plane, and vbsp drops the brush.`,
      );
    }

    // The refusal that matters. Moving one corner moves it on every face that shares it,
    // and on a box that is three faces at once -- so a diagonal pull leaves each of them
    // with a fourth point off its own plane. Hammer calls this an invalid solid and will
    // not build it either.
    for (const c of corners) {
      const off = Math.abs(dot(plane.normal, c) - plane.dist);
      if (off > worst) worst = off;
    }
    if (worst > ON_EPSILON) {
      throw new VmfVertexError(
        `this move leaves a face of solid ${solidId} out of plane by ${worst.toFixed(3)} ` +
          `units. Moving a corner moves it on every face that shares it -- three of them on ` +
          `a box -- and a face has to stay flat. Slide the corner along an edge or within a ` +
          `face, or move the whole face, and every plane stays a plane.`,
      );
    }

    newPlanes.push(plane);

    // A face none of whose corners moved keeps its own bytes. Rewriting it would produce
    // the same plane stated from a different triple -- pointsFromPlane picks the widest
    // one, which is rarely the three points Hammer wrote -- and a no-op that rewrites
    // bytes is indistinguishable from a real edit in a diff.
    if (!owned.some((idx) => mapping.has(idx))) continue;

    const pts = pointsFromPlane(plane, corners);
    if (!pts) {
      throw new VmfVertexError(`a face of solid ${solidId} cannot be written as three points`);
    }
    const block = blocks[i]!;
    const planePair = block.entries.find((n) => n.kind === "pair" && n.key === "plane");
    if (!planePair || planePair.kind !== "pair") {
      throw new VmfVertexError(`a side of solid ${solidId} has no plane to rewrite`);
    }
    splices.push({
      start: planePair.start,
      end: planePair.end,
      text: `"plane" "(${vec(pts[0])}) (${vec(pts[1])}) (${vec(pts[2])})"`,
    });
  }

  // The shape the new planes really enclose, which is the only thing that decides whether
  // the brush is still convex. Going planes -> hull here runs the opposite way from the
  // rewrite above, so an error cannot hide in both directions.
  const rebuilt = hullFromPlanes(newPlanes);
  if (rebuilt.length !== check.vertices.length) {
    throw new VmfVertexError(
      `this move leaves solid ${solidId} with ${rebuilt.length} corners where it had ` +
        `${check.vertices.length}. The planes no longer meet where the corners were asked ` +
        `to go, which means the result is not the shape that was requested.`,
    );
  }
  for (const want of movedHull) {
    if (!rebuilt.some((v) => near(v, want, 0.01))) {
      throw new VmfVertexError(
        `this move asked for a corner at (${vec(want)}), and the planes it produces do not ` +
          `meet there. The brush would be a different shape from the one requested.`,
      );
    }
  }

  const mins: Vec3 = [
    Math.min(...movedHull.map((v) => v[0])),
    Math.min(...movedHull.map((v) => v[1])),
    Math.min(...movedHull.map((v) => v[2])),
  ];
  const maxs: Vec3 = [
    Math.max(...movedHull.map((v) => v[0])),
    Math.max(...movedHull.map((v) => v[1])),
    Math.max(...movedHull.map((v) => v[2])),
  ];

  let volumeAfter = 0;
  for (let i = 0; i < newPlanes.length; i++) {
    const plane = newPlanes[i]!;
    const face = rebuilt.filter((v) => Math.abs(dot(plane.normal, v) - plane.dist) < ON_EPSILON);
    if (face.length < 3) continue;
    volumeAfter += plane.dist * areaOf(face, plane.normal);
  }
  volumeAfter /= 3;

  if (volumeAfter < check.volume * 0.5 || volumeAfter > check.volume * 2) {
    warnings.push(
      `this changes the brush's volume from ${Math.round(check.volume)} to ` +
        `${Math.round(volumeAfter)} cubic units. That may be what was wanted, and it is a ` +
        `large enough change to be worth reading twice.`,
    );
  }

  const text = applySplices(source, splices);
  return {
    text,
    solidId,
    moved: mapping.size,
    volumeBefore: check.volume,
    volumeAfter,
    minsAfter: mins,
    maxsAfter: maxs,
    worstPlanarityError: worst,
    warnings,
    unchanged: text === source,
  };
}

function areaOf(vertices: readonly Vec3[], normal: Vec3): number {
  const c = centroid(vertices);
  const d = sub(vertices[0]!, c);
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-9) return 0;
  const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const v: Vec3 = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  const ordered = [...vertices].sort((p, q) => {
    const dp = sub(p, c);
    const dq = sub(q, c);
    return Math.atan2(dot(dp, v), dot(dp, u)) - Math.atan2(dot(dq, v), dot(dq, u));
  });
  let area = 0;
  for (let i = 0; i < ordered.length; i++) {
    const a = sub(ordered[i]!, c);
    const b = sub(ordered[(i + 1) % ordered.length]!, c);
    area += dot(normal, [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]);
  }
  return Math.abs(area) / 2;
}
