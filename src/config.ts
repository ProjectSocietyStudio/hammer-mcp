import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

const STEAM_GMOD = join(
  homedir(),
  ".steam",
  "steam",
  "steamapps",
  "common",
  "GarrysMod",
);

/**
 * Configuration, loaded from `<repoRoot>/.hammer-mcp/config.json` when present,
 * otherwise defaults. Every field in the file is optional and gets filled in.
 *
 * The Source toolchain lives OUTSIDE the repo, in the Steam library, so its paths are
 * machine-specific by nature. Nothing here may be assumed to exist: every tool that
 * depends on `gmodBin` degrades to a reported reason rather than throwing.
 */
export const ConfigFile = z.object({
  /** Root of the GMod repo (contains tools/, addons/, srcds/). */
  repoRoot: z.string().optional(),
  /**
   * Directory holding hammer.exe, vbsp/vvis/vrad.exe and the .fgd files. These ship
   * with the GMod *client*, not with the dedicated server -- `srcds/bin/` has none of
   * them.
   */
  gmodBin: z.string().default(join(STEAM_GMOD, "bin")),
  /** The `-game` directory the compilers resolve content against. */
  gmodGameDir: z.string().default(join(STEAM_GMOD, "garrysmod")),
  /**
   * How the Windows compilers are executed. Decided by measurement, not preference:
   * plain wine was verified to run vbsp/vvis/vrad here on 02/08/2026 (see README).
   */
  backend: z.enum(["wine", "proton"]).default("wine"),
  /** WINEPREFIX for the `wine` backend. */
  winePrefix: z.string().default(join(homedir(), ".wine")),
  /** Proton entry script, for the `proton` backend. */
  protonPath: z.string().optional(),
  /** Tools allowed without confirmation. Empty means the default policy. */
  toolAllowlist: z.array(z.string()).default([]),
  /** Plugin ESM modules to load, relative to the repo root. Each exports `tools`. */
  plugins: z.array(z.string()).default([]),
});
export type ConfigFile = z.infer<typeof ConfigFile>;

export interface Config extends ConfigFile {
  repoRoot: string;
  /** Runtime state directory: `<repoRoot>/.hammer-mcp`. */
  stateDir: string;
}

/** Markers that identify the root of the GMod repo. */
const REPO_MARKERS = ["tools/lint.sh", "CLAUDE.md"];

function looksLikeRepoRoot(dir: string): boolean {
  return REPO_MARKERS.some((m) => existsSync(join(dir, m)));
}

/** Walks up from `start` until it finds the repo root. */
export function findRepoRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (looksLikeRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the effective configuration. The root is resolved in this order:
 * 1. `HAMMER_MCP_REPO` (env)  2. the file's `repoRoot` field  3. walking up from cwd.
 */
export function loadConfig(cwd: string = process.cwd()): Config {
  const envRoot = process.env.HAMMER_MCP_REPO;

  const probeRoot = envRoot ?? findRepoRoot(cwd) ?? cwd;
  const configPath = join(probeRoot, ".hammer-mcp", "config.json");

  let fromFile: ConfigFile = ConfigFile.parse({});
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    fromFile = ConfigFile.parse(raw);
  }

  const repoRoot = resolveRepoRoot(envRoot, fromFile.repoRoot, probeRoot);
  return {
    ...fromFile,
    repoRoot,
    stateDir: join(repoRoot, ".hammer-mcp"),
  };
}

function resolveRepoRoot(
  envRoot: string | undefined,
  fileRoot: string | undefined,
  fallback: string,
): string {
  const candidate = envRoot ?? fileRoot ?? fallback;
  return isAbsolute(candidate) ? candidate : resolve(fallback, candidate);
}
