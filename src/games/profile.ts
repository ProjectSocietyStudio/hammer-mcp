/**
 * Game profiles: which Source game a tool is working against.
 *
 * A profile is assembled from three layers, in this order, and every value it carries
 * records which layer produced it:
 *
 * 1. **Built-ins** -- only what cannot be read from disk: the Steam appid, the install
 *    directory, the mod directory, and known quirks. Deliberately thin.
 * 2. **Discovery** (`./steam.ts`) -- the absolute paths, the display name, the FGD list,
 *    which binaries exist. Read from Steam's files and the game's own `gameinfo.txt`.
 * 3. **Configuration** -- `gameProfiles.<id>` in `.hammer-mcp/config.json`, plus the
 *    legacy `gmodBin` / `gmodGameDir` / `gmodBinPlusPlus` fields, which keep working and
 *    apply to the `gmod` profile.
 *
 * The `provenance` field is not decoration. Only one game has ever been measured here, so
 * a caller must be able to tell "this FGD name came out of gameinfo.txt" from "this mod
 * directory is a built-in guess nobody has run". A profile that flattened both into a
 * plain string would make the second indistinguishable from the first.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { discoverSourceInstalls } from "./steam.js";
import type { SourceInstall } from "./steam.js";

/**
 * Engine branch. Decides, among other things, which lump-limit table applies.
 *
 * `unknown` is a real value, not a placeholder for laziness: a game we found but cannot
 * classify is readable, and saying so beats asserting a branch to make the type tidy.
 */
export type EngineBranch = "sdk2013" | "orangebox" | "l4d2" | "portal2" | "csgo" | "unknown";

export interface Provenance {
  /** Where the value came from: a file and key, or the layer that supplied it. */
  source: string;
  /** True when a file on this machine was read, or a path was checked to exist. */
  verified: boolean;
}

/** A built-in entry: strictly what discovery cannot produce. */
export interface BuiltinProfile {
  id: string;
  displayName: string;
  steamAppId: number;
  /** Directory under `steamapps/common/`. */
  installDir: string;
  /** The `-game` directory's last component. */
  modDir: string;
  branch: EngineBranch;
  /** Subdirectory of the game root holding the Hammer++ compilers, when known. */
  plusPlusSubdir?: string;
  /** Lua/script entity directories, relative to the repo root. Only GMod has these. */
  scriptedEntityDirs?: string[];
  /** Why anything here is or is not trustworthy. */
  note?: string;
}

export interface ResolvedGame {
  id: string;
  displayName: string;
  branch: EngineBranch;
  steamAppId: number | null;
  /** Root of the install. Null when the game was never found and nothing configured it. */
  gameRoot: string | null;
  /** The `-game` argument. */
  gameDir: string | null;
  /** Where the stock compilers and the .fgd files live. */
  binDir: string | null;
  /** Where the Hammer++ compilers live, when that is known for this game. */
  plusPlusBinDir: string | null;
  /** FGD file names, relative to `binDir`, as the game itself declares them. */
  fgd: string[];
  /** Extra FGDs loaded only when present. */
  optionalFgd: string[];
  /** `InstancePath` from gameinfo.txt, where func_instance files resolve from. */
  instancePath: string | null;
  scriptedEntityDirs: string[];
  /** Non-null when this profile cannot drive a compile, and why. */
  unusableForCompile: string | null;
  provenance: Record<string, Provenance>;
}

/** Per-profile overrides accepted in the config file. */
export const GameProfileOverride = z
  .object({
    gameRoot: z.string(),
    gameDir: z.string(),
    binDir: z.string(),
    plusPlusBinDir: z.string(),
    fgd: z.array(z.string()),
    optionalFgd: z.array(z.string()),
    branch: z.enum(["sdk2013", "orangebox", "l4d2", "portal2", "csgo", "unknown"]),
    modDir: z.string(),
    steamAppId: z.number().int(),
  })
  .partial();
export type GameProfileOverride = z.infer<typeof GameProfileOverride>;

/**
 * The built-in table, kept as small as honesty allows.
 *
 * Only `gmod` has been run here. The others carry appid, install directory and mod
 * directory and **nothing else** -- no FGD name, no lump-limit table, no Hammer++
 * directory. Those three are the kind of fact that is wrong loudly: point `-game` at a
 * directory that does not exist and the compiler says so in one line. An invented FGD
 * name or lump ceiling is wrong silently, which is why none is written here.
 */
