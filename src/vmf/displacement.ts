/**
 * Reading displacements: the oracle, before anything writes one.
 *
 * A displacement replaces one face of a brush with a grid of vertices that can be pushed
 * off it. It is how Source makes terrain, and it is the largest thing this toolkit could
 * only *detect*: `solid.ts` has reported `hasDisplacement` since the beginning and nothing
 * has ever read what was in one.
 *
 * The format was taken from srctools' `vmf.py`, and the shape matters because almost every
 * count in it is off by one from its neighbour:
 *
 * - **`power` is 2, 3 or 4**, and the grid is `2^power + 1` on a side. A power of 3 is a
 *   9x9 grid of 81 vertices, not 8x8.
 * - **`normals`, `distances`, `offsets`, `offset_normals` and `alphas` have one row per
 *   grid row**, named `row0` upwards. The vector blocks hold three numbers per vertex on a
 *   row, the scalar ones hold one.
 * - **`triangle_tags` has one fewer row and column**, because a tag describes a quad rather
 *   than a vertex: `2^power` rows of `2 * 2^power` values.
 * - **`allowed_verts` is exactly ten int32s**, and srctools refuses any other count.
 *
 * The reason to reconstruct world positions here, rather than report the raw arrays, is
 * that everything worth asking about a displacement is a question about where its vertices
 * *are*: does it meet its neighbour, does it leave the brush it sits on, how far does the
 * terrain actually move. A caller handed six arrays of numbers has to do that work itself,
 * and would do it differently each time.
 *
 * What a vertex is: the face's own corners are interpolated to give a flat grid, the corner
 * nearest `startposition` decides which corner is (0, 0), and then each vertex moves along
 * its own `normal` by its own `distance`, plus a free `offset`. Getting the corner order
 * wrong turns a hillside upside down, which is why the corner is chosen by distance to
 * `startposition` rather than assumed.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { findSolids } from "./select.js";
import { checkVmfSolids, orderedLoop } from "./solid.js";
import type { SolidCheck, SolidSide, Vec3 } from "./solid.js";

export class VmfDisplacementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfDisplacementError";
  }
}

/** Powers Source accepts. Hammer's dialog offers 2, 3 and 4; the format allows 0 and 1. */
export const DISP_POWERS = [0, 1, 2, 3, 4] as const;

export interface DispVertex {
  x: number;
  y: number;
  /** Where the vertex ends up, in world units. */
  position: Vec3;
  /** Where it would be if nothing had moved it: the flat face, interpolated. */
  flat: Vec3;
  normal: Vec3;
  distance: number;
  offset: Vec3;
  /** 0 to 255. The blend between the material's two textures on a blend shader. */
  alpha: number;
}

export interface Displacement {
  solidId: number;
  owner: string;
  /** Index of the side within its solid, since a displaced side often has no id. */
  sideIndex: number;
  sideId: number | null;
  material: string;
  power: number;
  /** `2^power + 1`. The grid is this on a side. */
  size: number;
  startPosition: Vec3;
  elevation: number;
  subdiv: boolean;
  flags: number;
  vertices: DispVertex[];
  /** Corners of the face the grid is mapped onto, in the order the grid walks them. */
  corners: [Vec3, Vec3, Vec3, Vec3];
  /** How far the terrain moves: the extremes of `distance`. */
  minDistance: number;
  maxDistance: number;
  /** Vertices with a non-zero alpha, and the extremes. */
  alphaPainted: number;
  minAlpha: number;
  maxAlpha: number;
  findings: string[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dist2 = (a: Vec3, b: Vec3): number => {
  const d = sub(a, b);
  return d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
};

/** `[x y z]` or `x y z`, both of which appear in a `.vmf`. */
export function parseVec(text: string | undefined): Vec3 | null {
  if (text === undefined) return null;
  const nums = text.replace(/[[\]()]/g, " ").trim().split(/\s+/).map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
}

/**
 * Reads `rowN` from a block into a flat number array.
 *
 * A missing row is an empty one rather than an error: Hammer omits a row of zeroes in some
 * versions, and a displacement whose offsets are all zero is the normal case.
 */
function readRows(block: KvBlock | undefined, rows: number): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < rows; y += 1) {
    const raw = block ? get(block, `row${y}`) : undefined;
    if (raw === undefined) {
      out.push([]);
      continue;
    }
    out.push(raw.trim().length === 0 ? [] : raw.trim().split(/\s+/).map(Number));
  }
  return out;
}

/**
 * Orders a face's four corners so corner 0 is the one `startposition` names.
 *
 * Source walks the grid from that corner: (0,0) sits on it, x runs to the next corner and
 * y to the last. Assuming a fixed order instead turns a hillside upside down or mirrors
 * it, and nothing downstream reports either -- the map compiles and the terrain is wrong.
 */
function orderCorners(face: readonly Vec3[], start: Vec3, normal: Vec3): [Vec3, Vec3, Vec3, Vec3] | null {
  if (face.length !== 4) return null;
  const loop = orderedLoop(face, normal);
  if (loop.length !== 4) return null;
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const d = dist2(loop[i]!, start);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return [
    loop[best]!,
    loop[(best + 1) % 4]!,
    loop[(best + 2) % 4]!,
    loop[(best + 3) % 4]!,
  ];
}

