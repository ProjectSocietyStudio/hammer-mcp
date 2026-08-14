/**
 * Turning an image into a texture the engine can load.
 *
 * The last hole in "make a material without leaving this server": `read_game_content` finds
 * what the game already has, `run_tga2skybox` builds a cubemap, `run_pack` ships it -- and
 * nothing turned a PNG or a TGA into a `.vtf`. That step lived in a GUI.
 *
 * VTFCmd is the command-line half of ficool2's VTFEdit++, and it is a plain argv tool: no
 * prompts, no "press any key". Two things about driving it were measured on 14/08/2026 and
 * are why this file looks the way it does:
 *
 * * **`-output` fails under wine**, with `System Error: 0x00000003: Path not found`, for a
 *   directory that exists -- short path, long path, trailing separator, all the same. So
 *   the `.vtf` is written beside its source, which is VTFCmd's own default and works.
 * * **`-shader` refuses to write a `.vmt`** unless the texture sits under a `materials/`
 *   folder: `Error creating vmt: texture is not in a ...\materials\ folder.` Reported
 *   rather than worked around -- moving the caller's file to satisfy a tool is not this
 *   server's business.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { readVtfHeader } from "../bsp/vtf.js";
import { runExternalTool } from "../compile/external.js";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { CONFIRM, resolveInput } from "./paths.js";

export const VTFCMD_EXE = "VTFCmd.exe";

/** What DevIL reads. Anything else is refused here rather than failing inside wine. */
const READABLE = [".tga", ".png", ".bmp", ".jpg", ".jpeg", ".gif", ".dds", ".psd"];

export const runVtfConvert = defineTool({
  name: "run_vtf_convert",
  description:
    "Converts an image (.tga, .png, .bmp, .jpg ...) into a .vtf the engine can load, " +
    "written beside the source. The step that used to need a GUI: read_game_content finds " +
    "what the game ships, this makes what it does not. Drives VTFCmd from ficool2's " +
    "VTFEdit++, a separate download; health says whether it is installed. Reads the result " +
    "back and reports its real format and size rather than the ones asked for.",
  realm: "local",
  guarded: true,
  inputSchema: {
    image: z.string().describe("Path to the source image, absolute or relative to the repo root."),
    format: z
      .string()
      .optional()
      .describe(
        "Format for textures with no alpha: DXT1, BGR888, RGBA8888 ... VTFCmd's default " +
          "is DXT1, which is what a wall texture should be.",
      ),
    alphaFormat: z
      .string()
      .optional()
      .describe("Format for textures that have an alpha channel. VTFCmd's default is DXT5."),
    version: z
      .string()
      .optional()
      .describe("VTF version to write, e.g. 7.4. Left alone unless a target needs one."),
    noMipmaps: z
      .boolean()
      .default(false)
      .describe("Skip mipmaps. Right for a UI texture, wrong for anything in the world."),
    flags: z
      .array(z.string())
      .optional()
      .describe("VTF flags to set, e.g. NOLOD, CLAMPS, CLAMPT. Passed through one by one."),
    confirm: CONFIRM,
  },
  outputSchema: {
    image: z.string(),
    vtf: z.string(),
    written: z.boolean(),
    /** Read back from the file: the format that came out, which is not always the one asked for. */
    header: z
      .object({
        version: z.string(),
        width: z.number(),
        height: z.number(),
        cubemap: z.boolean(),
        format: z.string(),
      })
      .nullable(),
    bytes: z.number().nullable(),
    exitCode: z.number().nullable(),
    ok: z.boolean(),
    tool: z.string(),
    stdoutTail: z.string(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const image = resolveInput(args.image, ctx.config);
    if (!existsSync(image)) throw new Error(`${image} does not exist`);

    const ext = extname(image).toLowerCase();
    if (!READABLE.includes(ext)) {
      throw new Error(
        `${ext || "a file with no extension"} is not an image VTFCmd reads. It takes ` +
          `${READABLE.join(", ")} -- and answers anything else with "Error loading input ` +
          `file", which says nothing about which part it disliked.`,
      );
    }

    const vtf = join(dirname(image), `${basename(image, extname(image))}.vtf`);
    assertWritable(vtf, ctx.config);

    // No -output: it fails under wine for a directory that exists (measured 14/08/2026),
    // and VTFCmd's own default is to write beside the source, which works.
    const argv = [
      "-file",
      `Z:${image.replace(/\//g, "\\")}`,
      ...(args.format ? ["-format", args.format] : []),
      ...(args.alphaFormat ? ["-alphaformat", args.alphaFormat] : []),
      ...(args.version ? ["-version", args.version] : []),
      ...(args.noMipmaps ? ["-nomipmaps"] : []),
      ...(args.flags ?? []).flatMap((f) => ["-flag", f]),
    ];

    const run = await runExternalTool(ctx.config, VTFCMD_EXE, argv, { timeoutMs: 300_000 });

    const header = existsSync(vtf) ? readVtfHeader(readFileSync(vtf)) : null;
    const written = header !== null;
    ctx.audit.record({ kind: "file_write", data: { path: vtf, written, created: true } });

    return {
      image,
      vtf,
      written,
      header:
        header === null
          ? null
          : {
              version: header.version,
              width: header.width,
              height: header.height,
              cubemap: header.cubemap,
              format: header.format,
            },
      bytes: written ? statSync(vtf).size : null,
      exitCode: run.code,
      ok: written,
      tool: run.binary,
      stdoutTail: run.stdout.split(/\r?\n/).slice(-20).join("\n").slice(0, 2000),
      note:
        `The format in 'header' is the one that came out. Asking for DXT1 on an image with ` +
        `an alpha channel gives the alpha format instead -- VTFCmd chooses per texture, and ` +
        `reading it back is the only way to know which it took. A .vmt is not written: ` +
        `VTFCmd only does that under a materials/ folder, and read_game_content shows what ` +
        `an existing one looks like.`,
    };
  },
});

export const vtfTools = [runVtfConvert];
