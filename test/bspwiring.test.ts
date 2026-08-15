import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isOutputKey,
  readEntityLump,
  wirableFromLump,
  withOutputsSplit,
} from "../src/bsp/entities.js";
import { checkEntityWiring, connectionsOf, entityRows } from "../src/entity/wiring.js";
import type { ClassSchema } from "../src/entity/wiring.js";

/**
 * #103. Nothing in this repository validated the wiring of a compiled map, which is the
 * production case: the map you have no source for is the one you cannot fix in Hammer.
 *
 * The eastcoast audit found four defects in a shipped map -- a window-respawn timer wired
 * to the wrong building, a second shopfront whose timer does not exist, a tonemap
 * controller that was never placed, an empty point_template -- with hand-written Python,
 * because `validate_io` and `read_entity_report` took a `.vmf` and nothing took a `.bsp`.
 *
 * The lump below is that map's shape, reduced: the same comma separator vbsp copies
 * through, the same OnBreak/OnTimer/Enable/ForceSpawn vocabulary, and the same defect --
 * a timer that fires at a name nothing owns.
 */

const HEADER_BYTES = 1036;

/** A BSP that is nothing but a header and an entity lump. Enough to be read as one. */
function bspWithEntities(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hmcp-bspwiring-"));
  const path = join(dir, "synthetic.bsp");
  const body = Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([0])]);
  const header = Buffer.alloc(HEADER_BYTES);
  header.write("VBSP", 0, "ascii");
  header.writeInt32LE(20, 4);
  // Lump 0: offset, length, version, fourCC. The other 63 stay zero, which is what an
  // empty lump looks like anyway.
  header.writeInt32LE(HEADER_BYTES, 8);
  header.writeInt32LE(body.length, 12);
  header.writeInt32LE(1, 8 + 64 * 16); // mapRevision
  writeFileSync(path, Buffer.concat([header, body]));
  return path;
}

const LUMP = `
{
"world_maxs" "512 512 512"
"world_mins" "-512 -512 -512"
"classname" "worldspawn"
}
{
"origin" "0 0 0"
"targetname" "bar_2_windows"
"classname" "func_breakable"
"OnBreak" "bar_2_windows_timer,Enable,,0,-1"
}
{
"origin" "0 0 0"
"targetname" "bar_2_windows_timer"
"RefireTime" "120"
"StartDisabled" "1"
"classname" "logic_timer"
"OnTimer" "store_4_windows_timer,ForceSpawn,,0.2,-1"
"OnTimer" "bar_2_windows_timer,Disable,,0,-1"
}
{
"origin" "0 0 0"
"targetname" "res_4_windows_template"
"Template01" "res_4_windows"
"classname" "point_template"
}
{
"origin" "16 0 0"
"spawnflags" "512"
"classname" "info_player_start"
}
`;

describe("wiring a compiled map (#103)", () => {
  const path = bspWithEntities(LUMP);
  const entities = wirableFromLump(readEntityLump(path).entities);

  it("finds the outputs vbsp flattened into ordinary keyvalues", () => {
    const { connections, malformed } = connectionsOf(entities);
    expect(malformed).toEqual([]);
    expect(connections.map((c) => `${c.output}->${c.target}`)).toEqual([
      "OnBreak->bar_2_windows_timer",
      "OnTimer->store_4_windows_timer",
      "OnTimer->bar_2_windows_timer",
    ]);
    // The delay survives the comma form, which is the separator a 2018 map still uses.
    expect(connections[1]!.delay).toBe(0.2);
    expect(connections[1]!.input).toBe("ForceSpawn");
  });

  it("does not mistake an ordinary keyvalue for an output", () => {
    // The negative control this whole heuristic needs: a compiled lump has no connections
    // block, so a key is an output only if it also parses as one.
    expect(isOutputKey("OnTimer", "a,Enable,,0,-1")).toBe(true);
    expect(isOutputKey("OutValue", "counter,Add,1,0,-1")).toBe(true);
    expect(isOutputKey("OnTimer", "1")).toBe(false);
    expect(isOutputKey("origin", "0 0 0")).toBe(false);
    expect(isOutputKey("Only", "a,Enable,,0,-1"), "On must be a word, not a prefix").toBe(false);
    const spawn = entities.find((e) => e.classname === "info_player_start")!;
    expect(spawn.connections).toEqual([]);
  });

  it("names the target nothing owns, and says nothing about the ones that resolve", () => {
    const report = checkEntityWiring(entities, new Map<string, ClassSchema>());
    expect(report.unresolvedTargets).toEqual(["store_4_windows_timer"]);
    const dead = report.findings.filter((f) => f.rule === "unknown-target");
    expect(dead).toHaveLength(1);
    expect(dead[0]!.severity).toBe("error");
    expect(dead[0]!.message).toMatch(/nothing in this map has that targetname/);
  });

  it("is silent on the same map once the target exists", () => {
    // The negative sister: without this, the assertion above passes on a checker that
    // reports every output.
    const fixed = wirableFromLump(
      readEntityLump(bspWithEntities(LUMP.replace("store_4_windows_timer,ForceSpawn", "res_4_windows_template,ForceSpawn"))).entities,
    );
    const report = checkEntityWiring(fixed, new Map<string, ClassSchema>());
    expect(report.unresolvedTargets).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "unknown-target")).toEqual([]);
  });

  it("judges an input against the FGD the same way it does for a VMF", () => {
    const schemas = new Map<string, ClassSchema>([
      ["logic_timer", { inputs: new Set(["enable", "disable"]), outputs: new Set(["ontimer"]) }],
      ["point_template", { inputs: new Set(["forcespawn"]), outputs: new Set() }],
      ["func_breakable", { inputs: new Set(["break"]), outputs: new Set(["onbreak"]) }],
    ]);
    const report = checkEntityWiring(entities, schemas);
    // Enable and Disable are inputs logic_timer has; nothing here should be flagged for
    // them, and the only error left is the target that does not exist.
    expect(report.findings.filter((f) => f.rule === "unknown-input")).toEqual([]);
    expect(report.findings.filter((f) => f.rule === "unknown-output")).toEqual([]);

    // And an output the class does not have IS caught, so the check above means something.
    const wrong = wirableFromLump(
      readEntityLump(bspWithEntities(LUMP.replace('"OnBreak" "bar_2', '"OnFire" "bar_2'))).entities,
    );
    const second = checkEntityWiring(wrong, schemas);
    expect(second.findings.filter((f) => f.rule === "unknown-output")).toHaveLength(1);
  });

  it("reports rows with no Hammer id and no solids, because a compiled entity has neither", () => {
    const rows = entityRows(withOutputsSplit(readEntityLump(path).entities), {
      classname: "logic_timer",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBeNull();
    expect(rows[0]!.solidCount).toBe(0);
    expect(rows[0]!.targetname).toBe("bar_2_windows_timer");
    expect(rows[0]!.origin).toBe("0 0 0");
    expect(rows[0]!.outputCount).toBe(2);
    // The outputs are not repeated among the keyvalues: they were moved, not copied.
    expect(rows[0]!.keyvalues["RefireTime"]).toBe("120");
  });
});
