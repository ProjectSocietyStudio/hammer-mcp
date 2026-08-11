/**
 * Creating brush geometry in a `.vmf`.
 *
 * The head of `./edit.ts` refused this, and gave a reason worth keeping: a tool that
 * chooses planes and texture axes without a visual oracle produces maps that compile and
 * are wrong. That reasoning still holds. What changed is that the oracles now exist --
 * `./solid.ts` rebuilds the volume from the planes and checks it, vbsp refuses what it
 * cannot bound, a sealed room either boots or does not, and a human still has to look. So
 * the conclusion is dated, not the argument.
 *
 * ## Two things this file gets right by construction rather than by care
 *
 * **Winding.** Valve reads a side's three points clockwise seen from outside, and takes
 * the normal as `cross(p0 - p1, p2 - p1)`. Getting one face backwards on one shape is the
 * classic way to ship an open brush. Rather than hand-order every loop of every shape,
 * each face is wound against the solid's own centroid: if a face's normal points toward
 * the middle, the loop is reversed. That is exact for convex solids, which is all this
 * file makes, and it means a new shape cannot introduce a winding bug at all.
 *
 * **Texture axes.** This is where hand-rolled brush writers go wrong far more often than
 * on the planes, because the result compiles and only the eye catches it. The axes are not
 * invented here: `BASE_AXES` is vbsp's own `TextureAxisFromPlane` table. Pick the base
 * whose normal the face most agrees with, take that entry's u and v.
 *
 * The table is cross-checked, not trusted: `test/fixtures/gen_probe.py` writes its six box
 * faces by hand, and that file has been through a real compile and a real srcds boot.
 * **All six** of the table's branches reproduce its axes exactly -- measured, one normal at
 * a time, not read off by eye.
 *
 * So what a ramp or a prism reaches is not a seventh entry: there are only six, and every
 * one is confirmed. It is the *selection* that a box never exercises -- picking the closest
 * base for a normal that matches none of them exactly. That step is Valve's algorithm
 * rather than an extrapolation from the box case, and it is the part still owed a compile.
 *
 * One consequence worth stating rather than discovering: these are **world-aligned** axes,
 * Hammer's default for a new brush. On a steep slope a world-aligned texture stretches.
 * That is Source behaving as designed, not a defect here, and fixing it is a per-face
 * decision a human makes in Hammer.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock, KvNode } from "../kv/parse.js";
import { maxId } from "./edit.js";
import { planeFromPoints, WORLD_BOUND } from "./solid.js";
import type { Vec3 } from "./solid.js";

export class VmfBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfBuildError";
  }
}

/**
 * vbsp's `baseaxis[18]`, in triples of (normal, uaxis, vaxis).
 *
 * Order is vbsp's own: floor, ceiling, west, east, south, north. The winning entry is the
 * one whose normal has the greatest dot product with the face -- ties go to the earlier
 * entry, exactly as the compiler's loop does with a strict `>`.
 */
const BASE_AXES: ReadonlyArray<{ normal: Vec3; u: Vec3; v: Vec3 }> = [
  { normal: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] }, // floor
  { normal: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] }, // ceiling
  { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] }, // west wall
  { normal: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] }, // east wall
  { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // south wall
  { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] }, // north wall
];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The u and v axes vbsp would choose for a face with this normal. */
export function textureAxesFor(normal: Vec3): { u: Vec3; v: Vec3 } {
  let best = BASE_AXES[0]!;
  let bestDot = -Infinity;
  for (const base of BASE_AXES) {
    const d = dot(normal, base.normal);
    if (d > bestDot) {
      bestDot = d;
      best = base;
    }
  }
  return { u: best.u, v: best.v };
}

/** A shape, described the way someone building a room describes it. */
export type SolidSpec =
  | {
      shape: "box";
      mins: Vec3;
      maxs: Vec3;
      /**
       * Degrees to rotate about Z, around the box's own centre.
       *
       * This is how a diagonal brush is made, and a diagonal brush is how a mapper forces
       * vbsp to split the tree along something other than an axis. Corners are rounded to
       * whole units per column -- the four (x, y) pairs are rotated once and reused at both
       * heights -- so the vertical faces stay exactly planar instead of being rounded into
       * a twist that vbsp would then refuse.
       */
      rotateZ?: number;
    }
  | {
      /**
       * A ramp: a box whose top face slopes down to the floor along one axis.
       *
       * `slopeAxis` is the axis it climbs along, `high` says which end is tall.
       */
      shape: "wedge";
      mins: Vec3;
      maxs: Vec3;
      slopeAxis: "x" | "y";
      high: "min" | "max";
    }
  | {
      /** An n-sided prism inscribed in the bounding box, extruded along `axis`. */
      shape: "cylinder";
      mins: Vec3;
      maxs: Vec3;
      sides: number;
      axis?: "x" | "y" | "z";
    }
  | {
      /** The escape hatch: corners given outright, hull taken as their convex hull faces. */
      shape: "convex";
      faces: Vec3[][];
    };

