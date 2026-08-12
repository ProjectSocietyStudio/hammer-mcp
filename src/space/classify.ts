/**
 * Turning faces into floors, walls and ceilings -- and finding out which ones are real.
 *
 * A brush's faces are not all surfaces. A map is built by pushing boxes against each other,
 * so most of what a `.vmf` contains is buried: the underside of every floor slab, the back
 * of every wall, the whole of every brush inside a pillar. Counting those as floor area
 * gives a building with twice the floors it has, and the number looks perfectly ordinary.
 *
 * The test for "real" is the only honest one available without compiling: sample the face,
 * step a unit along its own normal, and ask whether that point is inside anything. A face
 * with open space in front of it is a surface; one with a brush there is a join. vbsp does
 * the same thing by a different route -- it merges and discards faces no leaf can see -- so
 * this is the same judgement, made earlier and cheaply.
 *
 * "Exposed" means **open space in front**, and that includes the outside of the map: the top
 * of a ceiling slab is an exposed floor, because it is the roof. Whether a surface is inside
 * the playable space is not a property of the face, and answering it here would mean guessing
 * -- `voxel.ts` decides it by flooding from a point a mapper guaranteed is inside.
 *
 * The sampling pays for itself twice. When a sample lands *inside* a brush, that brush is
 * recorded as the neighbour, and the map's **adjacency graph** falls out of the same pass:
 * which brush touches which, which nothing in this repository has ever known.
 *
 * ## The 0.7 is Source's, not a preference
 *
 * A face counts as a floor when its normal's z is at least 0.7. That is roughly `cos(45.6)`,
 * and it is the slope past which Source stops letting a player stand: it is the engine's
 * threshold, borrowed rather than invented, and the same number `FaceSelector.facing`
 * already uses.
 */
import { MASK_SOLID } from "./scene.js";
import type { Scene, SceneBrush, SceneFace } from "./scene.js";
import { pointInSolid } from "./trace.js";
import type { Vec3 } from "../vmf/solid.js";

/** Source's standable slope, and the threshold `FaceSelector.facing` already uses. */
export const FLOOR_COSINE = 0.7;

/** How far apart the probes on a face are, in Hammer units. */
const SAMPLE_STEP = 16;

/** How far along the normal a probe is pushed. One unit: enough to clear ON_EPSILON. */
const PROBE_OFFSET = 1;

/** A face is a surface when at least this much of it has open space in front. */
const EXPOSURE_THRESHOLD = 0.5;

export type SurfaceKind = "floor" | "ceiling" | "wall" | "slope";

export interface ClassifiedFace {
  brushId: number;
  sideId: number | null;
  material: string;
  kind: SurfaceKind;
  /** Fraction of probes that found open space. Below the threshold the face is buried. */
  exposure: number;
  exposed: boolean;
  area: number;
  normal: Vec3;
  /** Centre of the face, useful for saying where a finding is. */
  centre: Vec3;
  mins: Vec3;
  maxs: Vec3;
}

export interface Classification {
  faces: ClassifiedFace[];
  /** Brush id -> the brush ids found touching it. Symmetric by construction. */
  adjacency: Map<number, Set<number>>;
  /** Exposed area per kind, in square Hammer units. */
  areaByKind: Record<SurfaceKind, number>;
  /** Faces whose probes all landed in solid: interior joins, not surfaces. */
  buriedCount: number;
}

export function kindOf(normal: Vec3): SurfaceKind {
  if (normal[2] >= FLOOR_COSINE) return "floor";
  if (normal[2] <= -FLOOR_COSINE) return "ceiling";
  if (Math.abs(normal[2]) < 0.01) return "wall";
  return "slope";
}

const centroidOf = (loop: readonly Vec3[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of loop) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / loop.length, y / loop.length, z / loop.length];
};

/**
 * Points spread over a face, on a grid in the face's own plane.
 *
 * Built from two in-plane axes rather than by projecting onto a world plane, so a face at
 * any angle is sampled evenly. The centroid is always included: a face smaller than the
 * sample step would otherwise get no probes at all and be classified from nothing.
 */
