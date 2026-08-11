import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { pythonPath } from "../src/sidecar/client.js";
import { readVmf, readVmfLint } from "../src/tools/vmf.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PROBE_VMF = join(FIXTURES, "hmcp_probe.vmf");
const REPO = join(FIXTURES, "..", "..", "..");

const config = loadConfig(REPO);
const ctx = { config, audit: { record: () => undefined } } as unknown as ToolContext;
const ready = existsSync(pythonPath(config)) && existsSync(config.gmodBin);

const scratch = mkdtempSync(join(tmpdir(), "hammer-inst-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * A map whose entire contents are one `func_instance` of the probe, plus an output aimed
 * across the instance boundary at a name that only exists after the fixup.
 *
 * Deliberately empty otherwise: whatever the reader finds in it came through the instance
 * machinery, so the probe's own counts are an exact expected value rather than a floor.
 */
function rootMap(name: string, file: string, extra = ""): string {
  const path = join(scratch, `${name}.vmf`);
  writeFileSync(
    path,
    [
      "versioninfo",
      "{",
      '\t"editorversion" "400"',
      '\t"mapversion" "1"',
      '\t"formatversion" "100"',
      '\t"prefab" "0"',
      "}",
      "visgroups",
      "{",
      "}",
      "world",
      "{",
      '\t"id" "1"',
      '\t"mapversion" "1"',
      '\t"classname" "worldspawn"',
      '\t"skyname" "sky_day01_01"',
      "}",
      "entity",
      "{",
      '\t"id" "100"',
      '\t"classname" "func_instance"',
      `\t"file" "${file}"`,
      '\t"targetname" "room"',
      '\t"fixup_style" "0"',
      '\t"origin" "0 0 0"',
      '\t"angles" "0 0 0"',
      "}",
      extra,
      "",
    ].join("\n"),
  );
  return path;
}

interface VmfReply {
  counts: Record<string, number>;
  instances: { requested: boolean; collapsed: number; files?: string[] };
  entities: Array<{ classname: string; targetname: string | null }>;
}

const read = async (path: string, collapseInstances: boolean): Promise<VmfReply> =>
  (await readVmf.handler({ path, limit: 200, collapseInstances }, ctx)) as never;

describe("func_instance", () => {
  if (ready) copyFileSync(PROBE_VMF, join(scratch, "hmcp_probe.vmf"));

  it.skipIf(!ready)("reads as almost nothing when it is left folded", async () => {
    // Not a quirk to work around -- the reason the option exists. One entity where there
    // is a whole building, and zero brushes: a map far past MAX_MAP_BRUSHES would look
    // comfortable, and read_map_geometry could not contradict it because there is no
    // .bsp yet.
    const r = await read(rootMap("folded", "hmcp_probe.vmf"), false);
    expect(r.counts["worldBrushes"]).toBe(0);
    expect(r.counts["brushSides"]).toBe(0);
    expect(r.instances.requested).toBe(false);
    expect(r.instances.collapsed).toBe(0);
  }, 60_000);

  it.skipIf(!ready)("expands to exactly what the instanced map contains", async () => {
    // The oracle: the root file is empty apart from the instance, so collapsing it must
    // reproduce the probe's own counts to the unit. A transform that dropped or
    // duplicated anything would miss.
    const probe = await read(PROBE_VMF, false);
    const collapsed = await read(rootMap("expanded", "hmcp_probe.vmf"), true);

    expect(collapsed.counts).toEqual(probe.counts);
    expect(collapsed.instances.collapsed).toBe(1);
    expect(collapsed.instances.files).toEqual(["hmcp_probe.vmf"]);
  }, 60_000);

  it.skipIf(!ready)("renames what is inside, the way vbsp does", async () => {
    // Two copies of one instance would otherwise share every targetname, and an output
    // aimed at one would fire on both. The prefix style is the Hammer default.
    const r = await read(rootMap("fixup", "hmcp_probe.vmf"), true);
    const named = r.entities.filter((e) => e.targetname);
    expect(named.map((e) => e.targetname)).toEqual(["room-hmcp_probe"]);
  }, 60_000);

  it.skipIf(!ready)("stops accusing outputs that cross into an instance", async () => {
    // The false positive this ends. The output is correct -- room-hmcp_probe is exactly
    // what the entity is called once vbsp has expanded the instance -- but nothing in
    // the root file carries that name, so the lint called it dangling.
    const extra = [
      "entity",
      "{",
      '\t"id" "9001"',
      '\t"classname" "logic_auto"',
      '\t"origin" "0 0 64"',
      "\tconnections",
      "\t{",
      '\t\t"OnMapSpawn" "room-hmcp_probe,Kill,,0,-1"',
      "\t}",
      "}",
    ].join("\n");

    const lint = async (collapseInstances: boolean) =>
      (await readVmfLint.handler(
        { path: rootMap("crossing", "hmcp_probe.vmf", extra), limit: 200, collapseInstances },
        ctx,
      )) as { byRule: Record<string, number> };

    expect((await lint(false)).byRule["output-target-missing"]).toBe(1);
    expect((await lint(true)).byRule["output-target-missing"]).toBeUndefined();
  }, 60_000);

  it.skipIf(!ready)("names the instance file it could not find", async () => {
    // The path comes from inside the map, not from the caller, so a bare FileNotFoundError
    // would be about a path nobody typed.
    await expect(read(rootMap("missing", "no_such_instance.vmf"), true)).rejects.toThrow(
      /instance file not found: no_such_instance\.vmf/,
    );
  }, 60_000);

  it.skipIf(!ready)("refuses a loop instead of recursing until it dies", async () => {
    // An instance that includes itself. Without the depth limit this is an infinite
    // expansion, and the symptom would be the sidecar timing out -- which reads as a
    // broken sidecar rather than as a broken map.
    const loop = join(scratch, "loop.vmf");
    copyFileSync(rootMap("loop-src", "loop.vmf"), loop);
    await expect(read(loop, true)).rejects.toThrow(/loop|nest more than/);
  }, 60_000);
});
