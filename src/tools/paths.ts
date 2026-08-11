import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";

/** Resolves a caller-supplied path, relative to the repo root when not absolute. */
export function resolveInput(path: string, config: Config): string {
  return isAbsolute(path) ? path : resolve(config.repoRoot, path);
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