function samplesOn(face: SceneFace): Vec3[] {
  const loop = face.loop;
  const centre = centroidOf(loop);
  const n = face.plane.normal;

  // Any vector not parallel to the normal gives a first axis.
  const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = seed[1] * n[2] - seed[2] * n[1];
  const uy = seed[2] * n[0] - seed[0] * n[2];
  const uz = seed[0] * n[1] - seed[1] * n[0];
  const ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-9) return [centre];
  const u: Vec3 = [ux / ul, uy / ul, uz / ul];
  const v: Vec3 = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];

  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  const uv = loop.map((p) => {
    const du = (p[0] - centre[0]) * u[0] + (p[1] - centre[1]) * u[1] + (p[2] - centre[2]) * u[2];
    const dv = (p[0] - centre[0]) * v[0] + (p[1] - centre[1]) * v[1] + (p[2] - centre[2]) * v[2];
    if (du < uMin) uMin = du;
    if (du > uMax) uMax = du;
    if (dv < vMin) vMin = dv;
    if (dv > vMax) vMax = dv;
    return [du, dv] as const;
  });

  const inside = (a: number, b: number): boolean => {
    // Convex, so "on the inner side of every edge" is the whole test. The winding is the
    // loop's own, so the sign is taken from the first edge rather than assumed.
    let sign = 0;
    for (let i = 0; i < uv.length; i++) {
      const p = uv[i]!;
      const q = uv[(i + 1) % uv.length]!;
      const cross = (q[0] - p[0]) * (b - p[1]) - (q[1] - p[1]) * (a - p[0]);
      if (Math.abs(cross) < 1e-9) continue;
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };

  const points: Vec3[] = [centre];
  for (let du = uMin; du <= uMax; du += SAMPLE_STEP) {
    for (let dv = vMin; dv <= vMax; dv += SAMPLE_STEP) {
      if (!inside(du, dv)) continue;
      points.push([
        centre[0] + u[0] * du + v[0] * dv,
        centre[1] + u[1] * du + v[1] * dv,
        centre[2] + u[2] * du + v[2] * dv,
      ]);
    }
  }
  return points;
}

function boundsOf(loop: readonly Vec3[]): { mins: Vec3; maxs: Vec3 } {
  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of loop) {
    for (let a = 0; a < 3; a++) {
      if (p[a]! < mins[a]!) mins[a] = p[a]!;
      if (p[a]! > maxs[a]!) maxs[a] = p[a]!;
    }
  }
  return { mins, maxs };
}

export function classify(scene: Scene, mask = MASK_SOLID): Classification {
  const faces: ClassifiedFace[] = [];
  const adjacency = new Map<number, Set<number>>();
  const areaByKind: Record<SurfaceKind, number> = { floor: 0, ceiling: 0, wall: 0, slope: 0 };
  let buried = 0;

  const touch = (a: number, b: number): void => {
    if (a === b) return;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };

  for (const brush of scene.brushes) {
    if ((brush.mask & mask) === 0) continue;
    for (const face of brush.faces) {
      if (face.loop.length < 3) continue;
      const n = face.plane.normal;
      const probes = samplesOn(face);
      let open = 0;
      for (const p of probes) {
        const at: Vec3 = [
          p[0] + n[0] * PROBE_OFFSET,
          p[1] + n[1] * PROBE_OFFSET,
          p[2] + n[2] * PROBE_OFFSET,
        ];
        const occupant = pointInSolid(scene, at, mask);
        if (occupant === null) open += 1;
        else touch(brush.id, occupant.id);
      }
      const exposure = probes.length > 0 ? open / probes.length : 0;
      const exposed = exposure >= EXPOSURE_THRESHOLD;
      if (!exposed) buried += 1;

      const kind = kindOf(n);
      if (exposed) areaByKind[kind] += face.area;

      faces.push({
        brushId: brush.id,
        sideId: face.sideId,
        material: face.material,
        kind,
        exposure: Math.round(exposure * 1000) / 1000,
        exposed,
        area: face.area,
        normal: n,
        centre: centroidOf(face.loop),
        ...boundsOf(face.loop),
      });
    }
  }

  return { faces, adjacency, areaByKind, buriedCount: buried };
}

export type { SceneBrush };
