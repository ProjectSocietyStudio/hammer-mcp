/**
 * Finding the Source games installed on this machine, by reading what Steam and the games
 * themselves already declare.
 *
 * The point of this module is what it refuses to invent. A table of games written by hand
 * would carry a FGD name, a mod directory and a bin directory per game, and every one of
 * those would be an assertion nobody verified. All four are on disk:
 *
 * - `steamapps/libraryfolders.vdf`  -> where the libraries are
 * - `steamapps/appmanifest_<id>.acf` -> appid, display name, install directory, beta branch
 * - `<game>/<mod>/gameinfo.txt`      -> the mod's own name, its SteamAppId, **its FGD**
 *   (`GameData`), and its instance search path
 *
 * All three are Valve KeyValues, the grammar `src/kv/` already lexes for VMFs and entity
 * lumps: bare words, quoted strings and `//` comments. Nothing new needed to read them --
 * verified against the real files on 11/08/2026.
 *
 * What this cannot say is as important: it never claims a binary will run (only gate A
 * proved that, for one game), never guesses an engine branch, and never falls back to
 * another game's `bin/` when one has none.
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { children, get, getAll, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";

/** The compilers a Source toolchain is expected to hold, and what each one is for. */
export const TOOLCHAIN_BINARIES = [
  "vbsp.exe",
  "vvis.exe",
  "vrad.exe",
  "bspzip.exe",
  "vbspinfo.exe",
  "hammer.exe",
] as const;

/** ficool2's rebuild. Installed separately, and absent is the normal case. */
export const PLUSPLUS_BINARIES = [
  "vbspplusplus.exe",
  "vvisplusplus.exe",
  "vradplusplus.exe",
  "bspzipplusplus.exe",
] as const;

export interface SteamApp {
  appId: number;
  /** Steam's display name, from the manifest. */
  name: string;
  /** Directory under `steamapps/common/`. */
  installDir: string;
  /** Absolute path, or null when the manifest exists but the files do not. */
  gameRoot: string | null;
  /** `UserConfig.BetaKey`, e.g. `x86-64` for GMod's 64-bit branch. Null when on stable. */
  betaKey: string | null;
  library: string;
}

export interface ModDir {
  /** Directory name: `garrysmod`, `cstrike`, `tf`. */
  dir: string;
  /** `game` in gameinfo.txt -- what the game calls itself. */
  displayName: string | null;
  /** `FileSystem.SteamAppId`. Can differ from the manifest's appid for a mod. */
  steamAppId: number | null;
  /** `GameData` entries, in declaration order. The FGDs to lint against. */
  fgd: string[];
  /** `InstancePath`, where func_instance files are resolved from. */
  instancePath: string | null;
}

export interface Toolchain {
  dir: string | null;
  binaries: Record<string, boolean>;
  /** True only when every expected binary is there. "Some of them" is its own failure. */
  complete: boolean;
}

export interface SourceInstall {
  app: SteamApp;
  mods: ModDir[];
  stock: Toolchain;
  plusplus: Toolchain;
}

/** Reads a KeyValues file and returns its single root block, or null. */
function readRoot(path: string): KvBlock | null {
  try {
    const nodes = parse(readFileSync(path, "utf8"));
    const root = nodes.find((n): n is KvBlock => n.kind === "block");
    return root ?? null;
  } catch {
    // A malformed manifest is one app we cannot describe, never a reason to report that
    // the machine has no games at all.
    return null;
  }
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Steam installation roots to try.
 *
 * Deduplicated by `realpath`, and that is not a nicety: on Debian and Ubuntu
 * `~/.steam/steam` is a symlink to `~/.steam/debian-installation`, so a lexical
 * comparison finds every game twice.
 */
export function steamRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME ?? homedir();
  const candidates = [
    env.STEAM_ROOT,
    join(home, ".steam", "steam"),
    join(home, ".steam", "root"),
    join(home, ".local", "share", "Steam"),
    join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ].filter((c): c is string => Boolean(c));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (!existsSync(join(c, "steamapps"))) continue;
    const real = realpathOrSelf(c);
    if (seen.has(real)) continue;
    seen.add(real);
    out.push(real);
  }
  return out;
}

/**
 * Library directories declared by a Steam root, including the root itself.
 *
 * `libraryfolders.vdf` nests one numbered block per library, each with a `path`. Steam
 * writes it in two places depending on its version, and leaves `.vdf.N.tmp` files beside
 * it -- only the exact name is read.
 */
