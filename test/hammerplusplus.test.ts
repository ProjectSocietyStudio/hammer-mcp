import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const scratch = mkdtempSync(join(tmpdir(), "hammer-hpp-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * What Hammer++ writes into a VMF that vanilla Hammer does not.
 *
 * `vertices_plus` carries the exact winding of a face, so vertices stop drifting between
 * sessions; the four root blocks hold editor state -- the colour palette, the colour
 * correction list, the lighting preview settings, the background images. The `plane` line
 * is still written next to `vertices_plus`, which is why the compilers and every other
 * Hammer keep working on the same file.
 */
const SIDE_BLOCK = [
  "\t\t\tvertices_plus",
  "\t\t\t{",
  '\t\t\t\t"v" "-288 288 0"',
  '\t\t\t\t"v" "288 288 0"',
  '\t\t\t\t"v" "288 -288 0"',
  '\t\t\t\t"v" "-288 -288 0"',
  "\t\t\t}",
  "",
].join("\n");

const ROOT_BLOCKS = [
  "palette_plus",
  "{",
  '\t"color0" "255 255 255"',
  '\t"color1" "0 0 0"',
  "}",
  "colorcorrection_plus",
  "{",
  '\t"name0" ""',
  '\t"weight0" "1"',
  "}",
  "light_plus",
  "{",
  '\t"samples_sun" "6"',
  '\t"samples_ambient" "40"',
  '\t"samples_vis" "256"',
  '\t"bounced" "1"',
  '\t"incremental" "1"',
  '\t"ao_scale" "0"',
  "}",
  "bgimages_plus",
  "{",
  "}",
  "",
].join("\n");

/**
 * The Hammer++ twin of the probe map, built from the probe itself rather than checked in
 * beside it: the two can then never drift apart, and the diff between them is exactly the
 * constants above -- which is the whole claim being tested.
 */
function hammerPlusPlusTwin(): string {
  const source = readFileSync(PROBE_VMF, "utf8");
  const anchor = '"smoothing_groups" "0"';
  const at = source.indexOf(anchor);
  expect(at).toBeGreaterThan(-1);
  const lineEnd = source.indexOf("\n", at) + 1;

  const path = join(scratch, "hpp_probe.vmf");
  writeFileSync(path, source.slice(0, lineEnd) + SIDE_BLOCK + source.slice(lineEnd) + ROOT_BLOCKS);
  return path;
}

/** Everything a reader returns except the path, which differs by construction. */
async function readBoth(): Promise<[Record<string, unknown>, Record<string, unknown>]> {
  const strip = (o: Record<string, unknown>): Record<string, unknown> => {
    const { path: _path, ...rest } = o;
    return rest;
  };
  const vanilla = (await readVmf.handler({ path: PROBE_VMF, limit: 200, collapseInstances: false }, ctx)) as never;
  const plus = (await readVmf.handler({ path: hammerPlusPlusTwin(), limit: 200, collapseInstances: false }, ctx)) as never;
  return [strip(vanilla), strip(plus)];
}

describe("a VMF written by Hammer++", () => {
  it.skipIf(!ready)("reads exactly like the vanilla one it was made from", async () => {
    // This compatibility was not designed, it was measured on 11/08/2026 and found to
    // already hold: srctools walks past blocks it does not know. That makes it fragile in
    // the way undesigned properties are -- nothing else in this repo would notice it
    // breaking. Hence this test, which is the only thing standing between a future
    // sidecar change and a Hammer++ user getting silently wrong counts.
    const [vanilla, plus] = await readBoth();
    expect(plus).toEqual(vanilla);
  }, 60_000);

  it.skipIf(!ready)("is not simply being ignored wholesale", async () => {
    // The negative control for the test above. If the twin were unreadable and the
    // sidecar quietly fell back to something empty, the equality would still hold and
    // prove nothing. So: the file on disk must really carry the Hammer++ blocks, and the
    // reader must really have found the map's contents in it.
    const twin = readFileSync(hammerPlusPlusTwin(), "utf8");
    expect(twin).toContain("vertices_plus");
    expect(twin).toContain("light_plus");

    const [, plus] = await readBoth();
    expect((plus["counts"] as { brushSides: number }).brushSides).toBe(36);
    expect((plus["histogram"] as Record<string, number>)["info_player_start"]).toBe(1);
  }, 60_000);

  it.skipIf(!ready)("lints exactly like the vanilla one, and just as quietly", async () => {
    const of = async (path: string) =>
      (await readVmfLint.handler({ path, limit: 500, collapseInstances: false }, ctx)) as {
        total: number;
        byRule: Record<string, number>;
        counts: Record<string, number>;
      };
    const vanilla = await of(PROBE_VMF);
    const plus = await of(hammerPlusPlusTwin());

    expect(plus.total).toBe(vanilla.total);
    expect(plus.byRule).toEqual(vanilla.byRule);
    expect(plus.counts).toEqual(vanilla.counts);
    // Stated separately from the equality: a lint that had started reporting the extra
    // blocks as unknown keyvalues would still be "equal to vanilla" if vanilla broke too.
    expect(plus.total).toBe(0);
  }, 60_000);
});
