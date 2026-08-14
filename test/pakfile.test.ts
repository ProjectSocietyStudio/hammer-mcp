/**
 * Getting files back out of a map, and the two refusals that make it safe to point at
 * somebody else's map.
 *
 * A pakfile is content that came from wherever the map came from. Its entry names are not
 * ours, so an entry that would land outside the destination is refused rather than
 * sanitised: rewriting `../../x` to `x` extracts a file the caller cannot find by the name
 * they asked for, which is a worse answer than no.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readVtfHeader } from "../src/bsp/vtf.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { runPakfileExtract } from "../src/tools/pakfile.js";
import { ctx as sharedCtx, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-pak-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PROBE = join(process.cwd(), "test", "fixtures", "hmcp_probe.bsp");

interface Extracted {
  matched: number;
  count: number;
  bytes: number;
  written: Array<{ name: string; path: string; bytes: number }>;
  refused: Array<{ name: string; why: string }>;
  skippedOverLimit: number;
}

const extract = async (
  into: string,
  over: Record<string, unknown> = {},
): Promise<Extracted> =>
  (await runPakfileExtract.handler(
    { bsp: PROBE, into, limit: 200, overwrite: false, confirm: true, ...over } as never,
    ctx,
  )) as never;

describe.skipIf(!has.sidecar)("run_pakfile_extract", () => {
  it("writes the file the map carries, under its in-map path", async () => {
    const into = join(scratch, "one");
    const r = await extract(into);

    // The probe packs exactly one file, and read_pakfile has always said so. What is new
    // is that the bytes come out.
    expect(r.matched).toBe(1);
    expect(r.count).toBe(1);
    expect(r.written[0]!.name).toBe("materials/maps/hmcp_probe/cubemapdefault.vtf");
    expect(r.written[0]!.path).toBe(
      join(into, "materials", "maps", "hmcp_probe", "cubemapdefault.vtf"),
    );

    // And they are the real bytes, not an empty file of the right name: the header is a
    // .vtf, read by a reader that knows nothing about pakfiles.
    const h = readVtfHeader(readFileSync(r.written[0]!.path))!;
    expect(h.version).toBe("7.5");
    expect(r.bytes).toBe(r.written[0]!.bytes);
  }, 120_000);

  it("refuses to overwrite, and says which entry it refused", async () => {
    // Not an error: a second extraction into the same directory is a normal thing to do,
    // and the answer is a list of what was left alone rather than a failure.
    const into = join(scratch, "twice");
    await extract(into);
    const again = await extract(into);
    expect(again.count).toBe(0);
    expect(again.refused).toHaveLength(1);
    expect(again.refused[0]!.why).toMatch(/already exists/);

    // With overwrite it goes through.
    const forced = await extract(into, { overwrite: true });
    expect(forced.count).toBe(1);
    expect(forced.refused).toEqual([]);
  }, 180_000);

  it("extracts nothing when the pattern matches nothing, and says so", async () => {
    const r = await extract(join(scratch, "nomatch"), { pattern: "sound/**/*.wav" });
    expect(r.matched).toBe(0);
    expect(r.count).toBe(0);
    expect(r.written).toEqual([]);
  }, 120_000);

  it("leaves a file that is already there alone, byte for byte", async () => {
    // The refusal is about not clobbering, so the check is that the bytes did not move.
    const into = join(scratch, "guard");
    const target = join(into, "materials", "maps", "hmcp_probe", "cubemapdefault.vtf");
    await extract(into);
    writeFileSync(target, "mine\n");
    await extract(into);
    expect(readFileSync(target, "utf8")).toBe("mine\n");
    expect(existsSync(target)).toBe(true);
  }, 180_000);
});
