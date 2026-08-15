/**
 * Checking a map's entity wiring against the game's own FGD.
 *
 * `read_fgd_class` has been able to say what inputs a class has since the beginning, and
 * nothing has ever used it to judge a map. So an output aimed at an entity that does not
 * exist, or at an input its class does not have, passes every check this toolkit makes and
 * every check vbsp makes -- and then does nothing in game, silently, which is the hardest
 * class of bug a mapper has.
 *
 * A `connections` block is a list of pairs whose key is the output name and whose value is
 * five fields separated by the ESC character, or by a comma in older maps:
 *
 *     "OnTrigger" "door_a<ESC>Open<ESC><ESC>0<ESC>-1"
 *      output       target  input  parameter delay times-to-fire
 *
 * The judgement itself lives in `entity/wiring.ts`, which works on any map's entities
 * whatever file they came out of. This module is the VMF adapter in front of it: it knows
 * where a VMF keeps its outputs (a `connections` block) and nothing else.
 *
 * Both separators appear in files Hammer writes -- the comma form is what Source used
 * before the Orange Box and Hammer still reads it -- so both are accepted here. Writing is
 * `edit_vmf`'s job and it uses the ESC form, which is what Hammer writes today.
 *
 * What this cannot do, and says so: an output may legitimately target something that is not
 * in the map. `!activator`, `!self` and `!player` are resolved at runtime, a targetname may
 * be shared by a dozen entities, and an instance's entities are not in this file at all
 * until `collapseInstances` expands them. Every one of those is reported as unresolved
 * rather than as broken.
 */
import { children, parse } from "../kv/parse.js";
import type { KvBlock, KvPair } from "../kv/parse.js";
import { readEntities } from "./edit.js";
import type { VmfEntity } from "./edit.js";

import { entityFromBlock } from "../entity/model.js";
import { checkEntityWiring, connectionsOf, entityRows } from "../entity/wiring.js";
import type {
  ClassSchema,
  Connection,
  EntityRow,
  EntityRowFilter,
  WirableEntity,
  WiringFinding,
  WiringReport,
} from "../entity/wiring.js";

export {
  checkEntityWiring,
  connectionsOf,
  parseConnection,
  RUNTIME_TARGETS,
} from "../entity/wiring.js";
export type {
  ClassSchema,
  Connection,
  EntityRow,
  EntityRowFilter,
  WirableEntity,
  WiringFinding,
  WiringReport,
} from "../entity/wiring.js";

/**
 * VMF entities in the shape `entity/wiring.ts` judges.
 *
 * The whole VMF-specific part of wiring is this function: a VMF keeps its outputs in a
 * `connections` block, and a compiled entity lump keeps them as ordinary keyvalues. Once
 * that is normalised there is nothing left for two implementations to disagree about.
 */
export function wirableEntities(source: string): WirableEntity[] {
  const { entities } = readEntities(source);
  return entities.map((e) => ({
    id: e.id,
    index: e.index,
    classname: e.classname,
    targetname: e.targetname,
    connections: children(e.block, "connections").flatMap((c) =>
      c.entries
        .filter((n): n is KvPair => n.kind === "pair")
        .map((n) => [n.key, n.value] as const),
    ),
  }));
}

/** Every output in a VMF, with what it aims at. */
export function readConnections(source: string): {
  connections: Connection[];
  malformed: WiringFinding[];
} {
  return connectionsOf(wirableEntities(source));
}

/** Judges a VMF's wiring against schemas the caller supplies. */
export function checkWiring(
  source: string,
  schemas: ReadonlyMap<string, ClassSchema>,
): WiringReport {
  return checkEntityWiring(wirableEntities(source), schemas);
}

/** Hammer's Entity Report for a VMF. The report itself is `entity/wiring.ts`'s. */
export function entityReport(source: string, filter: EntityRowFilter = {}): EntityRow[] {
  const { entities } = readEntities(source);
  return entityRows(
    entities.map((e) => entityFromBlock(e.block, e.index)),
    filter,
  );
}

export { parse, readEntities };
export type { KvBlock, VmfEntity };
