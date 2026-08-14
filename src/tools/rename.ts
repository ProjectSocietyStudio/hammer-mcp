/**
 * Renaming a compiled map, with the content packed inside it.
 *
 * A `.bsp` carries its own name in more places than its filename: the pakfile holds
 * `maps/<name>.*` entries -- the nodegraph, the cubemap patches, the soundscript, the
 * particle manifest -- and the engine looks those up by the name of the map it is loading.
 * Rename the file and they are all orphaned, silently, with the symptoms landing in game
 * rather than in any compiler output.
 *
 * `read_map_dependencies` already finds one of those on the production map:
 * `maps/graphs/rp_nyc1ty_day.ain` packed into `rp_nycity_day.bsp` -- a nodegraph nothing
 * will ever load, in a map that ships and runs daily. That is the defect this tool exists
 * to avoid making, and it does it with ficool2's `bsp_rename`, which rewrites the pakfile
 * entries and the texture table rather than only the filename.
 */
import { existsSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import { runExternalTool } from "../compile/external.js";
import { defineTool } from "../mcp/registry.js";
import { assertWritable } from "../fs/guard.js";
import { CUBEMAP2HDR_EXE, TGA2SKYBOX_EXE } from "./cubemap.js";
import { VTFCMD_EXE } from "./vtf.js";
import { CONFIRM, resolveInput } from "./paths.js";

/** The tool's own filename, as its author ships it. */
export const BSP_RENAME_EXE = "bsp_rename.exe";

/** What Source will accept as a map name, and what the tool writes as a filename. */
const NAME = /^[A-Za-z0-9_\-.]+$/;

export const runBspRename = defineTool({
  name: "run_bsp_rename",
  description:
    "Renames a compiled .bsp AND the content packed inside it -- the nodegraph, cubemap " +
    "patches, soundscripts, anything under maps/<name>/. Renaming the file alone orphans " +
    "every one of them: the engine looks them up by the map's name, finds nothing, and " +
    "says nothing, so the symptom is Nextbots that will not path or a missing soundscape " +
    "rather than an error. Drives ficool2's bsp_rename, which is a separate download; " +
    "health says whether it is installed. Writes a NEW .bsp beside the old one and leaves " +
    "the original alone.",
  realm: "local",
  guarded: true,
  inputSchema: {
    bsp: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    newName: z
      .string()
      .describe("The new map name, without the .bsp suffix. Letters, digits, _ - . only."),
    confirm: CONFIRM,
  },
  outputSchema: {
    bsp: z.string(),
    /** The file that was written. Never the input: this tool does not overwrite. */
    renamed: z.string(),
    newName: z.string(),
    written: z.boolean(),
    bytesBefore: z.number(),
    bytesAfter: z.number().nullable(),
    exitCode: z.number().nullable(),
    timedOut: z.boolean(),
    /** True only when the new file exists. The tool's exit code alone does not say so. */
    ok: z.boolean(),
    tool: z.string(),
    stdoutTail: z.string(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const bsp = resolveInput(args.bsp, ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);
    if (extname(bsp).toLowerCase() !== ".bsp") throw new Error(`${bsp} is not a .bsp`);

    const newName = args.newName.replace(/\.bsp$/i, "");
    if (!NAME.test(newName)) {
      throw new Error(
        `"${newName}" is not a usable map name: Source resolves a map by this string in ` +
          `paths, console commands and packed asset names, so only letters, digits, _ - ` +
          `and . are accepted here`,
      );
    }

    // The tool writes beside its input, under the new name. Both the write and the refusal
    // to overwrite are ours to enforce: bsp_rename itself will happily replace a file.
    const renamed = join(dirname(bsp), `${newName}.bsp`);
    if (existsSync(renamed)) {
      throw new Error(
        `${renamed} already exists. This tool only creates: delete it yourself if you mean ` +
          `to replace it. The source map is never modified either way.`,
      );
    }
    assertWritable(renamed, ctx.config);

    const bytesBefore = statSync(bsp).size;

    // Interactive by design -- written for a person dragging a file onto it. The three
    // lines are its two prompts and the "press any key" that follows, and feeding them is
    // the whole reason this is drivable at all.
    //
    // The BARE FILENAME, run from the map's own directory, and this is not a style choice.
    // Measured 14/08/2026, and confirmed in bsp_rename.c: it derives the old map name with
    // `strrchr(name, '/')`, which returns a pointer AT the separator rather than past it,
    // so a path makes it search the pakfile for `materials/maps/\hmcp_probe/`. Nothing
    // matches, nothing is renamed -- and it still prints "Done!" and exits 0. A rename
    // that silently renames nothing is exactly the failure this tool exists to prevent.
    const answers = `${basename(bsp)}\n${newName}\n\n`;
    const run = await runExternalTool(ctx.config, BSP_RENAME_EXE, [], {
      stdin: answers,
      // The map's own directory: the filename above is relative to it, and it is also
      // where the tool writes its result.
      where: dirname(bsp),
      timeoutMs: 600_000,
    });

    const written = existsSync(renamed);
    ctx.audit.record({
      kind: "file_write",
      data: { path: renamed, from: bsp, written, created: true },
    });

    return {
      bsp,
      renamed,
      newName,
      written,
      bytesBefore,
      bytesAfter: written ? statSync(renamed).size : null,
      exitCode: run.code,
      timedOut: run.timedOut,
      // The oracle is the file, not the exit code: this tool prints "Done!" and exits 0
      // on paths it could not read, so a code alone would report a rename that never
      // happened.
      ok: written,
      tool: run.binary,
      stdoutTail: run.stdout.split(/\r?\n/).slice(-20).join("\n").slice(0, 2000),
      note:
        `The original is untouched at ${bsp}. What this changed inside the new file is the ` +
        `packed content named after the map; what it cannot change is anything that names ` +
        `the map from outside it -- a server config, a workshop entry, a nav mesh. ` +
        `read_map_dependencies on the result says whether anything is still looking for ` +
        `the old name, and read_nav says whether the mesh beside it still matches.`,
    };
  },
});

/**
 * Reported by health, so an absent tool is a state rather than a surprise at call time.
 *
 * Lives here rather than beside each tool because health needs one list, and a list
 * assembled from several modules is one a new tool can be left out of in silence.
 */
export const externalTools = [
  { exe: BSP_RENAME_EXE, tool: "run_bsp_rename" },
  { exe: TGA2SKYBOX_EXE, tool: "run_tga2skybox" },
  { exe: CUBEMAP2HDR_EXE, tool: "run_cubemap2hdr" },
  { exe: VTFCMD_EXE, tool: "run_vtf_convert" },
] as const;

export const renameTools = [runBspRename];
