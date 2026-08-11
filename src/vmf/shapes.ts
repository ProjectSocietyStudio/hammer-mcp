/**
 * The primitives Hammer's block tool has and `write_vmf_solid` did not: arch, sphere,
 * torus, cone, stairs.
 *
 * All five are **compound**: they are several brushes, not one. A sphere is not a convex
 * solid at any useful resolution and a staircase never was, so each of these expands into a
 * list of `convex` specs that `insertSolids` writes one after another. That is why the tool
 * reports how many brushes it made -- a 16-sided sphere with 8 stacks is 8 brushes, and a
 * mapper who asks for one without knowing that has just spent a third of a visleaf budget.
 *
 * One shared idea underneath: **a band between two rings of points**. A cone is a ring and
 * an apex, a sphere is a stack of rings, a torus is rings around a circle, an arch is a
 * rectangle swept through an angle. Writing that once means the winding, the degenerate
 * cases and the rounding are settled once too.
 *
 * Every ring is rounded to whole units, for the same reason `cylinderMesh` already is:
 * off-grid corners are what produce the hairline cracks no compile log reports.
 */
import { VmfBuildError } from "./build.js";
import type { SolidSpec } from "./build.js";
import type { Vec3 } from "./solid.js";

/** How many brushes a shape may expand into before it is a mistake rather than a shape. */
export const MAX_PIECES = 256;

const round = (v: Vec3): Vec3 => [Math.round(v[0]) + 0, Math.round(v[1]) + 0, Math.round(v[2]) + 0];

const same = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Face loops of the solid between two rings of points.
 *
 * `top` may be a single point, which makes a cone rather than a frustum.
 *
 * Rings are required to have no repeated corner, which `ring` enforces. An earlier version
 * tried instead to reduce a degenerate quad to a triangle, and that is not enough: three
 * rounded points can still be collinear, and the triangle then defines no plane at all. A
 * shape whose corners merge is not a shape that can be salvaged, so it is refused where it
 * is built rather than patched here.
 */
function band(bottom: readonly Vec3[], top: readonly Vec3[]): Vec3[][] {
  const n = bottom.length;
  const faces: Vec3[][] = [];
  if (bottom.length >= 3) faces.push([...bottom]);
  if (top.length >= 3) faces.push([...top]);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (top.length === 1) {
      faces.push([bottom[i]!, bottom[j]!, top[0]!]);
      continue;
    }
    faces.push([bottom[i]!, bottom[j]!, top[j]!, top[i]!]);
  }
  return faces;
}

/** A regular polygon in the plane perpendicular to `along`, at coordinate `at`. */
function ring(
  centre: readonly [number, number],
  radius: readonly [number, number],
  sides: number,
  along: 0 | 1 | 2,
  at: number,
  offsetHalfStep: boolean,
  startAngle = 0,
  sweep = 2 * Math.PI,
): Vec3[] {
  const p = along === 0 ? 1 : 0;
  const q = along === 2 ? 1 : 2;
  const out: Vec3[] = [];
  const closed = Math.abs(sweep - 2 * Math.PI) < 1e-9;
  const steps = closed ? sides : sides + 1;
  for (let i = 0; i < steps; i++) {
    const t = closed
      ? (sweep * i) / sides + (offsetHalfStep ? Math.PI / sides : 0)
      : startAngle + (sweep * i) / sides;
    const point: [number, number, number] = [0, 0, 0];
    point[along] = at;
    point[p] = centre[0] + radius[0] * Math.cos(t);
    point[q] = centre[1] + radius[1] * Math.sin(t);
    out.push(round(point));
  }

  // Two corners landing on the same whole unit means the shape is finer than the grid it
  // has to live on. Every face touching such a pair is degenerate, and vbsp accepts a
  // degenerate face without saying so -- the brush compiles and is wrong. Refusing names
  // the two numbers that are in conflict, which is what a caller can act on.
  for (let i = 0; i < out.length; i++) {
    const j = (i + 1) % out.length;
    if (same(out[i]!, out[j]!)) {
      throw new VmfBuildError(
        `a ring of radius ${Math.round(Math.max(radius[0], radius[1]))} with ${sides} sides ` +
          `puts two corners on the same whole unit. Brush corners land on the grid, so a ` +
          `shape this small needs fewer sides, or a larger radius.`,
      );
    }
  }
  return out;
}

