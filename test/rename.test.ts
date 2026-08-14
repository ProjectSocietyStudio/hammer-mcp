/**
 * Renaming a compiled map, and the reason the oracle is not the tool's own output.
 *
 * `bsp_rename` prints `Done!` and exits 0 on a run where it renamed nothing at all. That is
 * not hypothetical: it is what the first working version of this wrapper did, for a full
 * afternoon, because it handed the tool an absolute path. So the assertion here is on the
 * pakfile read back by `read_pakfile` -- a different reader, on the bytes that were written.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { runBspRename } from "../src/tools/rename.js";
import { readPakfile } from "../src/tools/measure.js";
import { ctx as sharedCtx, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-rename-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PROBE = join(process.cwd(), "test", "fixtures", "hmcp_probe.bsp");

/** The packed paths of a .bsp, read by a tool that had nothing to do with writing them. */
const packedIn = async (bsp: string): Promise<string[]> => {
  const r = (await readPakfile.handler({ path: bsp, limit: 50 } as never, ctx)) as unknown as {
    largest: Array<{ name: string }>;
  };
  return r.largest.map((f) => f.name);
};

const rename = async (bsp: string, newName: string): Promise<Record<string, unknown>> =>
  (await runBspRename.handler({ bsp, newName, confirm: true } as never, ctx)) as never;

describe("run_bsp_rename", () => {
  it("refuses a name Source could not resolve", async () => {
    // The name is not decoration: it is what the engine looks packed content up by, and
    // what a console command has to be able to say.
    const bsp = join(scratch, "hmcp_probe.bsp");
    copyFileSync(PROBE, bsp);
    await expect(rename(bsp, "rp bronx/day")).rejects.toThrow(/not a usable map name/);
  });

  it("refuses to overwrite a map that is already there", async () => {
    const bsp = join(scratch, "source.bsp");
    copyFileSync(PROBE, bsp);
    writeFileSync(join(scratch, "taken.bsp"), "hours of work\n");
    await expect(rename(bsp, "taken")).rejects.toThrow(/already exists/);
  });

  it.skipIf(!has.bspRename)("renames the map and the content packed inside it", async () => {
    const dir = mkdtempSync(join(scratch, "run-"));
    const bsp = join(dir, "hmcp_probe.bsp");
    copyFileSync(PROBE, bsp);

    // The probe packs exactly one file, and its path carries the map's name.
    expect(await packedIn(bsp)).toEqual(["materials/maps/hmcp_probe/cubemapdefault.vtf"]);

    const r = await rename(bsp, "rp_probe_renamed");
    expect(r.ok).toBe(true);
    expect(r.renamed).toBe(join(dir, "rp_probe_renamed.bsp"));

    // The whole point, checked by a different reader: the packed path moved with the map.
    expect(await packedIn(r.renamed as string)).toEqual([
      "materials/maps/rp_probe_renamed/cubemapdefault.vtf",
    ]);

    // And the source is untouched -- this creates, it does not rename in place.
    expect(existsSync(bsp)).toBe(true);
    expect(await packedIn(bsp)).toEqual(["materials/maps/hmcp_probe/cubemapdefault.vtf"]);
  }, 120_000);
});
