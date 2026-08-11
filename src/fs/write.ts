/**
 * The one way this server writes a text file it was asked to edit.
 *
 * `assertWritable` describes itself as "the single choke point that makes it auditable:
 * every write in this codebase goes through it". That was not true. `edit_vmf` called it;
 * the four geometry writers -- `write_vmf_solid`, `write_hint_brush`, `set_solid_class`,
 * `set_lightmap_scale` -- called `writeFileSync` directly, so a `.vmf` sitting under
 * `srcds/` or `reference/` was writable by any of them. The contract test that was meant
 * to cover this checks each tool's *default output path*, and these tools have none: the
 * path is always the caller's. So nothing failed, and the guard's own comment was the only
 * thing asserting the property.
 *
 * Making it a function rather than a rule to remember also settles three details that had
 * drifted apart between the five call sites:
 *
 * - **A no-op writes nothing at all**, backup included. Rewriting a file with identical
 *   bytes still moves its mtime, and a mapper's build tooling watches mtimes.
 * - **The backup is taken before the write**, and is itself guarded -- `<file>.bak` lands
 *   next to the original, so it inherits the original's tree.
 * - **A dry run touches nothing**, and says so rather than reporting `written: true`.
 *
 * What this does *not* give you: it is not a defence against a path that escapes a
 * directory. `run_gma_extract` needs that and gets it from a separate check inside the
 * archive reader, where the entry names come from. Two mechanisms, and unifying the writes
 * here does not fold one into the other.
 */
import { copyFileSync, writeFileSync } from "node:fs";
import type { Config } from "../config.js";
import { assertWritable } from "./guard.js";

export interface GuardedWriteOptions {
  /** Run every check and report, but touch nothing. */
  dryRun?: boolean;
  /** Copy the original to `<path>.bak` first. Skipped when there is nothing to write. */
  backup?: boolean;
  /**
   * True when the new text is byte-identical to what is on disk. The caller knows this
   * already -- every VMF write path returns it -- and passing it here keeps the mtime rule
   * in one place instead of five.
   */
  unchanged?: boolean;
}

export interface GuardedWrite {
  /** Absolute, symlink-resolved path that was checked. Empty on a dry run. */
  path: string;
  written: boolean;
  backupPath: string | null;
}

export function writeGuarded(
  path: string,
  text: string,
  config: Config,
  options: GuardedWriteOptions = {},
): GuardedWrite {
  const willWrite = options.dryRun !== true && options.unchanged !== true;
  if (!willWrite) return { path, written: false, backupPath: null };

  const target = assertWritable(path, config);

  let backupPath: string | null = null;
  if (options.backup) {
    backupPath = assertWritable(`${target}.bak`, config);
    copyFileSync(target, backupPath);
  }

  writeFileSync(target, text, "utf8");
  return { path: target, written: true, backupPath };
}
