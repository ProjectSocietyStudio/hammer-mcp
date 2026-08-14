/**
 * Making a cubemap offline, and reading back what was made.
 *
 * The oracle is the `.vtf` header, not the tool's own output: `tga2skybox` prints `Done!`
 * on runs where it wrote nothing usable, the same way every tool on that page does. So the
 * assertion is that a cubemap came out -- `TEXTUREFLAGS_ENVMAP`, the right size, and an HDR
 * companion in a float format -- read from the bytes.
 *
 * The header reader itself is calibrated against files nobody here wrote: the cubemap
 * packed in `hmcp_probe.bsp` and, when the game is installed, the ones in `gm_construct`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readVtfHeader, VTF_ENVMAP } from "../src/bsp/vtf.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { runTga2Skybox, SKY_FACES } from "../src/tools/cubemap.js";
import { ctx as sharedCtx, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-cubemap-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Six flat TGA faces, written by hand.
 *
 * Uncompressed 24-bit true colour, bottom-up -- the plainest thing the format allows, so
 * that a failure is about the tool rather than about an encoder of ours.
 */
function writeFaces(dir: string, base: string, size = 64): void {
  mkdirSync(dir, { recursive: true });
  SKY_FACES.forEach((side, i) => {
    const header = Buffer.alloc(18);
    header.writeUInt8(2, 2); // uncompressed true-colour
    header.writeUInt16LE(size, 12);
    header.writeUInt16LE(size, 14);
    header.writeUInt8(24, 16);
    const pixel = Buffer.from([(i * 40) % 256, (255 - i * 30) % 256, 128]);
    const body = Buffer.alloc(size * size * 3);
    for (let p = 0; p < body.length; p += 3) pixel.copy(body, p);
    writeFileSync(join(dir, `${base}${side}.tga`), Buffer.concat([header, body]));
  });
}

describe("the .vtf header reader", () => {
  it("reads the cubemap packed in the probe map", () => {
    // Extracted by hand once and checked against this: 7.5, 32x32. If the offsets in
    // vtf.ts were wrong, these would not be plausible numbers -- they would be garbage.
    const bytes = readFileSync(join(process.cwd(), "test", "fixtures", "hmcp_probe.bsp"));
    // The pakfile is a plain ZIP inside lump 40; the VTF signature is enough to find the
    // one file it holds without unpacking anything.
    const at = bytes.indexOf(Buffer.from("VTF\0", "latin1"));
    expect(at).toBeGreaterThan(0);
    const h = readVtfHeader(bytes.subarray(at))!;
    expect(h.version).toBe("7.5");
    expect(h.width).toBe(32);
    expect(h.height).toBe(32);
  });

  it("says no on bytes that are not a .vtf at all", () => {
    expect(readVtfHeader(Buffer.from("not a texture"))).toBeNull();
    expect(readVtfHeader(Buffer.alloc(0))).toBeNull();
  });
});

describe("run_tga2skybox", () => {
  it("names every face that is missing, rather than one per run", async () => {
    // The tool stops at the first one it cannot open, so three missing faces would
    // otherwise be three runs to discover.
    const dir = join(scratch, "incomplete");
    writeFaces(dir, "sky_test");
    rmSync(join(dir, "sky_testup.tga"));
    rmSync(join(dir, "sky_testdn.tga"));
    await expect(
      runTga2Skybox.handler({ dir, base: "sky_test", confirm: true } as never, ctx),
    ).rejects.toThrow(/sky_testup\.tga, sky_testdn\.tga/);
  });

  it.skipIf(!has.tga2skybox)("writes a cubemap and its HDR companion", async () => {
    const dir = join(scratch, "build");
    writeFaces(dir, "sky_test");

    const r = (await runTga2Skybox.handler(
      { dir, base: "sky_test", confirm: true } as never,
      ctx,
    )) as unknown as {
      ok: boolean;
      vtf: string;
      hdrVtf: string;
      header: { cubemap: boolean; width: number; format: string };
      hdrHeader: { cubemap: boolean; format: string };
    };

    expect(r.ok).toBe(true);
    expect(existsSync(r.vtf)).toBe(true);
    expect(existsSync(r.hdrVtf)).toBe(true);

    // A cubemap, not a picture: the flag is what the engine reads to decide.
    expect(r.header.cubemap).toBe(true);
    expect(r.header.width).toBe(64);
    expect(readVtfHeader(readFileSync(r.vtf))!.flags & VTF_ENVMAP).toBeTruthy();

    // And the HDR one is a float format -- an LDR copy under an .hdr name would be a map
    // that looks right in one mode and washed out in the other.
    expect(r.hdrHeader.cubemap).toBe(true);
    expect(r.hdrHeader.format).toBe("RGBA16161616F");
  }, 120_000);
});
