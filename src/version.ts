import type { Dirent } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const VERSION = "0.0.0";

/**
 * The newest modification time anywhere below `dir`, in epoch milliseconds.
 *
 * Null when the directory is absent -- which is the answer, not a failure: an installed
 * copy of this server has a `dist/` and no `src/` beside it.
 */
export function newestMtime(dir: string): number | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return null;
  }

  let newest: number | null = null;
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const at = entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs;
    if (at !== null && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

export interface BuildFreshness {
  /** When the build was last written, ISO. Null if there is no build. */
  builtAt: string | null;
  /** When the source was last written, ISO. Null if there is no source tree here. */
  sourceAt: string | null;
  /** True when the build is older than the source. Null when nothing could be compared. */
  stale: boolean | null;
  note: string;
}

const ISO = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * Whether the running build is older than the source it was built from.
 *
 * Worth a function of its own because the failure it catches is silent and points
 * everywhere but at itself. A stale `dist/` does not throw, does not warn, and does not
 * degrade: it serves an older *set of tools*, and every symptom reads as a missing feature.
 * On 13/08/2026 that cost twelve tools -- the whole spatial wave -- and the first suspicion
 * fell on the MCP client.
 *
 * `stale` is deliberately three-valued. Returning false where nothing was compared would be
 * a confident claim about an unasked question, and this repository would rather admit a gap.
 */
export function buildFreshness(distDir: string, srcDir: string): BuildFreshness {
  const built = newestMtime(distDir);
  const source = newestMtime(srcDir);

  if (source === null) {
    return {
      builtAt: ISO(built),
      sourceAt: null,
      stale: null,
      note:
        "There is no source tree beside this build, so nothing was compared. That is normal " +
        "for an installed copy.",
    };
  }
  if (built === null) {
    return {
      builtAt: null,
      sourceAt: ISO(source),
      stale: true,
      note: "There is no build at all. Run `pnpm build`, then reconnect the MCP client.",
    };
  }

  const stale = built < source;
  return {
    builtAt: ISO(built),
    sourceAt: ISO(source),
    stale,
    note: stale
      ? "This build is older than the source beside it, so the server is serving an older " +
        "set of tools than the repository has. Run `pnpm build` -- and then reconnect the " +
        "MCP client, because a client holds the tool list it was given when it connected."
      : "This build is at least as new as the source beside it.",
  };
}
