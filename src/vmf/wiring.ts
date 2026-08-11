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

/** The field separator Hammer writes. 0x1b, and invisible in every editor. */
const ESC = "\u001b";

/** Targets the engine resolves when the map runs, which no file can contain. */
export const RUNTIME_TARGETS = new Set([
  "!activator",
  "!caller",
  "!self",
  "!player",
  "!pvsplayer",
  "!speechtarget",
  "!picker",
]);

export interface Connection {
  /** Entity the output is on. */
  fromId: number | null;
  fromClassname: string;
  fromTargetname: string | null;
  output: string;
  target: string;
  input: string;
  parameter: string;
  delay: number;
  timesToFire: number;
  /** Entities in this file whose targetname matches. */
  resolved: number;
}

export interface WiringFinding {
  severity: "error" | "warning";
  rule:
    | "unknown-target"
    | "unknown-input"
    | "unknown-output"
    | "malformed-connection"
    | "runtime-target"
    | "self-target";
  message: string;
  fromId: number | null;
  output: string;
  target: string;
}

export interface WiringReport {
  connections: Connection[];
  findings: WiringFinding[];
  /** Targetnames used by an output and owned by nothing in this file. */
  unresolvedTargets: string[];
  warnings: string[];
}

/** Splits an output value into its five fields, whichever separator was used. */
export function parseConnection(
  value: string,
): { target: string; input: string; parameter: string; delay: number; timesToFire: number } | null {
  // ESC is what Hammer writes today; the comma form is what Source used before the Orange
  // Box and Hammer still opens. A file can contain both, one per entity.
  // Written as an escape rather than the literal byte: an invisible character in a source
  // file is a character nobody notices being deleted.
  const parts = value.includes(ESC) ? value.split(ESC) : value.split(",");
  if (parts.length < 2) return null;
  const [target, input, parameter, delay, times] = parts;
  return {
    target: (target ?? "").trim(),
    input: (input ?? "").trim(),
    parameter: parameter ?? "",
    delay: Number(delay ?? 0) || 0,
    timesToFire: Number(times ?? -1) || -1,
  };
}

/** Every output in the map, with what it aims at. */
export function readConnections(source: string): {
  connections: Connection[];
  malformed: WiringFinding[];
} {
  const { entities } = readEntities(source);
  const connections: Connection[] = [];
  const malformed: WiringFinding[] = [];

  const byName = new Map<string, number>();
  for (const e of entities) {
    if (!e.targetname) continue;
    byName.set(e.targetname.toLowerCase(), (byName.get(e.targetname.toLowerCase()) ?? 0) + 1);
  }

  for (const e of entities) {
    for (const conn of children(e.block, "connections")) {
      for (const node of conn.entries) {
        if (node.kind !== "pair") continue;
        const parsed = parseConnection(node.value);
        if (!parsed || parsed.target.length === 0 || parsed.input.length === 0) {
          malformed.push({
            severity: "error",
            rule: "malformed-connection",
            message:
              `entity ${e.id ?? e.index} (${e.classname}) has an output ${node.key} whose ` +
              `value is not a connection: ${JSON.stringify(node.value)}. Hammer writes ` +
              `target, input, parameter, delay and times-to-fire separated by ESC.`,
            fromId: e.id,
            output: node.key,
            target: "",
          });
          continue;
        }
        connections.push({
          fromId: e.id,
          fromClassname: e.classname,
          fromTargetname: e.targetname,
          output: node.key,
          ...parsed,
          resolved: byName.get(parsed.target.toLowerCase()) ?? 0,
        });
      }
    }
  }

  return { connections, malformed };
}

export interface ClassSchema {
  /** Inputs the class accepts, lowercased. */
  inputs: Set<string>;
  /** Outputs the class fires, lowercased. */
  outputs: Set<string>;
}

/**
 * Judges a map's wiring against schemas the caller supplies.
 *
 * The schemas come from the FGD, which lives behind the Python sidecar, so they are passed
 * in rather than fetched: this file stays pure text work and the tool decides how much of
 * the FGD is worth loading. A class with no schema is not judged -- absence of a definition
 * is not evidence of a fault, and reporting one would bury the real findings.
 */
