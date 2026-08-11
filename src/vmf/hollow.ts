/**
 * Hollowing a brush: turning a solid block into the walls of a room.
 *
 * Hammer has this, and Hammer's version overlaps at the corners -- each wall spans its
 * whole face, so two adjacent walls both occupy the corner between them. That is a known
 * wart of the editor: overlapping world brushes are legal, they just cost faces vbsp has to
 * split and a seam that can z-fight. This one mitres instead, and the mitre falls out of
 * one observation rather than out of trigonometry.
 *
 * **The shell is the set of points closer to some face than to any other, within the
 * thickness.** Written down, "the point is nearer face i than face j" is
 *
 *     d_i - dot(n_i, x)  <=  d_j - dot(n_j, x)
 *
 * and rearranged that is `dot(n_j - n_i, x) <= d_j - d_i`, which is **a plane**. So the
 * region belonging to face i is an intersection of half-spaces like every other brush: the
 * original solid, one plane pulling it in to the thickness, and one plane per other face
 * saying "and not nearer that one". On a box those come out as the 45-degree mitres a
 * carpenter would cut, and no two walls share a cubic unit.
 *
 * Most of those constraints are redundant -- an opposite face never wins -- so the planes
 * that end up touching fewer than three corners are dropped before the brush is written.
 * Leaving them in would make every wall this tool produces report `redundant-side`.
 *
 * The oracle is exact and worth stating: the walls must sum to the volume of the original
 * solid minus the volume of the room inside it. Not approximately.
 */
import { textureAxesFor } from "./build.js";
import { VmfBuildError } from "./build.js";
import type { SolidSpec } from "./build.js";
import { hullFromPlanes, ON_EPSILON, orderedLoop } from "./solid.js";
import type { Plane, SolidCheck, Vec3 } from "./solid.js";

export interface HollowOptions {
  /** Wall thickness, in Hammer units. */
  thickness: number;
  /** `in` keeps the outer surface where it was; `out` keeps the inner surface. */
  direction?: "in" | "out";
}

export interface HollowWall {
  spec: SolidSpec;
  /** Material of the original face this wall belongs to. */
  material: string;
  volume: number;
}

export interface HollowResult {
  walls: HollowWall[];
  /** Volume the walls occupy, which must equal the outer volume less the inner one. */
  shellVolume: number;
  outerVolume: number;
  innerVolume: number;
  warnings: string[];
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function areaOf(vertices: readonly Vec3[], normal: Vec3): number {
  const loop = orderedLoop(vertices, normal);
  if (loop.length < 3) return 0;
  const c: Vec3 = [
    loop.reduce((s, v) => s + v[0], 0) / loop.length,
    loop.reduce((s, v) => s + v[1], 0) / loop.length,
    loop.reduce((s, v) => s + v[2], 0) / loop.length,
  ];
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = sub(loop[i]!, c);
    const b = sub(loop[(i + 1) % loop.length]!, c);
    area += dot(normal, [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]);
  }
  return Math.abs(area) / 2;
}

function volumeOf(planes: readonly Plane[], hull: readonly Vec3[]): number {
  let total = 0;
  for (const p of planes) {
    const face = hull.filter((v) => Math.abs(dot(p.normal, v) - p.dist) < ON_EPSILON);
    if (face.length < 3) continue;
    total += p.dist * areaOf(face, p.normal);
  }
  return total / 3;
}

/**
 * Turns one solid into the walls of a room.
 *
 * The source solid is not modified here: the caller decides whether to delete it, which
 * `hollow_solids` does, because a block left inside its own walls is a solid block.
 */
