import type { KvBlock } from "../kv/parse.js";
import { children, get, pairs } from "../kv/parse.js";

export type Vec3 = [number, number, number];

/**
 * One entity, in the single shape used everywhere in this server -- whether it came from
 * a `.vmf`, a BSP entity lump or a `.lmp` patch. The three formats differ in packaging,
 * not in content, so the audit and query tools work against one model.
 */
export interface MapEntity {
  /** Position in the source list, 0-based. Stable identifier when there is no `id`. */
  index: number;
  /** Hammer's entity id. Present in a VMF, absent from a compiled entity lump. */
  id?: number;
  classname: string;
  targetname?: string;
  origin?: Vec3;
  angles?: Vec3;
  /** Every `"key" "value"` pair in source order, duplicates included. */
  keyvalues: Array<[string, string]>;
  /** Outputs, from the `connections` block of a VMF entity. */
  connections: Array<[string, string]>;
  /** Brush solids owned by this entity (VMF only); counted, not modelled. */
  solidCount: number;
  /** Offsets of the entity's block in its source text, for the splice write path. */
  start: number;
  end: number;
}

/** Parses `"x y z"` into a vector, or undefined when it is not three numbers. */
export function parseVec3(raw: string | undefined): Vec3 | undefined {
  if (!raw) return undefined;
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  return [nums[0]!, nums[1]!, nums[2]!];
}

/**
 * Parses `"[x y z]"`, the bracketed form the old production server used in its
 * `streetnames` and placement files.
 */
export function parseBracketVec3(raw: string | undefined): Vec3 | undefined {
  if (!raw) return undefined;
  return parseVec3(raw.trim().replace(/^\[/, "").replace(/\]$/, ""));
}

/** Builds a `MapEntity` from a parsed KeyValues block. */
export function entityFromBlock(block: KvBlock, index: number): MapEntity {
  const idRaw = get(block, "id");
  const id = idRaw === undefined ? undefined : Number(idRaw);

  const connections: Array<[string, string]> = [];
  for (const c of children(block, "connections")) connections.push(...pairs(c));

  return {
    index,
    ...(id !== undefined && Number.isFinite(id) ? { id } : {}),
    classname: get(block, "classname") ?? "",
    ...(get(block, "targetname") !== undefined
      ? { targetname: get(block, "targetname")! }
      : {}),
    ...(parseVec3(get(block, "origin")) ? { origin: parseVec3(get(block, "origin"))! } : {}),
    ...(parseVec3(get(block, "angles")) ? { angles: parseVec3(get(block, "angles"))! } : {}),
    keyvalues: pairs(block),
    connections,
    solidCount: children(block, "solid").length,
    start: block.start,
    end: block.end,
  };
}

export interface EntityFilter {
  classname?: string;
  targetname?: string;
  /** Substring match against classname, for exploratory queries. */
  classnameContains?: string;
  near?: Vec3;
  radius?: number;
}

export function matchesFilter(e: MapEntity, f: EntityFilter): boolean {
  if (f.classname && e.classname !== f.classname) return false;
  if (f.targetname && e.targetname !== f.targetname) return false;
  if (f.classnameContains && !e.classname.includes(f.classnameContains)) return false;
  if (f.near) {
    if (!e.origin) return false;
    const r = f.radius ?? 512;
    const dx = e.origin[0] - f.near[0];
    const dy = e.origin[1] - f.near[1];
    const dz = e.origin[2] - f.near[2];
    if (dx * dx + dy * dy + dz * dz > r * r) return false;
  }
  return true;
}

/** Count of entities per classname, most frequent first. */
export function histogram(entities: readonly MapEntity[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const e of entities) counts.set(e.classname, (counts.get(e.classname) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