export interface FaceInfo {
  normal: Vec3;
  area: number;
  /** Position among this solid's faces, 0-based. */
  index: number;
  /** Rank by area, 0 being the largest face of the solid. */
  areaRank: number;
}

export interface BuildOptions {
  material?: string;
  lightmapScale?: number;
  /** Texture scale on both axes. Hammer's default is 0.25. */
  textureScale?: number;
  /**
   * Material per face, overriding `material` when it returns a string.
   *
   * Exists for tool brushes, where the whole point is that one face differs from the rest:
   * a hint brush is SKIP everywhere except the plane vvis should cut along.
   */
  materialForFace?: (face: FaceInfo) => string | undefined;
}

interface Mesh {
  vertices: Vec3[];
  /** Index loops. Winding is fixed against the centroid afterwards, so order is free here. */
  faces: number[][];
}

function boxMesh(mins: Vec3, maxs: Vec3, rotateZ = 0): Mesh {
  const [x0, y0, z0] = mins;
  const [x1, y1, z1] = maxs;

  // The four ground-plan corners, rotated once and reused at both heights. Rotating all
  // eight independently and rounding each would leave the vertical faces very slightly
  // non-planar, which vbsp reports as a brush it cannot use.
  let plan: Array<[number, number]> = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  if (rotateZ % 360 !== 0) {
    const t = (rotateZ * Math.PI) / 180;
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    plan = plan.map(([x, y]) => [
      Math.round(cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t)),
      Math.round(cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)),
    ]);
  }

  return {
    vertices: [
      [plan[0]![0], plan[0]![1], z0], [plan[1]![0], plan[1]![1], z0],
      [plan[2]![0], plan[2]![1], z0], [plan[3]![0], plan[3]![1], z0],
      [plan[0]![0], plan[0]![1], z1], [plan[1]![0], plan[1]![1], z1],
      [plan[2]![0], plan[2]![1], z1], [plan[3]![0], plan[3]![1], z1],
    ],
    faces: [
      [4, 5, 6, 7], // +z
      [0, 1, 2, 3], // -z
      [0, 1, 5, 4], // -y
      [2, 3, 7, 6], // +y
      [0, 3, 7, 4], // -x
      [1, 2, 6, 5], // +x
    ],
  };
}

/**
 * A ramp: five faces, not a box with a collapsed edge.
 *
 * Written out rather than derived by squashing a box, because squashing leaves two corners
 * coincident and a degenerate quad where the short wall used to be. vbsp tolerates that and
 * the brush looks right in Hammer, so the mistake survives everything except a careful
 * look at the side count.
 */
function wedgeMesh(mins: Vec3, maxs: Vec3, slopeAxis: "x" | "y", high: "min" | "max"): Mesh {
  const a = slopeAxis === "x" ? 0 : 1;
  const b = a === 0 ? 1 : 0;
  const hi = high === "max" ? maxs[a] : mins[a];
  const lo = high === "max" ? mins[a] : maxs[a];

  const at = (along: number, across: number, z: number): Vec3 => {
    const p: [number, number, number] = [0, 0, 0];
    p[a] = along;
    p[b] = across;
    p[2] = z;
    return p;
  };

  return {
    vertices: [
      at(lo, mins[b], mins[2]), // 0
      at(hi, mins[b], mins[2]), // 1
      at(hi, maxs[b], mins[2]), // 2
      at(lo, maxs[b], mins[2]), // 3
      at(hi, mins[b], maxs[2]), // 4
      at(hi, maxs[b], maxs[2]), // 5
    ],
    faces: [
      [0, 1, 2, 3], // floor
      [0, 4, 5, 3], // the slope
      [1, 2, 5, 4], // the tall wall, at the `high` end
      [0, 1, 4], // triangular side
      [3, 5, 2], // the other one
    ],
  };
}