const axisIndex = (axis: "x" | "y" | "z"): 0 | 1 | 2 =>
  axis === "x" ? 0 : axis === "y" ? 1 : 2;

export interface ConeSpec {
  shape: "cone";
  mins: Vec3;
  maxs: Vec3;
  sides: number;
  axis?: "x" | "y" | "z";
}

export interface StairsSpec {
  shape: "stairs";
  mins: Vec3;
  maxs: Vec3;
  steps: number;
  /** Which way the flight climbs. */
  direction: "+x" | "-x" | "+y" | "-y";
}

export interface ArchSpec {
  shape: "arch";
  /** Centre of the arc, at the base of the arch. */
  centre: Vec3;
  innerRadius: number;
  outerRadius: number;
  height: number;
  /** How far round it goes. 180 is a doorway arch, 360 a ring. */
  arcDegrees: number;
  segments: number;
  startDegrees?: number;
}

export interface SphereSpec {
  shape: "sphere";
  centre: Vec3;
  radius: number;
  /** Faces around the equator. */
  sides: number;
  /** Bands from pole to pole. Each one is a brush. */
  stacks: number;
}

export interface TorusSpec {
  shape: "torus";
  centre: Vec3;
  /** Distance from the centre of the ring to the centre of the tube. */
  majorRadius: number;
  /** Radius of the tube itself. */
  minorRadius: number;
  /** Segments around the ring. Each one is a brush. */
  majorSegments: number;
  /** Faces around the tube. */
  minorSides: number;
}

export type CompoundSpec = ConeSpec | StairsSpec | ArchSpec | SphereSpec | TorusSpec;

export interface Expansion {
  specs: SolidSpec[];
  /** What a caller should know before writing this, in its own words. */
  notes: string[];
}

function cone(spec: ConeSpec): Expansion {
  if (!Number.isInteger(spec.sides) || spec.sides < 3 || spec.sides > 64) {
    throw new VmfBuildError(`a cone needs between 3 and 64 sides, not ${spec.sides}`);
  }
  const along = axisIndex(spec.axis ?? "z");
  const p = along === 0 ? 1 : 0;
  const q = along === 2 ? 1 : 2;
  const centre: [number, number] = [
    (spec.mins[p]! + spec.maxs[p]!) / 2,
    (spec.mins[q]! + spec.maxs[q]!) / 2,
  ];
  const radius: [number, number] = [
    (spec.maxs[p]! - spec.mins[p]!) / 2,
    (spec.maxs[q]! - spec.mins[q]!) / 2,
  ];
  const base = ring(centre, radius, spec.sides, along, spec.mins[along]!, true);
  const apexRaw: [number, number, number] = [0, 0, 0];
  apexRaw[along] = spec.maxs[along]!;
  apexRaw[p] = Math.round(centre[0]);
  apexRaw[q] = Math.round(centre[1]);
  const apex: Vec3 = apexRaw;

  return {
    specs: [{ shape: "convex", faces: band(base, [apex]) }],
    notes: [
      "a cone is one brush, and every one of its sloped faces is a plane vvis has to " +
        "consider. Make it func_detail unless it is holding part of the hull.",
    ],
  };
}

function stairs(spec: StairsSpec): Expansion {
  if (!Number.isInteger(spec.steps) || spec.steps < 1 || spec.steps > MAX_PIECES) {
    throw new VmfBuildError(`a flight needs between 1 and ${MAX_PIECES} steps, not ${spec.steps}`);
  }
  const along = spec.direction.endsWith("x") ? 0 : 1;
  const ascending = spec.direction.startsWith("+");
  const run = (spec.maxs[along]! - spec.mins[along]!) / spec.steps;
  const rise = (spec.maxs[2] - spec.mins[2]) / spec.steps;

  const specs: SolidSpec[] = [];
  for (let i = 0; i < spec.steps; i++) {
    const mins: [number, number, number] = [spec.mins[0], spec.mins[1], spec.mins[2]];
    const maxs: [number, number, number] = [spec.maxs[0], spec.maxs[1], spec.maxs[2]];
    // Each step spans the whole flight from the bottom, so the treads sit on solid brush
    // rather than floating -- which is what a player's collision hull needs underneath it.
    const lo = spec.mins[along]! + run * i;
    const hi = spec.mins[along]! + run * (i + 1);
    mins[along] = Math.round(ascending ? lo : spec.mins[along]! + run * (spec.steps - i - 1));
    maxs[along] = Math.round(ascending ? hi : spec.mins[along]! + run * (spec.steps - i));
    maxs[2] = Math.round(spec.mins[2] + rise * (i + 1));
    specs.push({ shape: "box", mins, maxs });
  }

  const notes = [
    `${spec.steps} brushes, one per step. Each spans the full height from the bottom, so ` +
      `nothing floats.`,
  ];
  if (rise > 18) {
    notes.push(
      `each step rises ${Math.round(rise)} units. A Half-Life 2 player climbs at most 18 ` +
        `without jumping, so this flight is not walkable.`,
    );
  }
  return { specs, notes };
}

