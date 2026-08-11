import { existsSync, readFileSync } from "node:fs";
import type { MapEntity, Vec3 } from "../entity/model.js";

export interface LeakPoint {
  point: Vec3;
  /** Index along the path vbsp traced from the entity to the void. */
  index: number;
}

export interface NearestEntity {
  index: number;
  id?: number;
  classname: string;
  targetname?: string;
  origin: Vec3;
  distanceUnits: number;
}

export interface LeakReport {
  pointfile: string;
  pointCount: number;
  /** First point of the traced path. Which end holds the entity is not guaranteed. */
  start: Vec3;
  /** Last point of the traced path. */
  end: Vec3;
  /** Straight-line length of the leak path, a rough measure of how far it wandered. */
  spanUnits: number;
  nearestToStart: NearestEntity[];
  nearestToEnd: NearestEntity[];
  /**
   * The entity the leak is about, when one sits essentially on an endpoint.
   *
   * Measured rather than assumed: on the probe map with its player start moved outside,
   * vbsp wrote two points and put the entity on the SECOND one, not the first. Reading
   * only the start named a light 232 units away and missed the actual cause entirely.
   */
  leakingEntity: (NearestEntity & { atEnd: boolean }) | null;
  points: LeakPoint[];
}

/**
 * Reads a `.lin` pointfile: one `x y z` per line, the path vbsp traced from an entity
 * out to the void.
 *
 * The compiler says only "leaked!" and writes this file. Turning it into coordinates,
 * and then into the entities standing near them, is the difference between knowing a map
 * leaks and knowing where.
 */
export function readPointfile(path: string): LeakPoint[] {
  if (!existsSync(path)) {
    throw new Error(
      `${path} does not exist. vbsp writes it beside the map when it leaks, so no ` +
        `pointfile usually means the last compile did not leak`,
    );
  }
  const points: LeakPoint[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/).map(Number);
    if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) continue;
    points.push({ point: [parts[0]!, parts[1]!, parts[2]!], index: points.length });
  }
  return points;
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Correlates a leak path with the map's entities.
 *
 * vbsp traces between an entity that can see the void and the hull it escaped through,
 * and it does not guarantee which end is which -- so both are correlated. Naming the
 * entity turns "the map leaks" into "this one is outside, or the wall beside it has a
 * hole in it".
 */
export function locateLeak(
  pointfile: string,
  points: LeakPoint[],
  entities: readonly MapEntity[],
  limit = 5,
): LeakReport {
  if (points.length === 0) {
    throw new Error(`${pointfile} holds no coordinates`);
  }
  const start = points[0]!.point;
  const end = points[points.length - 1]!.point;

  const near = (at: Vec3): NearestEntity[] =>
    entities
      .filter((e) => e.origin)
      .map((e) => ({
        index: e.index,
        ...(e.id !== undefined ? { id: e.id } : {}),
        classname: e.classname,
        ...(e.targetname ? { targetname: e.targetname } : {}),
        origin: e.origin!,
        distanceUnits: Math.round(distance(at, e.origin!)),
      }))
      .sort((a, b) => a.distanceUnits - b.distanceUnits)
      .slice(0, limit);

  const nearestToStart = near(start);
  const nearestToEnd = near(end);

  // An endpoint that lands on an entity is the entity vbsp traced from. 16 units is
  // tight enough not to accuse a neighbour and loose enough to survive rounding.
  const ON_ENTITY = 16;
  const atStart = nearestToStart[0];
  const atEnd = nearestToEnd[0];
  let leakingEntity: (NearestEntity & { atEnd: boolean }) | null = null;
  if (atEnd && atEnd.distanceUnits <= ON_ENTITY) {
    leakingEntity = { ...atEnd, atEnd: true };
  } else if (atStart && atStart.distanceUnits <= ON_ENTITY) {
    leakingEntity = { ...atStart, atEnd: false };
  }

  return {
    pointfile,
    pointCount: points.length,
    start,
    end,
    spanUnits: Math.round(distance(start, end)),
    nearestToStart,
    nearestToEnd,
    leakingEntity,
    points: points.length > 200 ? [...points.slice(0, 100), ...points.slice(-100)] : points,
  };
}
