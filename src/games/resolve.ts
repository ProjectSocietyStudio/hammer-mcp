/**
 * Choosing a game profile for one tool call.
 *
 * Two rules hold the whole file together:
 *
 * - **An unknown id throws, naming what does exist.** Falling back to the configured game
 *   would answer a question nobody asked, and the caller would read a lint of Garry's Mod
 *   as a lint of Team Fortress 2.
 * - **Discovery is lazy and memoised.** `loadConfig` stays a file read; scanning Steam
 *   libraries happens the first time a tool actually needs a game.
 */
import { join } from "node:path";
import type { Config } from "../config.js";
import type { GameProfileOverride, ResolvedGame } from "./profile.js";
import { resolveProfiles } from "./profile.js";

export class UnknownGameError extends Error {
  constructor(id: string, known: string[]) {
    super(`unknown game "${id}". Known: ${known.join(", ")}. Run read_source_games to see what is installed.`);
    this.name = "UnknownGameError";
  }
}

export class GameConfigConflict extends Error {
  constructor(legacy: string, modern: string) {
    super(
      `config sets both ${legacy} and ${modern} to different values. They mean the same ` +
        `thing; keep one. ${legacy} is the deprecated spelling.`,
    );
    this.name = "GameConfigConflict";
  }
}

const CACHE = new WeakMap<Config, Record<string, ResolvedGame>>();

/**
 * Turns the legacy top-level fields into an override on the `gmod` profile.
 *
 * These three shipped before profiles existed and are still what every existing config
 * file uses. They keep working. What they must not do is disagree in silence with a
 * `gameProfiles.gmod` block saying something else -- a server that quietly picks one of
 * two conflicting answers is worse than one that refuses.
 */
function legacyOverride(config: Config): GameProfileOverride {
  const modern = (config.gameProfiles ?? {})["gmod"] ?? {};
  const out: GameProfileOverride = {};

  // Reads config.explicit, never config.gmodBin: the latter is computed FROM the profile
  // this function helps build, so touching it here would recurse.
  const e = config.explicit ?? {};
  const pairs: Array<[string, string, string | undefined, string | undefined]> = [
    ["gmodBin", "gameProfiles.gmod.binDir", e.gmodBin, modern.binDir],
    ["gmodGameDir", "gameProfiles.gmod.gameDir", e.gmodGameDir, modern.gameDir],
    [
      "gmodBinPlusPlus",
      "gameProfiles.gmod.plusPlusBinDir",
      e.gmodBinPlusPlus,
      modern.plusPlusBinDir,
    ],
  ];
  for (const [legacyName, modernName, legacyValue, modernValue] of pairs) {
    if (legacyValue === undefined) continue;
    if (modernValue !== undefined && modernValue !== legacyValue) {
      throw new GameConfigConflict(legacyName, modernName);
    }
  }

  if (e.gmodBin !== undefined) out.binDir = e.gmodBin;
  if (e.gmodGameDir !== undefined) out.gameDir = e.gmodGameDir;
  if (e.gmodBinPlusPlus !== undefined) out.plusPlusBinDir = e.gmodBinPlusPlus;
  return out;
}

/** Every profile this machine knows about, resolved once per Config object. */
export function allGames(config: Config): Record<string, ResolvedGame> {
  const cached = CACHE.get(config);
  if (cached) return cached;

  const overrides: Record<string, GameProfileOverride> = { ...(config.gameProfiles ?? {}) };
  const legacy = legacyOverride(config);
  if (Object.keys(legacy).length > 0) {
    overrides["gmod"] = { ...(overrides["gmod"] ?? {}), ...legacy };
  }

  const games = resolveProfiles(overrides);
  CACHE.set(config, games);
  return games;
}

/**
 * The profile a tool call should work against.
 *
 * `id` is what the caller asked for; absent, the configured default is used. `from` lets
 * a tool report which of the two happened, so "this is a TF2 answer" never has to be
 * inferred from the paths.
 */
export function gameFor(
  config: Config,
  id?: string,
): { game: ResolvedGame; from: "argument" | "config" } {
  const games = allGames(config);
  const wanted = id ?? config.game ?? "gmod";
  const game = games[wanted];
  if (!game) throw new UnknownGameError(wanted, Object.keys(games).sort());
  return { game, from: id ? "argument" : "config" };
}

/** The shape every game-aware tool puts in its output. */
export function gameBlock(
  game: ResolvedGame,
  from: "argument" | "config",
): {
  id: string;
  displayName: string;
  branch: string;
  gameDir: string | null;
  binDir: string | null;
  from: "argument" | "config";
} {
  return {
    id: game.id,
    displayName: game.displayName,
    branch: game.branch,
    gameDir: game.gameDir,
    binDir: game.binDir,
    from,
  };
}

/**
 * The FGDs to check a map against, as paths relative to `binDir`.
 *
 * Required ones come from the game's own `gameinfo.txt`. Optional ones are added only
 * when the file is there, and reported either way, so a lint never widens its schema
 * without saying so.
 */
export function fgdNamesFor(game: ResolvedGame, exists: (p: string) => boolean): string[] {
  if (!game.binDir) return [];
  return [
    ...game.fgd,
    ...game.optionalFgd.filter((rel) => exists(join(game.binDir as string, rel))),
  ];
}
