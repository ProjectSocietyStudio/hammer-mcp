/**
 * Making a texture out of an image.
 *
 * The assertion that matters is not "a file appeared" but *what came out*: VTFCmd chooses
 * between `-format` and `-alphaformat` per texture, so asking for DXT1 on an image with an
 * alpha channel gives DXT5. Reading the header back is the only way to know which it took,
 * and a tool that reported the format it was asked for would be lying half the time.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { runVtfConvert } from "../src/tools/vtf.js";
import { ctx as sharedCtx, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-vtf-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A TGA with an alpha channel, top-down, uncompressed: the plainest DevIL will read. */
function writeTga(path: string, size = 64, bpp: 24 | 32 = 32): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const header = Buffer.alloc(18);
  header.writeUInt8(2, 2);
  header.writeUInt16LE(size, 12);
  header.writeUInt16LE(size, 14);
  header.writeUInt8(bpp, 16);
  header.writeUInt8(bpp === 32 ? 0x28 : 0x20, 17);
  const channels = bpp / 8;
  const body = Buffer.alloc(size * size * channels);
  for (let p = 0; p < body.length; p += channels) {
    body[p] = 64;
    body[p + 1] = 128;
    body[p + 2] = 192;
    if (channels === 4) body[p + 3] = 255;
  }
  writeFileSync(path, Buffer.concat([header, body]));
}

interface Converted {
  ok: boolean;
  vtf: string;
  header: { version: string; width: number; height: number; format: string; cubemap: boolean };
  bytes: number;
}

const convert = async (image: string, over: Record<string, unknown> = {}): Promise<Converted> =>
  (await runVtfConvert.handler(
    { image, noMipmaps: false, confirm: true, ...over } as never,
    ctx,
  )) as never;

describe("run_vtf_convert", () => {
  it("refuses a file VTFCmd cannot read, naming what it does read", async () => {
    // Its own answer is "Error loading input file", which says nothing about which part
    // it disliked -- and it says it after the process has started under wine.
    const notAnImage = join(scratch, "notes.txt");
    writeFileSync(notAnImage, "this is not a texture\n");
    await expect(convert(notAnImage)).rejects.toThrow(/not an image VTFCmd reads/);
  });

  it.skipIf(!has.vtfcmd)("writes a .vtf beside the image, and reports what came out", async () => {
    const image = join(scratch, "wall.tga");
    writeTga(image);

    const r = await convert(image, { format: "DXT1" });
    expect(r.ok).toBe(true);
    expect(r.vtf).toBe(join(scratch, "wall.vtf"));
    expect(r.header.width).toBe(64);
    expect(r.header.height).toBe(64);
    expect(r.header.cubemap).toBe(false);

    // DXT1 was asked for. The image has an alpha channel, so VTFCmd used the alpha
    // format instead -- which is exactly why the header is read back rather than echoed.
    expect(r.header.format).toBe("DXT5");
    expect(r.bytes).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(!has.vtfcmd)("takes the plain format when there is no alpha to preserve", async () => {
    // The other half of the same claim: with a 24-bit source, `-format` is what applies.
    const image = join(scratch, "opaque.tga");
    writeTga(image, 64, 24);
    const r = await convert(image, { format: "DXT1" });
    expect(r.ok).toBe(true);
    expect(r.header.format).toBe("DXT1");
  }, 120_000);
});
