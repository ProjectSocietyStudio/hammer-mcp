/**
 * Judging entity wiring, in the one shape that works for a `.vmf` and for a compiled map.
 *
 * `entity/model.ts` already says the three formats "differ in packaging, not in content".
 * Wiring was the place that had not been told: `checkWiring` took VMF source text, so
 * `validate_io` could judge a map you have the source for and nothing could judge the map
 * you do not -- which is the production case, the one `write_lump_patch` exists for, and
 * the one where a dead output cannot be fixed by opening Hammer.
 *
 * The eastcoast audit paid for that gap in the only currency that counts: four defects in
 * a shipped map (a respawn timer wired to the wrong building, a timer that does not exist,
 * a tonemap controller that was never placed, an empty `point_template`) were found by
 * hand-written Python, because nothing here would read a `.bsp` and say which outputs
 * point at nothing.
 *
 * So the judgement lives here, over a structural type, and the two format modules supply
 * it. Nothing is duplicated: `vmf/wiring.ts` is the same code with a VMF adapter in front.
 */

/** The least an entity has to be for its wiring to be judged. */
export interface WirableEntity {
  id: number | null;
  index: number;
  classname: string;
  targetname: string | null;
  /** Outputs, as `[outputName, rawValue]`. */
  connections: ReadonlyArray<readonly [string, string]>;
}

/**
 * The field separator Hammer writes. 0x1b, and invisible in every editor.
 *
 * Written as an escape rather than the literal byte: an invisible character in a source
 * file is a character nobody notices being deleted.
 */
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

export interface ClassSchema {
  /** Inputs the class accepts, lowercased. */
  inputs: Set<string>;
  /** Outputs the class fires, lowercased. */
  outputs: Set<string>;
}

/** Splits an output value into its five fields, whichever separator was used. */
export function parseConnection(
  value: string,
): { target: string; input: string; parameter: string; delay: number; timesToFire: number } | null {
  // ESC is what Hammer writes today; the comma form is what Source used before the Orange
  // Box and Hammer still opens. A file can contain both, one per entity.
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

/** Every output in a list of entities, with what it aims at. */
export function connectionsOf(entities: readonly WirableEntity[]): {
  connections: Connection[];
  malformed: WiringFinding[];
} {
  const connections: Connection[] = [];
  const malformed: WiringFinding[] = [];

  const byName = new Map<string, number>();
  for (const e of entities) {
    if (!e.targetname) continue;
    const key = e.targetname.toLowerCase();
    byName.set(key, (byName.get(key) ?? 0) + 1);
  }

  for (const e of entities) {
    for (const [key, value] of e.connections) {
      const parsed = parseConnection(value);
      if (!parsed || parsed.target.length === 0 || parsed.input.length === 0) {
        malformed.push({
          severity: "error",
          rule: "malformed-connection",
          message:
            `entity ${e.id ?? e.index} (${e.classname}) has an output ${key} whose ` +
            `value is not a connection: ${JSON.stringify(value)}. Hammer writes ` +
            `target, input, parameter, delay and times-to-fire separated by ESC.`,
          fromId: e.id,
          output: key,
          target: "",
        });
        continue;
      }
      connections.push({
        fromId: e.id,
        fromClassname: e.classname,
        fromTargetname: e.targetname,
        output: key,
        ...parsed,
        resolved: byName.get(parsed.target.toLowerCase()) ?? 0,
      });
    }
  }

  return { connections, malformed };
}

/**
 * Judges wiring against schemas the caller supplies.
 *
 * The schemas come from the FGD, which lives behind the Python sidecar, so they are passed
 * in rather than fetched. A class with no schema is not judged -- absence of a definition
 * is not evidence of a fault, and reporting one would bury the real findings.
 */
export function checkEntityWiring(
  entities: readonly WirableEntity[],
  schemas: ReadonlyMap<string, ClassSchema>,
): WiringReport {
  const { connections, malformed } = connectionsOf(entities);
  const findings: WiringFinding[] = [...malformed];
  const unresolved = new Set<string>();
  const warnings: string[] = [];

  // A map with func_instance in it does not contain the entities the instances bring, and
  // their targetnames are rewritten by fixup on top of that. An output aimed at one of
  // those resolves in the compiled map and resolves nowhere here, so calling it broken
  // would fill the report with the map's best-organised parts. (A compiled map has no
  // instances left: vbsp expanded them, so this is always zero there and the findings are
  // errors rather than warnings -- which is right, because there is nothing left to expand.)
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
  /** Keyvalues, minus the three above and minus any child block. */
  keyvalues: Record<string, string>;
  solidCount: number;
  outputCount: number;
}

export interface EntityRowFilter {
  classname?: string;
  targetname?: string;
  /** A keyvalue that must be present, and optionally the value it must have. */
  hasKey?: string;
  keyValue?: string;
}

/**
 * Hammer's Entity Report, over the shared entity model.
 *
 * `read_vmf` counts entities by classname and `read_bsp_entities` reads a compiled map.
 * Neither answers "which entity has `spawnflags` 512", which is the question the report is
 * for -- and which is how a mapper finds the one door of forty that was left locked. On a
 * map with no source that is not a convenience: it is the only way to ask.
 */
export function entityRows(
  entities: readonly {
    id?: number;
    index: number;
    classname: string;
    targetname?: string;
    keyvalues: ReadonlyArray<readonly [string, string]>;
    connections: ReadonlyArray<readonly [string, string]>;
    solidCount: number;
  }[],
  filter: EntityRowFilter = {},
): EntityRow[] {
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
    for (const [key, value] of e.keyvalues) {
      if (key === "id" || key === "classname" || key === "targetname") continue;
      if (key === "origin") {
        origin = value;
        continue;
      }
      keyvalues[key] = value;
    }

    if (filter.hasKey) {
      const value = filter.hasKey === "origin" ? origin : keyvalues[filter.hasKey];
      if (value === undefined || value === null) continue;
      if (filter.keyValue !== undefined && value !== filter.keyValue) continue;
    }

    rows.push({
      id: e.id ?? null,
      index: e.index,
      classname: e.classname,
      targetname: e.targetname ?? null,
      origin,
      keyvalues,
      solidCount: e.solidCount,
      outputCount: e.connections.length,
    });
  }

  return rows;
}
