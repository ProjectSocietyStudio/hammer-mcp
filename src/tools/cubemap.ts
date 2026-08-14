/**
 * Building a cubemap without the engine.
 *
 * `buildcubemaps` is a console command: it needs the game running, which is why
 * `docs/hammer-parity.md` lists cubemaps under *the running engine* and hands them to
 * `gmod-mcp`. That is still true for **capturing** a cubemap from inside a map.
 *
 * It is not true for *making* one. ficool2's `tga2skybox` takes six TGA faces and writes a
 * cubemap `.vtf` -- LDR and HDR both -- which is a file this server can then pack into a
 * map like any other asset. So the offline half of the job is reachable after all, and this
 * is it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readVtfHeader } from "../bsp/vtf.js";
import { runExternalTool } from "../compile/external.js";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { CONFIRM, resolveInput } from "./paths.js";

export const TGA2SKYBOX_EXE = "tga2skybox.exe";

/**
 * The six faces, in the order Source names them, plus the sphere the tool also reads.
 *
 * `sph` is optional and the tool says so by carrying on without it -- measured 14/08/2026:
 * a run with only the six prints `Reading testskysph.tga...` and writes both outputs
 * anyway. Listed here so a caller knows it is a thing that exists, not to require it.
 */
export const SKY_FACES = ["rt", "lf", "bk", "ft", "up", "dn"] as const;

const NAME = /^[A-Za-z0-9_\-.]+$/;

export const runTga2Skybox = defineTool({
  name: "run_tga2skybox",
  description:
    "Builds a cubemap .vtf from six TGA faces -- <base>rt.tga, lf, bk, ft, up, dn -- and " +
    "writes both the LDR and the HDR set. This is the one part of cubemap work that does " +
    "NOT need the engine: buildcubemaps captures a cubemap from inside a running map, this " +
    "makes one from images. Drives ficool2's tga2skybox, a separate download; health says " +
    "whether it is installed. Reads and writes only in the directory the faces are in.",
  realm: "local",
  guarded: true,
  inputSchema: {
    dir: z
      .string()
      .describe("Directory holding the six TGA faces. The .vtf files are written here too."),
    base: z
      .string()
      .describe("Name shared by the faces: `sky_x` for sky_xrt.tga ... sky_xdn.tga."),
    confirm: CONFIRM,
  },
  outputSchema: {
    dir: z.string(),
    base: z.string(),
    /** Faces found before running. All six are required; the tool is vague about which. */
    faces: z.array(z.string()),
    vtf: z.string(),
    hdrVtf: z.string(),
    written: z.boolean(),
    /** Read back from the file: what was actually produced, not what was asked for. */
    header: z
      .object({
        version: z.string(),
        width: z.number(),
        height: z.number(),
        cubemap: z.boolean(),
        format: z.string(),
      })
      .nullable(),
    hdrHeader: z
      .object({
        version: z.string(),
        width: z.number(),
        height: z.number(),
        cubemap: z.boolean(),
        format: z.string(),
      })
      .nullable(),
    bytes: z.number().nullable(),
    hdrBytes: z.number().nullable(),
    exitCode: z.number().nullable(),
    ok: z.boolean(),
    tool: z.string(),
    stdoutTail: z.string(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const dir = resolveInput(args.dir, ctx.config);
    if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
    if (!NAME.test(args.base)) {
      throw new Error(
        `"${args.base}" is not a usable base name: it becomes part of a material path, so ` +
          `only letters, digits, _ - and . are accepted`,
      );
    }

    // Checked here rather than left to the tool. It reports a missing face as
    // "Failed to load TGA image xxrt.tga" and then stops, one face at a time -- so a
    // caller with three faces missing learns about them over three runs.
    const faces = SKY_FACES.map((side) => `${args.base}${side}.tga`);
    const missing = faces.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) {
      throw new Error(
        `${missing.length} of the six faces are missing from ${dir}: ${missing.join(", ")}. ` +
          `Source names them rt, lf, bk, ft, up and dn, and all six are required.`,
      );
    }

    const vtf = join(dir, `${args.base}.vtf`);
    const hdrVtf = join(dir, `${args.base}.hdr.vtf`);
    assertWritable(vtf, ctx.config);
    assertWritable(hdrVtf, ctx.config);

    // Interactive, like the rest of these: one prompt for the base name, then the
    // "press any key". Run from the faces' own directory, so the bare base name resolves.
    const run = await runExternalTool(ctx.config, TGA2SKYBOX_EXE, [], {
      stdin: `${args.base}\n\n`,
      where: dir,
      timeoutMs: 300_000,
    });

    const header = existsSync(vtf) ? readVtfHeader(readFileSync(vtf)) : null;
    const hdrHeader = existsSync(hdrVtf) ? readVtfHeader(readFileSync(hdrVtf)) : null;
    const written = header !== null && hdrHeader !== null;

    ctx.audit.record({
      kind: "file_write",
      data: { path: vtf, written, created: true },
    });

    const brief = (h: ReturnType<typeof readVtfHeader>) =>
      h === null
        ? null
        : {
            version: h.version,
            width: h.width,
            height: h.height,
            cubemap: h.cubemap,
            format: h.format,
          };

    return {
      dir,
      base: args.base,
      faces,
      vtf,
      hdrVtf,
      written,
      header: brief(header),
      hdrHeader: brief(hdrHeader),
      bytes: existsSync(vtf) ? statSync(vtf).size : null,
      hdrBytes: existsSync(hdrVtf) ? statSync(hdrVtf).size : null,
      exitCode: run.code,
      // The oracle is the file's own header, read back: `ok` means a cubemap came out,
      // not that the tool said Done -- which it says either way.
      ok: written && header!.cubemap && hdrHeader!.cubemap,
      tool: run.binary,
      stdoutTail: run.stdout.split(/\r?\n/).slice(-20).join("\n").slice(0, 2000),
      note:
        `Two files: the LDR set and the HDR one beside it. Source picks between them by ` +
        `the game's HDR setting, so shipping only one is a map that is right in one mode. ` +
        `Neither is packed yet -- run_pack puts them in a .bsp, and read_map_dependencies ` +
        `says whether anything still references what they replace.`,
    };
  },
});

export const cubemapTools = [runTga2Skybox];
