import { closeSync, openSync, readSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";

/** Resolves a caller-supplied path, relative to the repo root when not absolute. */
export function resolveInput(path: string, config: Config): string {
  return isAbsolute(path) ? path : resolve(config.repoRoot, path);
}

/**
 * The first four bytes of a file, or null when it cannot be opened or is shorter.
 *
 * Four bytes, not the file: the point of this whole module is that the map on this
 * project's production server is 1.13 GB and reading it whole kills the transport.
 */
export function magicOf(path: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(4);
    const read = readSync(fd, buf, 0, 4, 0);
    return read === 4 ? buf.toString("latin1") : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Resolves a path a tool will read as a `.vmf`, and refuses a compiled map at the door.
 *
 * Every VMF tool reads its file whole, which is right for a source file and catastrophic
 * for a compiled one: `rp_eastcoast_v4c.bsp` is 79 MB and `rp_nycity_day.bsp` is 1.13 GB,
 * and the second read whole is the hang this server's first rule exists to prevent. Before
 * this check, `read_entity_report` on a BSP read all 79 MB in and then reported
 * `unterminated quoted string at offset 61907 (line 43)` -- a byte offset into binary,
 * which reads exactly like a defect in the file it was given.
 *
 * The check is four bytes and the extension, so it costs nothing and cannot itself be the
 * expensive read it prevents.
 */
export function resolveVmfInput(path: string, config: Config): string {
  const full = resolveInput(path, config);
  const magic = magicOf(full);
  if (magic === "VBSP" || full.toLowerCase().endsWith(".bsp")) {
    throw new Error(
      `${full} is a compiled map, and this tool reads a .vmf. Compiling destroys what a ` +
        `VMF holds -- the structural/func_detail split, hints, visgroups -- so there is no ` +
        `reading of a .bsp that answers a VMF question. For a compiled map use the readers ` +
        `built for one: read_bsp_entities, read_bsp_info, read_map_report, read_prop_survey, ` +
        `read_visleaf_stats. read_entity_report and validate_io take either.`,
    );
  }
  return full;
}

/**
 * The confirmation flag every guarded tool declares.
 *
 * The guard reads `args.confirm`, so a guarded tool that forgets to declare it is
 * unreachable: zod strips the key before the handler ever runs. A contract test asserts
 * the pairing rather than trusting it.
 */
export const CONFIRM = z
  .boolean()
  .optional()
  .describe("Required (true) to run this tool: it writes or executes.");

/**
 * The two flags every tool that edits a file in place declares, and the two fields it
 * reports back.
 *
 * They are here rather than repeated per tool because they had already drifted: `dryRun`
 * was `.default(false)` in one place and `.optional()` in four, and `backup` existed only
 * in `edit_vmf` -- the least destructive of the five, since it cannot touch geometry.
 */
export const DRY_RUN = z
  .boolean()
  .optional()
  .describe("Check and report without writing. Every verification runs either way.");

export const BACKUP = z
  .boolean()
  .default(true)
  .describe("Copy the file to <file>.bak before writing. Nothing is copied on a no-op.");

/** Null unless a backup was actually taken -- a no-op and a dry run both leave it null. */
export const BACKUP_PATH = z.string().nullable();

/**
 * The game profile a call works against. Absent means the configured default.
 *
 * An unknown id is refused, naming the ids that exist -- never resolved to the default.
 * A Garry's Mod answer returned to someone who asked about Team Fortress 2 would be
 * indistinguishable from a correct one.
 */
export const GAME = z
  .string()
  .optional()
  .describe(
    "Game profile id (gmod, css, tf2, ...). Defaults to the configured one. " +
      "read_source_games lists what is installed here.",
  );

/**
 * What every game-aware tool reports back.
 *
 * `from` distinguishes "you asked for this game" from "the configuration chose it", so a
 * caller never has to infer which game an answer describes by reading its paths.
 */
export const GAME_BLOCK = z.object({
  id: z.string(),
  displayName: z.string(),
  branch: z.string(),
  gameDir: z.string().nullable(),
  binDir: z.string().nullable(),
  from: z.enum(["argument", "config"]),
});