export function libraryPaths(steamRoot: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (p: string): void => {
    if (!existsSync(join(p, "steamapps"))) return;
    const real = realpathOrSelf(p);
    if (seen.has(real)) return;
    seen.add(real);
    out.push(real);
  };

  add(steamRoot);
  for (const rel of ["steamapps/libraryfolders.vdf", "config/libraryfolders.vdf"]) {
    const root = readRoot(join(steamRoot, rel));
    if (!root) continue;
    // The blocks are keyed by index ("0", "1", ...), so they cannot be looked up by name.
    for (const node of root.entries) {
      if (node.kind !== "block") continue;
      const p = get(node, "path");
      if (p) add(p);
    }
  }
  return out;
}

/** Every app with a manifest in a library, installed or not. */
export function installedApps(library: string): SteamApp[] {
  const dir = join(library, "steamapps");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }

  const out: SteamApp[] = [];
  for (const name of names) {
    if (!/^appmanifest_\d+\.acf$/.test(name)) continue;
    const root = readRoot(join(dir, name));
    if (!root) continue;

    const appId = Number(get(root, "appid"));
    const installDir = get(root, "installdir");
    if (!Number.isInteger(appId) || !installDir) continue;

    const gameRoot = join(dir, "common", installDir);
    out.push({
      appId,
      name: get(root, "name") ?? installDir,
      installDir,
      gameRoot: existsSync(gameRoot) ? gameRoot : null,
      betaKey: get(children(root, "UserConfig")[0] ?? root, "BetaKey") ?? null,
      library,
    });
  }
  return out.sort((a, b) => a.appId - b.appId);
}

/**
 * Mod directories inside a game root: the depth-1 subdirectories carrying a
 * `gameinfo.txt`. This is what makes a Source game a Source game, and what carries the
 * FGD name that would otherwise have to be hard-coded per game.
 */
export function modDirs(gameRoot: string): ModDir[] {
  let names: string[];
  try {
    names = readdirSync(gameRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const out: ModDir[] = [];
  for (const dir of names) {
    const info = join(gameRoot, dir, "gameinfo.txt");
    if (!existsSync(info)) continue;
    const root = readRoot(info);
    if (!root) continue;

    const fileSystem = children(root, "FileSystem")[0];
    const appId = fileSystem ? Number(get(fileSystem, "SteamAppId")) : Number.NaN;

    out.push({
      dir,
      displayName: get(root, "game") ?? null,
      steamAppId: Number.isInteger(appId) ? appId : null,
      fgd: getAll(root, "GameData"),
      instancePath: get(root, "InstancePath") ?? null,
    });
  }
  return out;
}

function toolchainAt(dir: string | null, expected: readonly string[]): Toolchain {
  if (!dir || !existsSync(dir)) {
    return {
      dir,
      binaries: Object.fromEntries(expected.map((b) => [b, false])),
      complete: false,
    };
  }
  const binaries = Object.fromEntries(expected.map((b) => [b, existsSync(join(dir, b))]));
  return { dir, binaries, complete: Object.values(binaries).every(Boolean) };
}

/**
 * Everything on this machine that looks like a Source game: an installed Steam app whose
 * directory contains at least one mod directory with a `gameinfo.txt`.
 *
 * Apps with a manifest but no files on disk are dropped rather than reported as broken --
 * Steam keeps manifests for things it has not finished downloading.
 */
export function discoverSourceInstalls(env: NodeJS.ProcessEnv = process.env): SourceInstall[] {
  const out: SourceInstall[] = [];
  const seenRoots = new Set<string>();

  for (const steamRoot of steamRoots(env)) {
    for (const library of libraryPaths(steamRoot)) {
      for (const app of installedApps(library)) {
        if (!app.gameRoot || seenRoots.has(app.gameRoot)) continue;
        const mods = modDirs(app.gameRoot);
        if (mods.length === 0) continue;
        seenRoots.add(app.gameRoot);

        const bin = join(app.gameRoot, "bin");
        out.push({
          app,
          mods,
          stock: toolchainAt(existsSync(bin) ? bin : null, TOOLCHAIN_BINARIES),
          // Where the ++ compilers must go for GMod, measured at gate C: they are x86-64
          // where the stock ones are i386. Reported wherever it exists, asserted nowhere.
          plusplus: toolchainAt(join(bin, "win64"), PLUSPLUS_BINARIES),
        });
      }
    }
  }
  return out;
}