export function hollowSolid(check: SolidCheck, options: HollowOptions): HollowResult {
  const t = options.thickness;
  if (!Number.isFinite(t) || t <= 0) {
    throw new VmfBuildError(`wall thickness must be a positive number, not ${t}`);
  }
  const outward = options.direction === "out";

  const faces = check.sides
    .map((s) => ({ plane: s.plane, material: s.material }))
    .filter((f): f is { plane: Plane; material: string } => f.plane !== null);
  if (faces.length !== check.sides.length) {
    throw new VmfBuildError(`solid ${check.id} has a side with no readable plane`);
  }

  // Outward: the room stays where the solid is and the walls grow around it, so the outer
  // shell is the solid with every plane pushed out. Inward: the outer shell is the solid.
  const outer = faces.map((f) => ({
    normal: f.plane.normal,
    dist: outward ? f.plane.dist + t : f.plane.dist,
  }));
  const inner = faces.map((f) => ({
    normal: f.plane.normal,
    dist: outward ? f.plane.dist : f.plane.dist - t,
  }));

  const innerHull = hullFromPlanes(inner);
  const innerVolume = innerHull.length >= 4 ? volumeOf(inner, innerHull) : 0;
  const outerHull = hullFromPlanes(outer);
  const outerVolume = volumeOf(outer, outerHull);

  const warnings: string[] = [];
  if (innerVolume < ON_EPSILON) {
    throw new VmfBuildError(
      `walls ${t} units thick leave no room inside solid ${check.id}: the inner surfaces ` +
        `meet or cross. Use a thinner wall, or a larger brush.`,
    );
  }

  const walls: HollowWall[] = [];
  let shellVolume = 0;

  for (let i = 0; i < faces.length; i++) {
    const planes: Plane[] = [...outer];

    // Pull the wall in to its thickness: the half-space on the far side of the inner
    // surface, which is the original plane with its normal reversed.
    planes.push({
      normal: [-inner[i]!.normal[0], -inner[i]!.normal[1], -inner[i]!.normal[2]],
      dist: -inner[i]!.dist,
    });

    // And the mitres: one plane per other face, saying this point is not nearer that one.
    for (let j = 0; j < faces.length; j++) {
      if (j === i) continue;
      const n = sub(outer[j]!.normal, outer[i]!.normal);
      const len = Math.hypot(n[0], n[1], n[2]);
      // Two faces with the same normal -- which a badly built brush can have -- give no
      // constraint at all rather than a plane of zeroes.
      if (len < 1e-9) continue;
      planes.push({
        normal: [n[0] / len, n[1] / len, n[2] / len],
        dist: (outer[j]!.dist - outer[i]!.dist) / len,
      });
    }

    const hull = hullFromPlanes(planes);
    if (hull.length < 4) {
      warnings.push(
        `the wall for face ${i} of solid ${check.id} came out with no volume and was skipped`,
      );
      continue;
    }

    // Only the planes that really bound this wall become faces. Most mitres are redundant
    // -- an opposite face never wins -- and a plane touching fewer than three corners
    // would be a side with no face, which read_vmf_solids reports as redundant-side on
    // every wall this tool made.
    //
    // One filter, not two: an earlier version also filtered the plane list before building
    // the loops, and removing that filter turned no test red because the loop filter was
    // already doing the whole job. A line no sabotage can reach is a line that is not there.
    const loops = planes
      .map((p) => orderedLoop(
        hull.filter((v) => Math.abs(dot(p.normal, v) - p.dist) < ON_EPSILON),
        p.normal,
      ))
      .filter((loop) => loop.length >= 3);

    const volume = volumeOf(planes, hull);
    shellVolume += volume;
    walls.push({
      spec: { shape: "convex", faces: loops },
      material: faces[i]!.material,
      volume,
    });
  }

  return { walls, shellVolume, outerVolume, innerVolume, warnings };
}

/**
 * Matches a wall's face back to the source face it inherits its material from.
 *
 * Used as `materialForFace`: a wall's outward face keeps the material the original brush
 * had there, and the faces created by the hollowing -- the inner surface and the mitres --
 * get the caller's choice. Hollowing a brick room and getting brick on the inside as well
 * is what Hammer does and what a mapper then has to undo by hand.
 */
export function materialByNormal(
  faces: ReadonlyArray<{ normal: Vec3; material: string }>,
  fallback: string,
): (face: { normal: Vec3 }) => string {
  return (face) => {
    for (const f of faces) {
      if (dot(f.normal, face.normal) > 0.9999) return f.material;
    }
    return fallback;
  };
}

export { textureAxesFor };