/** Reads one `dispinfo` block, given the face it sits on. */
export function readDisplacement(
  block: KvBlock,
  side: SolidSide,
  solidId: number,
  owner: string,
  sideIndex: number,
): Displacement {
  const findings: string[] = [];
  const powerRaw = get(block, "power");
  const power = powerRaw !== undefined ? Number(powerRaw) : 4;
  if (!DISP_POWERS.includes(power as (typeof DISP_POWERS)[number])) {
    throw new VmfDisplacementError(
      `displacement power ${powerRaw} is not one Source accepts; it must be 0 to 4`,
    );
  }
  const size = 2 ** power + 1;

  const startPosition = parseVec(get(block, "startposition")) ?? [0, 0, 0];
  const elevation = Number(get(block, "elevation") ?? 0);
  const subdiv = get(block, "subdiv") === "1";
  const flags = Number(get(block, "flags") ?? 0);

  const normals = readRows(children(block, "normals")[0], size);
  const distances = readRows(children(block, "distances")[0], size);
  const offsets = readRows(children(block, "offsets")[0], size);
  const alphas = readRows(children(block, "alphas")[0], size);

  // The grid is mapped onto the face's own corners. Without them there is nothing to
  // interpolate, and the vertex positions would be a guess presented as a measurement.
  const corners =
    side.plane && side.vertices.length === 4
      ? orderCorners(side.vertices, startPosition, side.plane.normal)
      : null;
  if (!corners) {
    findings.push(
      `the face under this displacement has ${side.vertices.length} corners rather than 4, ` +
        `so its vertices cannot be placed. Source only displaces quadrilateral faces.`,
    );
  }

  const vertices: DispVertex[] = [];
  let minDistance = Infinity;
  let maxDistance = -Infinity;
  let minAlpha = Infinity;
  let maxAlpha = -Infinity;
  let painted = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const normal: Vec3 = [
        normals[y]?.[x * 3] ?? 0,
        normals[y]?.[x * 3 + 1] ?? 0,
        normals[y]?.[x * 3 + 2] ?? 0,
      ];
      const offset: Vec3 = [
        offsets[y]?.[x * 3] ?? 0,
        offsets[y]?.[x * 3 + 1] ?? 0,
        offsets[y]?.[x * 3 + 2] ?? 0,
      ];
      const distance = distances[y]?.[x] ?? 0;
      const alpha = alphas[y]?.[x] ?? 0;

      // Bilinear across the quad: u runs from corner 0 to corner 1, v from corner 0 to
      // corner 3, which is the order Source walks after startposition picks corner 0.
      let flat: Vec3 = [0, 0, 0];
      if (corners) {
        const u = x / (size - 1);
        const v = y / (size - 1);
        const top = add(scale(corners[0], 1 - u), scale(corners[1], u));
        const bottom = add(scale(corners[3], 1 - u), scale(corners[2], u));
        flat = add(scale(top, 1 - v), scale(bottom, v));
      }
      const position = add(add(flat, scale(normal, distance)), offset);

      if (distance < minDistance) minDistance = distance;
      if (distance > maxDistance) maxDistance = distance;
      if (alpha < minAlpha) minAlpha = alpha;
      if (alpha > maxAlpha) maxAlpha = alpha;
      if (alpha > 0) painted += 1;

      vertices.push({ x, y, position, flat, normal, distance, offset, alpha });
    }
  }

  // Every row that is there must be the right length. A short row is not a Hammer file:
  // it is a hand edit or a generator, and reading past its end would report zeroes as
  // measurements.
  for (const [name, rows, perVertex] of [
    ["normals", normals, 3],
    ["distances", distances, 1],
    ["offsets", offsets, 3],
    ["alphas", alphas, 1],
  ] as const) {
    for (let y = 0; y < size; y += 1) {
      const row = rows[y]!;
      if (row.length === 0) continue;
      if (row.length !== size * perVertex) {
        findings.push(
          `${name} row ${y} has ${row.length} numbers where a power-${power} displacement ` +
            `needs ${size * perVertex}. The rest were read as zero.`,
        );
      }
      if (row.some((n) => !Number.isFinite(n))) {
        findings.push(`${name} row ${y} contains a value that is not a number`);
      }
    }
  }

  const tags = children(block, "triangle_tags")[0];
  if (tags) {
    const tagRows = readRows(tags, 2 ** power);
    for (let y = 0; y < 2 ** power; y += 1) {
      const row = tagRows[y]!;
      if (row.length !== 0 && row.length !== 2 * 2 ** power) {
        findings.push(
          `triangle_tags row ${y} has ${row.length} values where a power-${power} ` +
            `displacement needs ${2 * 2 ** power}: a tag describes a quad, so there is one ` +
            `fewer row and column than there are vertices.`,
        );
      }
    }
  }

  const allowed = children(block, "allowed_verts")[0];
  if (allowed) {
    const ten = get(allowed, "10");
    if (ten !== undefined && ten.trim().split(/\s+/).length !== 10) {
      findings.push(
        `allowed_verts must be exactly ten numbers; this one has ` +
          `${ten.trim().split(/\s+/).length}`,
      );
    }
  }

  return {
    solidId,
    owner,
    sideIndex,
    sideId: side.id,
    material: side.material,
    power,
    size,
    startPosition,
    elevation,
    subdiv,
    flags,
    vertices,
    corners: corners ?? [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    minDistance: Number.isFinite(minDistance) ? minDistance : 0,
    maxDistance: Number.isFinite(maxDistance) ? maxDistance : 0,
    alphaPainted: painted,
    minAlpha: Number.isFinite(minAlpha) ? minAlpha : 0,
    maxAlpha: Number.isFinite(maxAlpha) ? maxAlpha : 0,
    findings,
  };
}