function arch(spec: ArchSpec): Expansion {
  if (!Number.isInteger(spec.segments) || spec.segments < 1 || spec.segments > MAX_PIECES) {
    throw new VmfBuildError(
      `an arch needs between 1 and ${MAX_PIECES} segments, not ${spec.segments}`,
    );
  }
  if (spec.innerRadius >= spec.outerRadius) {
    throw new VmfBuildError("an arch's inner radius must be smaller than its outer radius");
  }
  // These three are refused here rather than downstream. buildSolidText already catches
  // them -- a degenerate shape has collinear points and it says so -- but "a face of this
  // shape has three collinear points" does not tell a caller that their arch spans zero
  // degrees. A refusal is worth as much as the input it names.
  if (spec.arcDegrees === 0) {
    throw new VmfBuildError("an arch of zero degrees spans nothing");
  }
  if (spec.height <= 0) {
    throw new VmfBuildError(`an arch needs a positive height, not ${spec.height}`);
  }
  const start = ((spec.startDegrees ?? 0) * Math.PI) / 180;
  const sweep = (spec.arcDegrees * Math.PI) / 180;
  const step = sweep / spec.segments;
  // A segment is a quadrilateral through four corners, so past a quarter turn it stops
  // describing the sector it was asked for and starts describing the complement: a
  // 270-degree arch in one segment came out as the 90-degree wedge between its ends, and
  // the independent checker accepted it because that wedge is a perfectly valid brush.
  //
  // This used to be a note claiming the shape "was refused" while the specs were returned
  // anyway. A tool that says it refused something and did not is worse than one that
  // simply got the geometry wrong, because the output cannot be trusted to report itself.
  //
  // Compared in absolute value: a negative arcDegrees is how a clockwise arch is written,
  // and the first version of this check tested the signed step, so `arcDegrees: -270` with
  // one segment sailed past it and built the very wedge the check exists to prevent.
  if (Math.abs(step) > Math.PI / 2 + 1e-9) {
    throw new VmfBuildError(
      `each segment would span ${Math.round(Math.abs((step * 180) / Math.PI))} degrees, and ` +
        `past a quarter turn a four-cornered segment describes the complement of the sector ` +
        `rather than the sector. Use at least ` +
        `${Math.ceil(Math.abs(spec.arcDegrees) / 90)} segments.`,
    );
  }
  const [cx, cy, cz] = spec.centre;

  const at = (angle: number, r: number, z: number): Vec3 =>
    round([cx + r * Math.cos(angle), cy + r * Math.sin(angle), z]);

  const specs: SolidSpec[] = [];
  for (let i = 0; i < spec.segments; i++) {
    const a0 = start + step * i;
    const a1 = start + step * (i + 1);
    // Each segment is a rectangle in the radial-vertical plane, swept through one step.
    const bottom = [
      at(a0, spec.innerRadius, cz),
      at(a0, spec.outerRadius, cz),
      at(a1, spec.outerRadius, cz),
      at(a1, spec.innerRadius, cz),
    ];
    const top = bottom.map((v): Vec3 => [v[0], v[1], cz + spec.height]);
    specs.push({ shape: "convex", faces: band(bottom, top) });
  }

  return {
    specs,
    notes: [
      `${spec.segments} brushes. An arch is a ring of wedges, and every joint between two ` +
        `of them is a plane in the tree -- make them func_detail unless the arch is part ` +
        `of the hull.`,
    ],
  };
}

