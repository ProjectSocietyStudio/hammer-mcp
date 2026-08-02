import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Config } from "../config.js";

/**
 * Trees this server must never write into, relative to the repo root.
 *
 * `srcds/` is a SteamCMD-managed tree: a `validate` or a branch change replaces files
 * under it, so anything of ours living there is lost without warning. Everything that
 * belongs to us goes to `server-config/` and is deployed by `tools/sync-server-config.sh`.
 * `reference/` is a read-only corpus.
 *
 * The repo's `deny-readonly-trees.sh` hook enforces this for the Edit/Write *tools* --
 * it cannot see `node:fs` calls made inside an MCP server. So this is discipline, not
 * enforcement, and `assertWritable` is the single choke point that makes it auditable:
 * every write in this codebase goes through it, and a contract test asserts that no
 * tool's default output path resolves under a forbidden tree.
 */
export const FORBIDDEN_TREES = ["srcds", "reference"] as const;

export class WriteRefused extends Error {
  constructor(
    readonly path: string,
    readonly tree: string,
  ) {
    super(
      `refusing to write ${path}: it resolves under ${tree}/, which hammer-mcp never writes to. ` +
        `Write to server-config/ instead and deploy with ./tools/sync-server-config.sh.`,
    );
    this.name = "WriteRefused";
  }
}

/**
 * Resolves a path through symlinks as far as it exists.
 *
 * A plain `resolve()` is not enough: `srcds/garrysmod/addons/*` are symlinks created by
 * `new-addon.sh`, so a lexically innocent path can still land inside the SteamCMD tree.
 * The target file usually does not exist yet, so we resolve the nearest existing
 * ancestor and re-append the rest.
 */
function realResolve(path: string): string {
  const abs = resolve(path);
  let dir = abs;
  const tail: string[] = [];
  while (!existsSync(dir)) {
    const parent = dirname(dir);
    if (parent === dir) return abs;
    tail.unshift(dir.slice(parent.length + 1));
    dir = parent;
  }
  return [realpathSync(dir), ...tail].join(sep);
}

/** True when `child` is `parent` itself or sits underneath it. */
function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Throws unless `path` may be written. Call this before every write, without exception --
 * including writes whose path the caller supplied and which look obviously fine.
 *
 * Returns the symlink-resolved absolute path, so callers write to what was actually
 * checked rather than to the string they were handed.
 */
export function assertWritable(path: string, config: Config): string {
  const target = realResolve(path);
  const root = realResolve(config.repoRoot);

  for (const tree of FORBIDDEN_TREES) {
    if (isUnder(target, resolve(root, tree))) throw new WriteRefused(target, tree);
  }
  return target;
}
