/**
 * Creating a map, which nothing here could do until now.
 *
 * The gap was found by trying to use this toolkit for its stated purpose: an agent building
 * a map with these tools and nothing else got `ENOENT` from `write_vmf_solid` on the very
 * first call, enumerated all sixty-nine tools, found none that creates a `.vmf`, and had to
 * write a skeleton by hand -- breaking the one rule the exercise was built around.
 *
 * The suite had quietly paid the same cost: `test/build.test.ts` carries a hand-written
 * `SKELETON` constant for exactly this reason.
 *
 * The last test here is the one that matters. Two programs written on the same afternoon
 * agreeing proves less than it looks, so a map created by `write_vmf`, filled by
 * `write_vmf_solid` and by nothing else, is handed to vbsp -- and must seal.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { writeVmfSolidTool } from "../src/tools/build.js";
import { runCompile } from "../src/tools/compile.js";
import { editVmf, writeVmf } from "../src/tools/vmfedit.js";
import { readVmfLeakTool } from "../src/tools/scene.js";
import { DEFAULT_SKYNAME, emptyVmf } from "../src/vmf/skeleton.js";
import { insertSolids } from "../src/vmf/build.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { ctx as sharedCtx, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-skeleton-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const create = (name: string, over: Record<string, unknown> = {}) =>
  writeVmf.handler(
    {
      path: join(scratch, name),
      skyname: DEFAULT_SKYNAME,
      gridSpacing: 64,
      dryRun: false,
      confirm: true,
      ...over,
    } as never,
    ctx,
  ) as unknown as { path: string; written: boolean; bytes: number; skyname: string };

describe("the empty map", () => {
  it("has the five blocks Hammer writes, and a worldspawn", () => {
    const text = emptyVmf();
    for (const block of ["versioninfo", "visgroups", "viewsettings", "world", "cameras"]) {
      expect(text).toMatch(new RegExp(`^${block}$`, "m"));
    }
    expect(text).toMatch(/"classname" "worldspawn"/);
    expect(text).toMatch(/"skyname" "sky_day01_01"/);
  });

  it("carries the sky and grid it was asked for", () => {
    const text = emptyVmf({ skyname: "sky_borealis01", gridSpacing: 16 });
    expect(text).toMatch(/"skyname" "sky_borealis01"/);
    expect(text).toMatch(/"nGridSpacing" "16"/);
  });

  /**
   * The point of the whole file: an empty map is only worth writing if the writer that
   * refused an absent one accepts this. `insertSolids` throws "this file has no `world`
   * block" on anything else, including a zero-byte file.
   */
  it("is accepted by the solid writer that refuses an absent file", () => {
    const r = insertSolids(emptyVmf(), [
      { shape: "box", mins: [-64, -64, 0], maxs: [64, 64, 64] },
    ]);
    expect(r.solidIds).toHaveLength(1);
    const report = checkVmfSolids("built", r.text);
    expect(report.validCount).toBe(report.solidCount);
  });
});

describe("write_vmf", () => {
  it("creates a file that was not there", () => {
    const r = create("fresh.vmf");
    expect(r.written).toBe(true);
    expect(existsSync(r.path)).toBe(true);
    expect(readFileSync(r.path, "utf8")).toBe(emptyVmf());
    expect(r.bytes).toBeGreaterThan(0);
  });

  it("refuses to overwrite, because the alternative is deleting a map", () => {
    const path = join(scratch, "occupied.vmf");
    writeFileSync(path, "hours of work\n");
    expect(() => create("occupied.vmf")).toThrow(/already exists/);
    expect(readFileSync(path, "utf8")).toBe("hours of work\n");
  });

  it("writes nothing on a dry run", () => {
    const r = create("dry.vmf", { dryRun: true });
    expect(r.written).toBe(false);
    expect(existsSync(join(scratch, "dry.vmf"))).toBe(false);
  });
});

/**
 * The compiler oracle, and the exercise that produced this tool, in one test: nothing
 * below touches a file except through a tool call.
 */
describe("a map created and built through tools alone", () => {
  const SHELL = [
    { shape: "box" as const, mins: [-288, -288, -32], maxs: [288, 288, 0] },
    { shape: "box" as const, mins: [-288, -288, 256], maxs: [288, 288, 288] },
    { shape: "box" as const, mins: [-288, -288, 0], maxs: [-256, 288, 256] },
    { shape: "box" as const, mins: [256, -288, 0], maxs: [288, 288, 256] },
    { shape: "box" as const, mins: [-256, -288, 0], maxs: [256, -256, 256] },
    { shape: "box" as const, mins: [-256, 256, 0], maxs: [256, 288, 256] },
  ];

  const build = async (name: string, shell: typeof SHELL): Promise<string> => {
    const { path } = create(name);
    for (const solid of shell) {
      await writeVmfSolidTool.handler(
        {
          path,
          solids: [solid],
          material: "DEV/DEV_MEASUREGENERIC01",
          lightmapScale: 16,
          dryRun: false,
          backup: false,
          confirm: true,
        } as never,
        ctx,
      );
    }
    await editVmf.handler(
      {
        path,
        ops: [
          { op: "add", keyvalues: { classname: "info_player_start", origin: "0 0 16" } },
          {
            op: "add",
            keyvalues: { classname: "light", origin: "0 0 128", _light: "255 255 255 200" },
          },
        ],
        dryRun: false,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    return path;
  };

  it("reads as sealed without a compiler", async () => {
    const path = await build("sealed.vmf", SHELL);
    const r = (await readVmfLeakTool.handler(
      { path, step: 16, maxCells: 4_000_000 } as never,
      ctx,
    )) as unknown as { sealed: boolean };
    expect(r.sealed).toBe(true);
  });

  it("reads as leaking the moment a wall is left out, so the test above means something", async () => {
    const path = await build("holed.vmf", SHELL.slice(0, 5));
    const r = (await readVmfLeakTool.handler(
      { path, step: 16, maxCells: 4_000_000 } as never,
      ctx,
    )) as unknown as { sealed: boolean };
    expect(r.sealed).toBe(false);
  });

  it.skipIf(!has.toolchain)(
    "seals for vbsp too, which was not written here",
    async () => {
      const path = await build("compiled.vmf", SHELL);
      const r = (await runCompile.handler(
        {
          vmf: path,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        } as never,
        ctx,
      )) as { ok: boolean; leaked: boolean; bspExists: boolean };

      expect(r.leaked).toBe(false);
      expect(r.bspExists).toBe(true);
      expect(r.ok).toBe(true);
    },
    300_000,
  );
});
