import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/mcp/registry.js";
import { readMapDependenciesTool } from "../src/tools/deps.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.bsp");
const ctx = sharedCtx as unknown as ToolContext;
const shape = z.object(readMapDependenciesTool.outputSchema!);

const run = async (path: string, limit = 3000) =>
  shape.parse(await readMapDependenciesTool.handler({ path, limit }, ctx));

describe.skipIf(!has.sidecar)("read_map_dependencies", () => {
  it("resolves the probe, and finds nothing missing", async () => {
    const out = await run(PROBE);
    expect(out.materialCount).toBeGreaterThan(0);
    expect(out.missing).toEqual([]);
    expect(out.resolved).toBeGreaterThan(0);
  }, 120_000);

  it("says whether the game's content was mounted, rather than assuming it", async () => {
    const out = await run(PROBE);
    expect(typeof out.gameMounted).toBe("boolean");
    // A run with no game content mounted would report every base texture as missing, so
    // the caller has to be able to tell that case apart from a genuinely broken map.
    if (!out.gameMounted) expect(out.gameError).not.toBeNull();
  }, 120_000);

  it("carries the caveat that `game` is not the same answer as `packed`", async () => {
    const out = await run(PROBE);
    expect(out.caveat).toMatch(/mounted/);
    expect(out.caveat).toMatch(/Nothing here is a delete list/);
  }, 120_000);

  it.skipIf(!has.prodMap)(
    "on the production map: resolves ten thousand assets and finds the five real faults",
    async () => {
      const out = await run(paths.prodMap);

      // Measured 11/08/2026. The counts are this map's, not assertions about the tool --
      // what is asserted is the shape: a large map resolves overwhelmingly from its own
      // pakfile, and what is left missing is a handful, not a wall.
      expect(out.gameMounted).toBe(true);
      expect(out.resolved).toBeGreaterThan(10000);
      expect(out.bySource.packed).toBeGreaterThan(out.bySource.game ?? 0);
      expect(out.staticPropModelCount).toBeGreaterThan(800);
      expect(out.missingCount).toBeLessThan(20);

      // The nodegraph this map ships is named rp_nyc1ty_day.ain -- a digit 1 where an i
      // belongs. The engine loads maps/graphs/<mapname>.ain and will never find it.
      const graph = out.missing.find((m: { kind: string }) => m.kind === "nodegraph-name-mismatch");
      expect(graph).toBeDefined();
      expect(graph!.path).toMatch(/\.ain$/);

      // Four textures referenced by model materials and present nowhere: those props draw
      // as a checkerboard for every player, and the map has shipped like that.
      expect(out.missing.filter((m: { kind: string }) => m.kind === "texture").length).toBeGreaterThan(0);
    },
    600_000,
  );

  it.skipIf(!has.prodMap)(
    "does not call vrad's own output unreferenced",
    async () => {
      // The failure this guards: 3983 .vhv files and 273 built cubemaps are named by no
      // material and no model, so a naive walk reports them as dead weight. Deleting them
      // flattens the lighting on every static prop in the map.
      const out = await run(paths.prodMap);
      expect(out.engineOwnedCount).toBeGreaterThan(4000);
      expect(out.packedUnreferenced.some((p: string) => p.endsWith(".vhv"))).toBe(false);
      expect(out.notWalkedCount).toBeGreaterThan(0);
      expect(out.notWalked.every((p: string) => /^(sound|scripts|particles|resource|scenes)\//.test(p))).toBe(
        true,
      );

      // Everything the engine finds by naming convention rather than by reference: the
      // skybox's six sides, the detail sprite config, the level sounds list. Each one is
      // a file no material and no model names, and each would otherwise read as dead
      // weight -- the same mechanism that let the misspelled .ain ship unnoticed.
      const left = out.packedUnreferenced;
      expect(left.some((p: string) => p.startsWith("materials/skybox/"))).toBe(false);
      expect(left.some((p: string) => p.endsWith(".vbsp"))).toBe(false);
      expect(left.some((p: string) => p.endsWith("_level_sounds.txt"))).toBe(false);
    },
    600_000,
  );
});