export const BUILTIN_PROFILES: readonly BuiltinProfile[] = [
  {
    id: "gmod",
    displayName: "Garry's Mod",
    steamAppId: 4000,
    installDir: "GarrysMod",
    modDir: "garrysmod",
    branch: "sdk2013",
    // Gate C, 11/08/2026: the ++ compilers are x86-64 and go here, where the stock ones
    // are i386 and stay in bin/. Measured, not guessed -- and true for this game only.
    plusPlusSubdir: "bin/win64",
    scriptedEntityDirs: [
      "addons/*/lua/entities",
      "gamemodes/*/entities/entities",
      "srcds/garrysmod/addons/*/lua/entities",
      "srcds/garrysmod/gamemodes/*/entities/entities",
    ],
    note: "The only profile measured on this machine: gates A and C both passed here.",
  },
  {
    id: "css",
    displayName: "Counter-Strike: Source",
    steamAppId: 240,
    installDir: "Counter-Strike Source",
    modDir: "cstrike",
    branch: "sdk2013",
    note: "Never run here. Paths are declared, nothing about its toolchain is verified.",
  },
  {
    id: "hl2",
    displayName: "Half-Life 2",
    steamAppId: 220,
    installDir: "Half-Life 2",
    modDir: "hl2",
    branch: "sdk2013",
    note: "Never run here.",
  },
  {
    id: "tf2",
    displayName: "Team Fortress 2",
    steamAppId: 440,
    installDir: "Team Fortress 2",
    modDir: "tf",
    branch: "orangebox",
    note: "Never run here.",
  },
  {
    id: "l4d2",
    displayName: "Left 4 Dead 2",
    steamAppId: 550,
    installDir: "Left 4 Dead 2",
    modDir: "left4dead2",
    branch: "l4d2",
    note: "Never run here. Its lump ceilings differ from sdk2013 and none has been read.",
  },
  {
    id: "portal2",
    displayName: "Portal 2",
    steamAppId: 620,
    installDir: "Portal 2",
    modDir: "portal2",
    branch: "portal2",
    note: "Never run here. Its lump ceilings differ from sdk2013 and none has been read.",
  },
] as const;

function fromBuiltin(b: BuiltinProfile): ResolvedGame {
  return {
    id: b.id,
    displayName: b.displayName,
    branch: b.branch,
    steamAppId: b.steamAppId,
    gameRoot: null,
    gameDir: null,
    binDir: null,
    plusPlusBinDir: null,
    fgd: [],
    optionalFgd: [],
    instancePath: null,
    scriptedEntityDirs: b.scriptedEntityDirs ?? [],
    unusableForCompile: `${b.displayName} was not found on this machine`,
    provenance: {
      steamAppId: { source: "builtin table", verified: false },
      modDir: { source: "builtin table", verified: false },
      branch: { source: "builtin table", verified: false },
    },
  };
}

/** Fills a profile in from what discovery actually found on disk. */
function applyDiscovery(base: ResolvedGame, b: BuiltinProfile, install: SourceInstall): void {
  const gameRoot = install.app.gameRoot as string;
  const mod =
    install.mods.find((m) => m.dir === b.modDir) ??
    install.mods.find((m) => m.steamAppId === b.steamAppId) ??
    install.mods[0];

  base.gameRoot = gameRoot;
  base.displayName = mod?.displayName ?? install.app.name;
  base.provenance["displayName"] = {
    source: mod?.displayName ? "gameinfo.txt:game" : "appmanifest:name",
    verified: true,
  };

  if (mod) {
    base.gameDir = join(gameRoot, mod.dir);
    base.fgd = mod.fgd;
    base.instancePath = mod.instancePath;
    base.provenance["gameDir"] = { source: "steamapps/common + gameinfo.txt", verified: true };
    base.provenance["fgd"] = { source: "gameinfo.txt:GameData", verified: mod.fgd.length > 0 };
    if (mod.instancePath) {
      base.provenance["instancePath"] = { source: "gameinfo.txt:InstancePath", verified: true };
    }
  }

  base.binDir = install.stock.dir;
  if (install.stock.dir) {
    base.provenance["binDir"] = { source: "steamapps/common/<game>/bin", verified: true };
  }

  // Only where a built-in says where they go. Everywhere else the answer is "unknown",
  // not "probably bin/win64" -- that placement was measured for one game.
  if (b.plusPlusSubdir) {
    const dir = join(gameRoot, b.plusPlusSubdir);
    base.plusPlusBinDir = existsSync(dir) ? dir : null;
    base.provenance["plusPlusBinDir"] = {
      source: `builtin table (${b.plusPlusSubdir}), existence checked`,
      verified: base.plusPlusBinDir !== null,
    };
  }

  base.unusableForCompile = compileBlocker(base);
}

