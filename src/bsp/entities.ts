import { entityFromBlock } from "../entity/model.js";
import type { MapEntity } from "../entity/model.js";
import { parseConnection } from "../entity/wiring.js";
import type { WirableEntity } from "../entity/wiring.js";
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { LUMP_ENTITIES, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader } from "./header.js";

export interface EntityLump {
  header: BspHeader;
  /** Raw lump text, with the trailing NUL stripped. */
  text: string;
  /** True when the lump on disk ended with a NUL byte, as vbsp writes it. */
  nulTerminated: boolean;
  entities: MapEntity[];
}

/**
 * Reads and parses lump 0 of a BSP.
 *
 * Seeks straight to the lump: on the project's 1.13 GB map this reads 1.5 MB, because
 * 1004 MB of that file is the embedded pakfile and none of it is needed here.
 */
export function readEntityLump(path: string): EntityLump {
  const header = readHeader(path);
  const lump = requireLump(header, LUMP_ENTITIES);
  const raw = readAt(path, lump.offset, lump.length);

  const nulTerminated = raw.length > 0 && raw[raw.length - 1] === 0;
  const body = nulTerminated ? raw.subarray(0, raw.length - 1) : raw;
  const text = body.toString("utf8");

  return { header, text, nulTerminated, entities: parseEntityText(text) };
}

/**
 * Parses entity-lump text: a flat sequence of anonymous `{ ... }` blocks.
 *
 * Named blocks are rejected rather than skipped -- a name here means the text is a VMF
 * body, not an entity lump, and silently returning zero entities would read as "this map
 * has no entities" instead of "you handed me the wrong thing".
 */
/**
 * Which keyvalues of a compiled entity are outputs.
 *
 * A VMF keeps outputs in their own `connections` block; vbsp flattens that away, so in a
 * compiled lump an output is an ordinary `"key" "value"` pair sitting among the rest. The
 * name is the only thing left to go on, and Valve's convention is that every output starts
 * with `On` -- with `Out` for the handful that report a value (`math_counter.OutValue`,
 * `logic_compare.OutValue`).
 *
 * A name alone would be a guess, so the value has to parse as a connection too: five
 * fields with a target and an input. `"OnFire"` holding `"1"` is a keyvalue whatever it is
 * called. `validate_io` then checks the result against the FGD, which turns the convention
 * into something verified -- and reports any output the FGD knows about that this missed.
 */
export function isOutputKey(key: string, value: string): boolean {
  if (!/^(On|Out)[A-Z]/.test(key)) return false;
  const parsed = parseConnection(value);
  return parsed !== null && parsed.target.length > 0 && parsed.input.length > 0;
}

/**
 * A compiled map's entities with their outputs moved out of the keyvalues.
 *
 * This is the whole BSP-specific half of wiring, and it is a move rather than a copy: in a
 * VMF an output is not a keyvalue, so leaving it in both places would make the same entity
 * read differently depending on which file it came out of -- which is exactly what
 * `entity/model.ts` promises does not happen.
 */
export function withOutputsSplit(entities: readonly MapEntity[]): MapEntity[] {
  return entities.map((e) => ({
    ...e,
    keyvalues: e.keyvalues.filter(([k, v]) => !isOutputKey(k, v)),
    connections: e.keyvalues.filter(([k, v]) => isOutputKey(k, v)),
  }));
}

/** A compiled map's entities in the shape `entity/wiring.ts` judges. */
export function wirableFromLump(entities: readonly MapEntity[]): WirableEntity[] {
  return withOutputsSplit(entities).map((e) => ({
    id: e.id ?? null,
    index: e.index,
    targetname: e.targetname ?? null,
    classname: e.classname,
    connections: e.connections,
  }));
}

export function parseEntityText(text: string): MapEntity[] {
  const nodes = parse(text);
  const out: MapEntity[] = [];
  let index = 0;
  for (const n of nodes) {
    if (n.kind !== "block") {
      throw new Error(
        `entity lump: expected a { } block, found the pair "${n.key}" at offset ${n.start}`,
      );
    }
    if (n.name !== "") {
      throw new Error(
        `entity lump: expected an anonymous { } block, found "${n.name}" at offset ${n.start}`,
      );
    }
    out.push(entityFromBlock(n as KvBlock, index++));
  }
  return out;
}