function cylinderMesh(mins: Vec3, maxs: Vec3, sides: number, axis: "x" | "y" | "z"): Mesh {
  if (!Number.isInteger(sides) || sides < 3 || sides > 64) {
    throw new VmfBuildError(`a cylinder needs between 3 and 64 sides, not ${sides}`);
  }
  const along = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const p = along === 0 ? 1 : 0;
  const q = along === 2 ? 1 : 2;

  const centre = [(mins[p] + maxs[p]) / 2, (mins[q] + maxs[q]) / 2];
  const radius = [(maxs[p] - mins[p]) / 2, (maxs[q] - mins[q]) / 2];

  const vertices: Vec3[] = [];
  for (const end of [mins[along], maxs[along]]) {
    for (let i = 0; i < sides; i++) {
      // Offset by half a step so an even-sided prism presents a flat face to an axis
      // rather than an edge -- which is what anyone building a pillar wants. Rounded to
      // whole units: off-grid corners are what produce the hairline cracks no log reports.
      const angle = (2 * Math.PI * i) / sides + Math.PI / sides;
      const point: [number, number, number] = [0, 0, 0];
      point[along] = end;
      point[p] = Math.round(centre[0]! + radius[0]! * Math.cos(angle));
      point[q] = Math.round(centre[1]! + radius[1]! * Math.sin(angle));
      vertices.push(point);
    }
  }

  const faces: number[][] = [
    Array.from({ length: sides }, (_, i) => i),
    Array.from({ length: sides }, (_, i) => sides + i),
  ];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    faces.push([i, j, sides + j, sides + i]);
  }
  return { vertices, faces };
}

function convexMesh(faces: Vec3[][]): Mesh {
  const vertices: Vec3[] = [];
  const indexOf = (v: Vec3): number => {
    const at = vertices.findIndex((w) => w[0] === v[0] && w[1] === v[1] && w[2] === v[2]);
    if (at >= 0) return at;
    vertices.push(v);
    return vertices.length - 1;
  };
  return { vertices, faces: faces.map((f) => f.map(indexOf)) };
}

function meshFor(spec: SolidSpec): Mesh {
  switch (spec.shape) {
    case "box":
      return boxMesh(spec.mins, spec.maxs, spec.rotateZ ?? 0);
    case "wedge":
      return wedgeMesh(spec.mins, spec.maxs, spec.slopeAxis, spec.high);
    case "cylinder":
      return cylinderMesh(spec.mins, spec.maxs, spec.sides, spec.axis ?? "z");
    case "convex":
      return convexMesh(spec.faces);
  }
}

function validateExtent(spec: SolidSpec): void {
  if (spec.shape === "convex") return;
  for (const axis of [0, 1, 2] as const) {
    if (spec.maxs[axis] <= spec.mins[axis]) {
      throw new VmfBuildError(
        `mins must be strictly below maxs on every axis; got ` +
          `mins=${spec.mins.join(" ")} maxs=${spec.maxs.join(" ")}`,
      );
    }
    for (const value of [spec.mins[axis], spec.maxs[axis]]) {
      if (Math.abs(value) > WORLD_BOUND) {
        throw new VmfBuildError(
          `${value} is outside the world, which runs -${WORLD_BOUND}..+${WORLD_BOUND} on ` +
            `each axis. (The often-quoted 32768 is the width of that range, not a bound.)`,
        );
      }
    }
  }
}

/** Area of a face given as an ordered loop. Shoelace, projected onto the face normal. */
function loopArea(loop: readonly Vec3[], normal: Vec3): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    const c: Vec3 = [
      p[1] * q[2] - p[2] * q[1],
      p[2] * q[0] - p[0] * q[2],
      p[0] * q[1] - p[1] * q[0],
    ];
    sum += dot(normal, c);
  }
  return Math.abs(sum) / 2;
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4))));
const vec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;

/**
 * Renders a spec as the text of one `solid` block, at one tab of indentation.
 *
 * `nextId` is the first id to use; Hammer numbers entities, solids, sides and editor nodes
 * from one counter, so reusing a number a brush side already holds makes the file
 * unopenable. Callers pass `maxId(...) + 1`.
 */