function compileBlocker(g: ResolvedGame): string | null {
  if (!g.gameDir) return `no mod directory found for ${g.id}; nothing to pass as -game`;
  if (!g.binDir) {
    return (
      `${g.displayName} has no bin/ directory. Several Source games ship their compilers ` +
      `in a separate app; point gameProfiles.${g.id}.binDir at them.`
    );
  }
  if (!existsSync(join(g.binDir, "vbsp.exe"))) {
    return (
      `no vbsp.exe in ${g.binDir}. The compilers ship with the game client, never with a ` +
      `dedicated server.`
    );
  }
  return null;
}

function applyOverride(g: ResolvedGame, o: GameProfileOverride, source: string): void {
  const set = <K extends keyof ResolvedGame>(key: K, value: ResolvedGame[K]): void => {
    g[key] = value;
    g.provenance[key as string] = { source, verified: true };
  };
  if (o.gameRoot !== undefined) set("gameRoot", o.gameRoot);
  if (o.gameDir !== undefined) set("gameDir", o.gameDir);
  if (o.binDir !== undefined) set("binDir", o.binDir);
  if (o.plusPlusBinDir !== undefined) set("plusPlusBinDir", o.plusPlusBinDir);
  if (o.fgd !== undefined) set("fgd", o.fgd);
  if (o.optionalFgd !== undefined) set("optionalFgd", o.optionalFgd);
  if (o.branch !== undefined) set("branch", o.branch);
  if (o.steamAppId !== undefined) set("steamAppId", o.steamAppId);
  g.unusableForCompile = compileBlocker(g);
}

/**
 * Resolves every known profile against this machine.
 *
 * Games discovered that match no built-in are returned too, keyed by their mod directory
 * and marked `branch: "unknown"`: readable, and refused for compiles until someone says
 * what branch they are.
 */
export function resolveProfiles(
  overrides: Record<string, GameProfileOverride> = {},
  installs: SourceInstall[] = discoverSourceInstalls(),
): Record<string, ResolvedGame> {
  const byAppId = new Map<number, SourceInstall>();
  for (const i of installs) byAppId.set(i.app.appId, i);

  const out: Record<string, ResolvedGame> = {};
  const claimed = new Set<number>();

  for (const b of BUILTIN_PROFILES) {
    const g = fromBuiltin(b);
    const install = byAppId.get(b.steamAppId);
    if (install) {
      claimed.add(b.steamAppId);
      applyDiscovery(g, b, install);
    }
    out[b.id] = g;
  }

  for (const install of installs) {
    if (claimed.has(install.app.appId)) continue;
    for (const mod of install.mods) {
      const id = mod.dir;
      if (out[id]) continue;
      const gameRoot = install.app.gameRoot as string;
      out[id] = {
        id,
        displayName: mod.displayName ?? install.app.name,
        branch: "unknown",
        steamAppId: mod.steamAppId ?? install.app.appId,
        gameRoot,
        gameDir: join(gameRoot, mod.dir),
        binDir: install.stock.dir,
        plusPlusBinDir: null,
        fgd: mod.fgd,
        optionalFgd: [],
        instancePath: mod.instancePath,
        scriptedEntityDirs: [],
        unusableForCompile:
          `engine branch of ${id} is unknown, so no lump limits apply to it; set ` +
          `gameProfiles.${id}.branch explicitly to compile against it`,
        provenance: {
          displayName: { source: "gameinfo.txt:game", verified: mod.displayName !== null },
          gameDir: { source: "discovered on disk", verified: true },
          fgd: { source: "gameinfo.txt:GameData", verified: mod.fgd.length > 0 },
          branch: { source: "not classified", verified: false },
        },
      };
    }
  }

  for (const [id, o] of Object.entries(overrides)) {
    const g = out[id];
    if (g) applyOverride(g, o, `config: gameProfiles.${id}`);
  }

  return out;
}
