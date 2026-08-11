import { z } from "zod";
import { discoverSourceInstalls, libraryPaths, steamRoots } from "../games/steam.js";
import { defineTool } from "../mcp/registry.js";

export const readSourceGames = defineTool({
  name: "read_source_games",
  description:
    "Source games installed on this machine, discovered from Steam's own files rather than " +
    "from a hard-coded table: libraryfolders.vdf for the libraries, appmanifest_*.acf for " +
    "the app, and each mod's gameinfo.txt for its name, its SteamAppId, its .fgd files and " +
    "its instance path. Reports which compilers are present per game, stock and Hammer++. " +
    "Start here to point hammer-mcp at a game other than the configured one.",
  realm: "local",
  inputSchema: {},
  outputSchema: {
    steamRoots: z.array(z.string()).describe("Deduplicated by realpath: ~/.steam/steam is usually a symlink."),
    libraries: z.array(z.string()),
    games: z.array(
      z.object({
        appId: z.number(),
        name: z.string(),
        gameRoot: z.string(),
        betaBranch: z.string().nullable().describe("Steam beta key, e.g. x86-64 for GMod's 64-bit branch."),
        mods: z.array(
          z.object({
            dir: z.string().describe("The -game argument's last component: garrysmod, cstrike, tf."),
            gameDir: z.string().describe("Absolute path to pass as -game."),
            displayName: z.string().nullable(),
            steamAppId: z.number().nullable(),
            fgd: z.array(z.string()).describe("Declared by gameinfo.txt's GameData. Empty means it declares none."),
            instancePath: z.string().nullable(),
          }),
        ),
        toolchain: z.object({
          dir: z.string().nullable(),
          binaries: z.record(z.boolean()),
          complete: z.boolean(),
        }),
        plusplus: z.object({
          dir: z.string().nullable(),
          binaries: z.record(z.boolean()),
          complete: z.boolean(),
        }),
      }),
    ),
    note: z.string(),
  },
  handler: (_args, _ctx) => {
    const roots = steamRoots();
    const libraries = [...new Set(roots.flatMap(libraryPaths))];
    const installs = discoverSourceInstalls();

    return {
      steamRoots: roots,
      libraries,
      games: installs.map((i) => ({
        appId: i.app.appId,
        name: i.app.name,
        gameRoot: i.app.gameRoot as string,
        betaBranch: i.app.betaKey,
        mods: i.mods.map((m) => ({
          dir: m.dir,
          gameDir: `${i.app.gameRoot}/${m.dir}`,
          displayName: m.displayName,
          steamAppId: m.steamAppId,
          fgd: m.fgd,
          instancePath: m.instancePath,
        })),
        toolchain: i.stock,
        plusplus: i.plusplus,
      })),
      note:
        "Presence is read from disk; nothing here claims a binary will run under wine, and " +
        "no engine branch is inferred. A game whose toolchain dir is null simply has no bin/ " +
        "-- several modern Source games ship their tools in a separate app.",
    };
  },
});

export const gameTools = [readSourceGames];