export function buildSolidText(spec: SolidSpec, nextId: number, options: BuildOptions = {}): {
  text: string;
  nextId: number;
} {
  validateExtent(spec);
  const mesh = meshFor(spec);
  const material = options.material ?? "TOOLS/TOOLSNODRAW";
  const lightmapScale = options.lightmapScale ?? 16;
  const scale = options.textureScale ?? 0.25;

  if (mesh.faces.length < 4) {
    throw new VmfBuildError(
      `this shape yields ${mesh.faces.length} faces; a closed volume needs at least four`,
    );
  }

  const centroid: Vec3 = [
    mesh.vertices.reduce((s, v) => s + v[0], 0) / mesh.vertices.length,
    mesh.vertices.reduce((s, v) => s + v[1], 0) / mesh.vertices.length,
    mesh.vertices.reduce((s, v) => s + v[2], 0) / mesh.vertices.length,
  ];

  // Two passes: every face is wound and measured first, so `materialForFace` can be told
  // how this face ranks by area. A tool brush is defined by one face differing from the
  // rest, and "the largest one" is how a mapper names it.
  const faces = mesh.faces.map((face, index) => {
    let loop = face.map((i) => {
      const v = mesh.vertices[i];
      if (!v) throw new VmfBuildError(`face refers to vertex ${i}, which does not exist`);
      return v;
    });

    let plane = planeFromPoints(loop[0]!, loop[1]!, loop[2]!);
    if (!plane) {
      throw new VmfBuildError(
        `a face of this shape has three collinear points, so it defines no plane`,
      );
    }
    // Wind it against the centroid: the outward normal must lead away from the middle.
    if (dot(plane.normal, sub(centroid, loop[0]!)) > 0) {
      loop = [...loop].reverse();
      plane = planeFromPoints(loop[0]!, loop[1]!, loop[2]!)!;
    }
    return { loop, plane, index, area: loopArea(loop, plane.normal) };
  });

  const byArea = [...faces].sort((a, b) => b.area - a.area);
  const rankOf = new Map(byArea.map((f, rank) => [f.index, rank]));

  let id = nextId;
  const solidId = id++;
  const sides: string[] = [];

  for (const { loop, plane, index, area } of faces) {
    const chosen =
      options.materialForFace?.({
        normal: plane.normal,
        area,
        index,
        areaRank: rankOf.get(index)!,
      }) ?? material;

    const { u, v } = textureAxesFor(plane.normal);
    sides.push(
      `\t\tside\n\t\t{\n` +
        `\t\t\t"id" "${id++}"\n` +
        `\t\t\t"plane" "(${vec(loop[0]!)}) (${vec(loop[1]!)}) (${vec(loop[2]!)})"\n` +
        `\t\t\t"material" "${chosen}"\n` +
        `\t\t\t"uaxis" "[${vec(u)} 0] ${scale}"\n` +
        `\t\t\t"vaxis" "[${vec(v)} 0] ${scale}"\n` +
        `\t\t\t"rotation" "0"\n` +
        `\t\t\t"lightmapscale" "${lightmapScale}"\n` +
        `\t\t\t"smoothing_groups" "0"\n` +
        `\t\t}\n`,
    );
  }

  const text =
    `\tsolid\n\t{\n\t\t"id" "${solidId}"\n` +
    sides.join("") +
    `\t\teditor\n\t\t{\n` +
    `\t\t\t"color" "0 180 220"\n` +
    `\t\t\t"visgroupshown" "1"\n` +
    `\t\t\t"visgroupautoshown" "1"\n` +
    `\t\t}\n\t}\n`;

  return { text, nextId: id };
}

export interface InsertResult {
  text: string;
  /** Ids of the solids created, in the order they were given. */
  solidIds: number[];
  /** Where each went: `world`, or the entity's classname. */
  target: string;
}

/**
 * Splices new solids into a VMF.
 *
 * Insertion only, at the end of the target block's body -- the same discipline as the rest
 * of the write path. Nothing outside the inserted range moves, so comments, blank lines
 * and whatever indentation the file already used come through byte-identical.
 */
export function insertSolids(
  source: string,
  specs: readonly SolidSpec[],
  options: BuildOptions & { entityId?: number } = {},
): InsertResult {
  if (specs.length === 0) throw new VmfBuildError("no solids to insert");

  const nodes: KvNode[] = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");

  let target: KvBlock | undefined;
  let targetName: string;
  if (options.entityId === undefined) {
    target = roots.find((b) => b.name === "world");
    targetName = "world";
    if (!target) throw new VmfBuildError("this file has no `world` block to add solids to");
  } else {
    target = roots.find(
      (b) =>
        b.name === "entity" &&
        b.entries.some((e) => e.kind === "pair" && e.key === "id" && e.value === String(options.entityId)),
    );
    if (!target) throw new VmfBuildError(`no entity with id ${options.entityId} in this file`);
    const cls = target.entries.find((e) => e.kind === "pair" && e.key === "classname");
    targetName = cls && cls.kind === "pair" ? cls.value : "entity";
  }

  let nextId = maxId(nodes) + 1;
  const solidIds: number[] = [];
  let body = "";
  for (const spec of specs) {
    solidIds.push(nextId);
    const built = buildSolidText(spec, nextId, options);
    body += built.text;
    nextId = built.nextId;
  }

  const at = target.bodyEnd;
  return {
    text: source.slice(0, at) + body + source.slice(at),
    solidIds,
    target: targetName,
  };
}