export interface Seam {
  /** The two displacements that should meet, by solid id. */
  between: [number, number];
  /** Worst gap between vertices that ought to coincide, in units. */
  worstGap: number;
  /** How many pairs sit on the same flat point and not on the same displaced one. */
  openPairs: number;
}

/**
 * Finds edges where two displacements should meet and do not.
 *
 * This is the measurement `sew` will be judged by, and it is worth having before anything
 * can sew: a seam is invisible in the editor until you stand on it, and the crack a player
 * falls through is the same shape as the crack that is merely ugly.
 *
 * Two vertices are meant to coincide when their *undisplaced* positions do: the faces
 * share that point, whatever either displacement has since done to it. The gap is then
 * measured on the displaced positions. Deciding adjacency on the displaced grid instead --
 * the first version here -- cannot work, because the worse a seam is the further apart its
 * vertices are and the less likely they are to be recognised as a pair at all.
 */
export function findSeams(
  displacements: readonly Displacement[],
  tolerance = 0.1,
): Seam[] {
  const seams: Seam[] = [];
  for (let i = 0; i < displacements.length; i += 1) {
    for (let j = i + 1; j < displacements.length; j += 1) {
      const a = displacements[i]!;
      const b = displacements[j]!;
      let worst = 0;
      let open = 0;
      let shared = 0;

      // Adjacency is decided on the *flat* grid and the gap is measured on the displaced
      // one. Deciding both on the displaced grid was the first version and it cannot
      // work: two vertices that have been pulled apart are no longer near each other, so
      // the worse the seam the less likely it was to be found at all. A 64-unit gap
      // reported as no seam is exactly the crack a player falls through.
      for (const va of a.vertices) {
        for (const vb of b.vertices) {
          if (dist2(va.flat, vb.flat) > tolerance * tolerance) continue;
          shared += 1;
          const gap = Math.sqrt(dist2(va.position, vb.position));
          if (gap > tolerance) {
            open += 1;
            if (gap > worst) worst = gap;
          }
        }
      }
      if (shared > 0 && open > 0) {
        seams.push({ between: [a.solidId, b.solidId], worstGap: worst, openPairs: open });
      }
    }
  }
  return seams;
}

/** Every displacement in a `.vmf`, with the face each one sits on. */
export function readDisplacements(source: string): {
  displacements: Displacement[];
  seams: Seam[];
  warnings: string[];
} {
  const report = checkVmfSolids("(memory)", source);
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const found = findSolids(roots);
  const byId = new Map<number, SolidCheck>();
  for (const s of report.solids) if (s.id !== null) byId.set(s.id, s);

  const displacements: Displacement[] = [];
  const warnings: string[] = [];

  for (const solid of found) {
    const check = byId.get(solid.id);
    if (!check) continue;
    const sideBlocks = solid.block.entries.filter(
      (n): n is KvBlock => n.kind === "block" && n.name === "side",
    );
    for (let i = 0; i < sideBlocks.length; i += 1) {
      const disp = children(sideBlocks[i]!, "dispinfo")[0];
      if (!disp) continue;
      const side = check.sides[i];
      if (!side) {
        warnings.push(
          `solid ${solid.id} has a displacement on side ${i}, which the reader could not ` +
            `measure; its vertices were not placed`,
        );
        continue;
      }
      displacements.push(readDisplacement(disp, side, solid.id, solid.owner, i));
    }
  }

  // A displaced brush does not seal a map. vbsp builds the hull from the brush's own
  // planes and the displacement is drawn on top, so a wall turned into terrain leaks
  // through the shape the terrain no longer has -- and the leak names a brush that looks
  // perfectly solid in the editor.
  const displacedSolids = new Set(displacements.map((d) => d.solidId));
  const worldDisplaced = [...displacedSolids].filter((id) => byId.get(id)?.owner === "world");
  if (worldDisplaced.length > 0) {
    warnings.push(
      `${worldDisplaced.length} world brush(es) carry a displacement. A displacement does ` +
        `not seal: vbsp builds the hull from the brush's own planes and draws the terrain ` +
        `over it, so if one of these is part of the map's shell the next compile leaks.`,
    );
  }

  return { displacements, seams: findSeams(displacements), warnings };
}
