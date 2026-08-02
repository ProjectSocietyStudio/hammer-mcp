import { entityFromBlock } from "../entity/model.js";
import type { MapEntity } from "../entity/model.js";
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