export function checkWiring(
  source: string,
  schemas: ReadonlyMap<string, ClassSchema>,
): WiringReport {
  const { connections, malformed } = readConnections(source);
  const findings: WiringFinding[] = [...malformed];
  const unresolved = new Set<string>();
  const warnings: string[] = [];

  const { entities } = readEntities(source);

  // A map with func_instance in it does not contain the entities the instances bring, and
  // their targetnames are rewritten by fixup on top of that. An output aimed at one of
  // those resolves in the compiled map and resolves nowhere here, so calling it broken
  // would fill the report with the map's best-organised parts. read_vmf's
  // collapseInstances is what would answer properly; until this tool has it, the finding
  // is a warning that names the reason.
  const instanceCount = entities.filter((e) => e.classname === "func_instance").length;

  const classOf = new Map<string, Set<string>>();
  for (const e of entities) {
    if (!e.targetname) continue;
    const key = e.targetname.toLowerCase();
    const set = classOf.get(key) ?? new Set<string>();
    set.add(e.classname);
    classOf.set(key, set);
  }

  for (const c of connections) {
    const target = c.target.toLowerCase();

    if (RUNTIME_TARGETS.has(target)) {
      findings.push({
        severity: "warning",
        rule: "runtime-target",
        message:
          `entity ${c.fromId} fires ${c.output} at ${c.target}, which the engine resolves ` +
          `when the map runs. Nothing offline can say whether it will resolve to anything.`,
        fromId: c.fromId,
        output: c.output,
        target: c.target,
      });
      continue;
    }

    if (c.resolved === 0) {
      unresolved.add(c.target);
      findings.push({
        severity: instanceCount > 0 ? "warning" : "error",
        rule: "unknown-target",
        message:
          `entity ${c.fromId} (${c.fromClassname}) fires ${c.output} at ${JSON.stringify(c.target)}, ` +
          `and nothing in this map has that targetname. ` +
          (instanceCount > 0
            ? `This map has ${instanceCount} func_instance, whose entities are not in this ` +
              `file and whose names are rewritten by fixup, so the target may well exist ` +
              `after expansion. Read it back with read_vmf and collapseInstances to be sure.`
            : `The output does nothing in game and no compiler mentions it.`),
        fromId: c.fromId,
        output: c.output,
        target: c.target,
      });
      continue;
    }

    // The output itself: a class that does not have it never fires, so the wire is dead at
    // the near end rather than the far one.
    // An empty set is a schema that says "this class has none", not a schema that is
    // missing. Treating the two the same suppressed every finding on a class the FGD
    // defines with no outputs -- which is exactly a class where every output is wrong.
    const fromSchema = schemas.get(c.fromClassname.toLowerCase());
    if (fromSchema && !fromSchema.outputs.has(c.output.toLowerCase())) {
      findings.push({
        severity: "error",
        rule: "unknown-output",
        message:
          `${c.fromClassname} has no output called ${c.output}, so this wire never fires. ` +
          `read_fgd_class lists what it does have.`,
        fromId: c.fromId,
        output: c.output,
        target: c.target,
      });
    }

    for (const classname of classOf.get(target) ?? []) {
      const schema = schemas.get(classname.toLowerCase());
      if (!schema) continue;
      if (schema.inputs.has(c.input.toLowerCase())) continue;
      findings.push({
        severity: "error",
        rule: "unknown-input",
        message:
          `${classname} named ${JSON.stringify(c.target)} has no input called ${c.input}. ` +
          `The output fires and nothing happens, which is the quietest failure a map has.`,
        fromId: c.fromId,
        output: c.output,
        target: c.target,
      });
    }
  }

  const judged = connections.filter((c) => schemas.has(c.fromClassname.toLowerCase())).length;
  if (judged < connections.length) {
    warnings.push(
      `${connections.length - judged} connection(s) are on classes with no FGD schema loaded, ` +
        `so their output names were not checked. A class with no definition is not judged: ` +
        `absence of a definition is not evidence of a fault.`,
    );
  }

  if (instanceCount > 0 && unresolved.size > 0) {
    warnings.push(
      `${unresolved.size} target(s) resolve to nothing in this file, and it has ` +
        `${instanceCount} func_instance. Those are reported as warnings rather than errors: ` +
        `an instance's entities are not in the file and its names are rewritten by fixup.`,
    );
  }

  return {
    connections,
    findings,
    unresolvedTargets: [...unresolved].sort(),
    warnings,
  };
}

export interface EntityRow {
  id: number | null;
  index: number;
  classname: string;
  targetname: string | null;
  origin: string | null;
  /** Keyvalues, minus the three above and minus the editor block. */
  keyvalues: Record<string, string>;
  solidCount: number;
  outputCount: number;
}

/**
 * Hammer's Entity Report: every entity, filterable, with its keyvalues.
 *
 * `read_vmf` counts entities by classname and `read_bsp_entities` reads a compiled map.
 * Neither answers "which entity has `spawnflags` 512", which is the question the report is
 * for -- and which is how a mapper finds the one door of forty that was left locked.
 */
export function entityReport(
  source: string,
  filter: {
    classname?: string;
    targetname?: string;
    /** A keyvalue that must be present, and optionally the value it must have. */
    hasKey?: string;
    keyValue?: string;
  } = {},
): EntityRow[] {
  const { entities } = readEntities(source);
  const rows: EntityRow[] = [];

  for (const e of entities) {
    if (filter.classname && !e.classname.toLowerCase().includes(filter.classname.toLowerCase())) {
      continue;
    }
    if (
      filter.targetname &&
      !(e.targetname ?? "").toLowerCase().includes(filter.targetname.toLowerCase())
    ) {
      continue;
    }

    const keyvalues: Record<string, string> = {};
    let origin: string | null = null;
    for (const node of e.block.entries) {
      if (node.kind !== "pair") continue;
      const pair = node as KvPair;
      if (pair.key === "id" || pair.key === "classname" || pair.key === "targetname") continue;
      if (pair.key === "origin") {
        origin = pair.value;
        continue;
      }
      keyvalues[pair.key] = pair.value;
    }

    if (filter.hasKey) {
      const value = filter.hasKey === "origin" ? origin : keyvalues[filter.hasKey];
      if (value === undefined || value === null) continue;
      if (filter.keyValue !== undefined && value !== filter.keyValue) continue;
    }

    rows.push({
      id: e.id,
      index: e.index,
      classname: e.classname,
      targetname: e.targetname,
      origin,
      keyvalues,
      solidCount: children(e.block, "solid").length,
      outputCount: children(e.block, "connections").reduce(
        (t, c) => t + c.entries.filter((n) => n.kind === "pair").length,
        0,
      ),
    });
  }

  return rows;
}

export { parse, readEntities };
export type { KvBlock, VmfEntity };
