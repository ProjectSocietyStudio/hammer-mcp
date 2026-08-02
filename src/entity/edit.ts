import type { MapEntity } from "./model.js";

/**
 * Classes whose effect is baked at compile time. Adding one through a `.lmp` patch
 * changes nothing at all: the LIGHTING lump (42 MB on the project's map) was computed by
 * vrad and the engine does not recompute it at load.
 */
const BAKED_AT_COMPILE = /^(light|light_spot|light_environment|light_dynamic$)/;

/**
 * Classes that only ever exist on the client.
 *
 * A `.lmp` lives on the server and is not referenced by the BSP, so clients never
 * download it. These entities would exist server-side and be invisible to every player --
 * a gap nobody notices until someone reports a missing sprite.
 */
const CLIENT_SIDE_ONLY = new Set([
  "env_sprite",
  "env_sprite_oriented",
  "info_particle_system",
  "sky_camera",
  "func_lod",
  "env_fog_controller",
  "env_tonemap_controller",
  "shadow_control",
  "env_sun",
  "func_dustcloud",
  "func_dustmotes",
  "func_precipitation",
]);

export interface EntityMatch {
  /** Index in the source entity list. The only unambiguous selector in a compiled lump. */
  index?: number;
  classname?: string;
  targetname?: string;
}

export type EntityOp =
  | { op: "add"; keyvalues: Record<string, string> }
  | { op: "update"; match: EntityMatch; set?: Record<string, string>; unset?: string[] }
  | { op: "remove"; match: EntityMatch };

export interface OpOutcome {
  op: EntityOp["op"];
  matched: number;
  /** Indices of the entities this op acted on. */
  indices: number[];
  warnings: string[];
}

export interface EditResult {
  text: string;
  outcomes: OpOutcome[];
  warnings: string[];
  entitiesBefore: number;
  entitiesAfter: number;
}

class OpError extends Error {}

function select(entities: readonly MapEntity[], m: EntityMatch): MapEntity[] {
  if (m.index === undefined && !m.classname && !m.targetname) {
    throw new OpError("match needs at least one of index, classname, targetname");
  }
  return entities.filter(
    (e) =>
      (m.index === undefined || e.index === m.index) &&
      (!m.classname || e.classname === m.classname) &&
      (!m.targetname || e.targetname === m.targetname),
  );
}

function warnFor(classname: string): string[] {
  const out: string[] = [];
  if (BAKED_AT_COMPILE.test(classname)) {
    out.push(
      `${classname}: lighting is baked by vrad at compile time. Adding this through a lump ` +
        `patch has no effect in game -- the map must be recompiled.`,
    );
  }
  if (CLIENT_SIDE_ONLY.has(classname)) {
    out.push(
      `${classname}: client-side entity. A lump patch is server-only and is never sent to ` +
        `clients, so this will exist on the server and be invisible to every player.`,
    );
  }
  return out;
}

/** Formats one entity block the way vbsp writes them into the lump. */
function formatEntity(kv: Record<string, string>): string {
  const body = Object.entries(kv)
    .map(([k, v]) => `"${k}" "${v}"\n`)
    .join("");
  return `{\n${body}}\n`;
}

/**
 * Applies entity operations to entity-lump text.
 *
 * Edits are computed as byte ranges over the original text and applied last-first, so
 * everything untouched comes through byte-identical. New brush entities are NOT
 * expressible here: a `func_*` needs a brush model (`*N`) that only vbsp can produce.
 */
export function applyEntityOps(
  text: string,
  entities: readonly MapEntity[],
  ops: readonly EntityOp[],
): EditResult {
  const splices: Array<{ start: number; end: number; text: string }> = [];
  const appends: string[] = [];
  const outcomes: OpOutcome[] = [];
  const warnings: string[] = [];
  let delta = 0;

  for (const op of ops) {
    if (op.op === "add") {
      const classname = op.keyvalues["classname"];
      if (!classname) throw new OpError("add: keyvalues must include a classname");
      const w = warnFor(classname);
      appends.push(formatEntity(op.keyvalues));
      outcomes.push({ op: "add", matched: 1, indices: [], warnings: w });
      warnings.push(...w);
      delta += 1;
      continue;
    }

    const targets = select(entities, op.match);
    const w: string[] = [];

    if (op.op === "remove") {
      for (const e of targets) {
        // Swallow the newline that followed the block, so removal does not leave a blank
        // line where an entity used to be.
        const end = text[e.end] === "\n" ? e.end + 1 : e.end;
        splices.push({ start: e.start, end, text: "" });
      }
      delta -= targets.length;
    } else {
      for (const e of targets) {
        const kv = new Map(e.keyvalues);
        for (const k of op.unset ?? []) kv.delete(k);
        for (const [k, v] of Object.entries(op.set ?? {})) kv.set(k, v);
        const next = kv.get("classname");
        if (next && next !== e.classname) w.push(...warnFor(next));
        splices.push({
          start: e.start,
          end: e.end,
          text: formatEntity(Object.fromEntries(kv)).replace(/\n$/, ""),
        });
      }
    }

    outcomes.push({
      op: op.op,
      matched: targets.length,
      indices: targets.map((e) => e.index),
      warnings: w,
    });
    warnings.push(...w);
  }

  // Right-to-left, so earlier offsets stay valid as we rewrite.
  let out = text;
  for (const s of [...splices].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  if (appends.length > 0) {
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += appends.join("");
  }

  return {
    text: out,
    outcomes,
    warnings,
    entitiesBefore: entities.length,
    entitiesAfter: entities.length + delta,
  };
}
