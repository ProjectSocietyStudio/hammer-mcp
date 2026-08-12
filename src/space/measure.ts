/**
 * Measuring a place, rather than describing it.
 *
 * Every number in this file follows one pattern, and the pattern is what makes it exact:
 * **the voxel localises, the swept hull measures.** The clearance field says *where* the
 * narrow point of a corridor is, to within a cell -- sixteen units, which is plenty to find
 * a place and useless as an answer. The swept box then measures *there*, against the real
 * planes, to a thirty-second of a unit.
 *
 * Skipping the second half is the mistake this file exists to avoid. The fixture's 96-unit
 * corridor is six cells wide; reporting `6 x 16` gives 96 by luck. Make it 100 units and the
 * voxel answer is still 96, and nothing about it looks approximate.
 *
 * Skipping the first half is worse: without somewhere to measure, "how wide is this corridor"
 * has no defined answer at all, because a corridor is wide in one direction and long in
 * another and the question is about the narrow one.
 *
 * ## Every measurement here has an operative definition
 *
 * Not an intention. "Enough room to get past" is an intention; "the distance a 32x32x72 box
 * can travel from this point along this axis before it touches something" is a measurement,
 * and two people who run it get the same number.
 */
import { HULL_CROUCHING, HULL_STANDING, MASK_PLAYER, MASK_SOLID } from "./scene.js";
import type { Scene } from "./scene.js";
import { DIST_EPSILON, nearestSurface, traceRay } from "./trace.js";
import type { Vec3 } from "../vmf/solid.js";

/** Source's own step height: a player climbs 18 units without jumping. */
export const STEP_HEIGHT = 18;

/** How far a probe may look before giving up. Half the world, so nothing real is cut off. */
const REACH = 16384;

export interface Sweep {
  /** How far the box got, in units. */
  distance: number;
  /** What stopped it, or null if nothing did within `reach`. */
  brushId: number | null;
  material: string | null;
  /** Where the box's centre ended up. */
  at: Vec3;
  /** True when the probe ran out of reach rather than hitting anything. */
  unbounded: boolean;
}

/**
 * How far a player-sized box travels from a point along a direction.
 *
 * The half-extents are the whole point: a ray reports a doorway as passable when the frame is
 * 24 units apart, and the number reads perfectly reasonable.
 */
export function sweep(
  scene: Scene,
  from: Vec3,
  direction: Vec3,
  half: Vec3,
  mask = MASK_PLAYER,
  reach = REACH,
): Sweep {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-9) {
    return { distance: 0, brushId: null, material: null, at: from, unbounded: false };
  }
  const to: Vec3 = [
    from[0] + (direction[0] / length) * reach,
    from[1] + (direction[1] / length) * reach,
    from[2] + (direction[2] / length) * reach,
  ];
  const t = traceRay(scene, from, to, mask, half);

  // The tracer backs every contact off by DIST_EPSILON so a point left there is outside the
  // brush. That is right for a tracer and wrong for a measurement: it makes every distance
  // short, and a width -- two sweeps -- short by twice that. The fixture's 256-unit corridor
  // came out at 255.9375, which is close enough to read as rounding and is in fact a
  // systematic bias.
  //
  // The nudge is applied along the plane's normal, so its cost along the direction of travel
  // is DIST_EPSILON / |n . d| -- bigger for a glancing hit, and equal to DIST_EPSILON only
  // when the sweep runs straight into the face. Adding back a flat epsilon would fix the
  // axis-aligned case and leave every oblique one wrong.
  let distance = t.startSolid ? 0 : t.fraction * reach;
  if (t.hit && !t.startSolid && t.normal) {
    const along = Math.abs(
      (t.normal[0] * direction[0] + t.normal[1] * direction[1] + t.normal[2] * direction[2]) /
        length,
    );
    if (along > 1e-6) distance += DIST_EPSILON / along;
  }

  return {
    distance,
    brushId: t.brushId,
    material: t.material,
    at: t.point,
    unbounded: !t.hit,
  };
}

/**
 * The point a person's body occupies when standing at a place.
 *
 * A place is given as a spot on the floor -- a room's widest cell, a doorway's col, an
 * entity's origin -- and all three sit at or near ground level. A hull centred there extends
 * half its height *below* the floor, so it starts inside the slab and every measurement from
 * it returns zero. The width of a 256-unit corridor came back as 32, which is the hull's own
 * footprint and nothing else: a plausible-looking number produced by measuring nothing.
 *
 * So the point is dropped to the floor beneath it and raised by half the hull. Every
 * measurement that takes a *place* rather than a *body position* has to do this, which is
 * why it is one function rather than a line repeated at each call site.
 */
export function standingAt(scene: Scene, at: Vec3, half: Vec3 = HULL_STANDING): Vec3 {
  const down = traceRay(scene, at, [at[0], at[1], at[2] - REACH], MASK_SOLID);
  const floorZ = down.hit && !down.startSolid ? down.point[2] : at[2];
  return [at[0], at[1], floorZ + half[2] + 0.5];
}

export interface WidthMeasurement {
  /** Free width across, in units: the two sweeps plus the box's own width. */
  widthUnits: number;
  /** The axis measured along, as a unit vector. */
  axis: Vec3;
  at: Vec3;
  /** What stopped each sweep. Naming both sides is what makes a finding actionable. */
  sides: [Sweep, Sweep];
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l < 1e-9 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
};