function sphere(spec: SphereSpec): Expansion {
  if (!Number.isInteger(spec.sides) || spec.sides < 3 || spec.sides > 64) {
    throw new VmfBuildError(`a sphere needs between 3 and 64 sides, not ${spec.sides}`);
  }
  if (!Number.isInteger(spec.stacks) || spec.stacks < 2 || spec.stacks > 32) {
    throw new VmfBuildError(`a sphere needs between 2 and 32 stacks, not ${spec.stacks}`);
  }
  if (spec.radius <= 0) {
    throw new VmfBuildError(`a sphere needs a positive radius, not ${spec.radius}`);
  }
  const [cx, cy, cz] = spec.centre;
  const specs: SolidSpec[] = [];

  // A stack of frusta rather than a shell: each band is convex on its own, which a curved
  // shell segment is not. The result is a solid ball, which is what a brush sphere is.
  for (let s = 0; s < spec.stacks; s++) {
    const phi0 = Math.PI * (s / spec.stacks) - Math.PI / 2;
    const phi1 = Math.PI * ((s + 1) / spec.stacks) - Math.PI / 2;
    const z0 = cz + spec.radius * Math.sin(phi0);
    const z1 = cz + spec.radius * Math.sin(phi1);
    const r0 = spec.radius * Math.cos(phi0);
    const r1 = spec.radius * Math.cos(phi1);

    const bottom =
      r0 < 0.5
        ? [round([cx, cy, z0])]
        : ring([cx, cy], [r0, r0], spec.sides, 2, Math.round(z0), true);
    const top =
      r1 < 0.5
        ? [round([cx, cy, z1])]
        : ring([cx, cy], [r1, r1], spec.sides, 2, Math.round(z1), true);

    // Both ends a point means a sphere too small to have a middle.
    if (bottom.length === 1 && top.length === 1) continue;
    const faces = bottom.length === 1 ? band(top, bottom) : band(bottom, top);
    specs.push({ shape: "convex", faces });
  }

  if (specs.length === 0) {
    throw new VmfBuildError(
      `a sphere of radius ${spec.radius} rounds away to nothing at ${spec.stacks} stacks`,
    );
  }
  return {
    specs,
    notes: [
      `${specs.length} brushes, one per stack. A brush sphere is expensive in every budget ` +
        `a map has -- faces, planes and visleaves. A prop_static of a sphere costs one edict ` +
        `and nothing else, and is the right answer unless players have to walk on it.`,
    ],
  };
}

function torus(spec: TorusSpec): Expansion {
  if (!Number.isInteger(spec.majorSegments) || spec.majorSegments < 3 || spec.majorSegments > 64) {
    throw new VmfBuildError(
      `a torus needs between 3 and 64 segments, not ${spec.majorSegments}`,
    );
  }
  if (!Number.isInteger(spec.minorSides) || spec.minorSides < 3 || spec.minorSides > 32) {
    throw new VmfBuildError(`a torus tube needs between 3 and 32 sides, not ${spec.minorSides}`);
  }
  if (spec.minorRadius <= 0) {
    throw new VmfBuildError(`a torus needs a tube with a radius, not ${spec.minorRadius}`);
  }
  if (spec.minorRadius >= spec.majorRadius) {
    throw new VmfBuildError(
      "a torus whose tube is as wide as its ring has no hole, and its segments stop being convex",
    );
  }
  const [cx, cy, cz] = spec.centre;
  const step = (2 * Math.PI) / spec.majorSegments;

  /** The tube's cross-section at one angle round the ring. */
  const section = (theta: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < spec.minorSides; i++) {
      const phi = (2 * Math.PI * i) / spec.minorSides + Math.PI / spec.minorSides;
      const r = spec.majorRadius + spec.minorRadius * Math.cos(phi);
      out.push(
        round([cx + r * Math.cos(theta), cy + r * Math.sin(theta), cz + spec.minorRadius * Math.sin(phi)]),
      );
    }
    return out;
  };

  const specs: SolidSpec[] = [];
  for (let i = 0; i < spec.majorSegments; i++) {
    specs.push({ shape: "convex", faces: band(section(step * i), section(step * (i + 1))) });
  }
  return {
    specs,
    notes: [
      `${spec.majorSegments} brushes, one per segment of the ring. Every joint is a plane ` +
        `in the tree; a torus is almost always better as a prop.`,
    ],
  };
}

/** Turns a compound shape into the convex brushes that make it up. */
export function expandShape(spec: CompoundSpec): Expansion {
  switch (spec.shape) {
    case "cone":
      return cone(spec);
    case "stairs":
      return stairs(spec);
    case "arch":
      return arch(spec);
    case "sphere":
      return sphere(spec);
    case "torus":
      return torus(spec);
  }
}