/**
 * Free width across a point, along one horizontal axis.
 *
 * The box's own footprint is added back: a 32-wide hull that travels 32 units each way is
 * standing in a 96-unit gap, not a 64-unit one. Forgetting that term under-reports every
 * width by exactly one player, which is the width most likely to matter.
 */
export function widthAcross(
  scene: Scene,
  at: Vec3,
  axis: Vec3,
  half: Vec3 = HULL_STANDING,
  mask = MASK_PLAYER,
): WidthMeasurement {
  const a = norm(axis);
  const back: Vec3 = [-a[0], -a[1], -a[2]];
  const one = sweep(scene, at, a, half, mask);
  const two = sweep(scene, at, back, half, mask);
  // The support of the box along the axis, which is its own contribution to the gap.
  const own =
    2 * (Math.abs(a[0]) * half[0] + Math.abs(a[1]) * half[1] + Math.abs(a[2]) * half[2]);
  return {
    widthUnits: one.distance + two.distance + own,
    axis: a,
    at,
    sides: [one, two],
  };
}

/**
 * The narrowest free width across a point, over horizontal directions.
 *
 * A corridor is wide one way and long another, so "how wide is it" means the narrow one, and
 * the narrow one is not necessarily along x or y -- a diagonal alley is narrow diagonally.
 * Sixteen directions is 11.25 degrees apart, which is finer than the grid the location came
 * from, so the sampling is not the limiting error.
 */
export function narrowestWidth(
  scene: Scene,
  at: Vec3,
  half: Vec3 = HULL_STANDING,
  mask = MASK_PLAYER,
  directions = 16,
): WidthMeasurement {
  let best: WidthMeasurement | null = null;
  for (let i = 0; i < directions; i++) {
    const angle = (Math.PI * i) / directions;
    const m = widthAcross(scene, at, [Math.cos(angle), Math.sin(angle), 0], half, mask);
    if (!best || m.widthUnits < best.widthUnits) best = m;
  }
  return best!;
}

export interface Headroom {
  heightUnits: number;
  at: Vec3;
  /** Height of the floor found under the point, or null when there is none. */
  floorZ: number | null;
  ceilingBrushId: number | null;
  ceilingMaterial: string | null;
  unbounded: boolean;
}

/**
 * Floor to ceiling at a point, measured with a player-width box rather than a line.
 *
 * A ray finds the gap between two ceiling beams and reports the height of the room above
 * them. A 32-wide box finds the beams.
 */
export function headroom(scene: Scene, at: Vec3, mask = MASK_SOLID): Headroom {
  // This is `widthAcross` turned on its side, and writing it that way rather than as its own
  // pair of traces is the point: the first version read the contact POINT for the ceiling and
  // the floor, which carries the tracer's DIST_EPSILON nudge, so every height came out
  // 0.0625 short while the widths beside it were exact. One measurement path, one place for
  // that correction to live.
  const flat: Vec3 = [HULL_STANDING[0], HULL_STANDING[1], 0.5];
  const m = widthAcross(scene, at, [0, 0, 1], flat, mask);
  const [up, down] = m.sides;

  const floorZ = down.unbounded ? null : at[2] - down.distance - flat[2];

  return {
    heightUnits: up.unbounded || down.unbounded ? 0 : m.widthUnits,
    at,
    floorZ,
    ceilingBrushId: up.brushId,
    ceilingMaterial: up.material,
    unbounded: up.unbounded || down.unbounded,
  };
}

export interface Approach {
  /** Free distance ahead of the entity, for a person. */
  clearUnits: number;
  /** The direction taken, from the entity's own yaw. */
  facing: Vec3;
  blockedBy: { brushId: number | null; material: string | null } | null;
  /** Where the measurement was taken from. */
  from: Vec3;
  /**
   * The hull used, stated because it is an assumption and not a measurement.
   *
   * A door's leaf width lives in a model this server cannot open offline, so "can the door
   * swing" is not answerable here. What is answerable is how much room a person has in front
   * of it, which is the question that actually blocks a doorway.
   */
  assumedHull: Vec3;
}

/**
 * How much clear room a person has in front of an entity.
 *
 * Taken from the entity's origin, lifted to standing height above the floor beneath it, then
 * swept along its yaw. The lift matters: an entity's origin is usually at its base, and a
 * sweep from there is a sweep through the floor.
 */
export function clearanceInFront(
  scene: Scene,
  origin: Vec3,
  yawDegrees: number,
  half: Vec3 = HULL_STANDING,
  mask = MASK_PLAYER,
): Approach {
  const rad = (yawDegrees * Math.PI) / 180;
  const facing: Vec3 = [Math.cos(rad), Math.sin(rad), 0];

  const from = standingAt(scene, origin, half);
  const s = sweep(scene, from, facing, half, mask);
  return {
    clearUnits: s.distance,
    facing,
    blockedBy: s.unbounded ? null : { brushId: s.brushId, material: s.material },
    from,
    assumedHull: half,
  };
}

export interface Nearest {
  distanceUnits: number;
  point: Vec3;
  brushId: number;
  material: string;
}

/** The nearest surface, exact. Re-exported so a caller measuring does not import the tracer. */
export function nearestObstacle(scene: Scene, at: Vec3, radius: number, mask = MASK_SOLID): Nearest | null {
  const n = nearestSurface(scene, at, radius, mask);
  if (!n) return null;
  return { distanceUnits: n.distance, point: n.point, brushId: n.brushId, material: n.material };
}

export { HULL_CROUCHING, HULL_STANDING };
