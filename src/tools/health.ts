import { existsSync } from "node:fs";
import { join } from "node:path";
import { toolchainDir } from "../compile/wine.js";
import { allGames, gameFor } from "../games/resolve.js";
import { defineTool } from "../mcp/registry.js";
import { run } from "../proc/run.js";
import { probeSidecar } from "../sidecar/client.js";
import { VERSION } from "../version.js";

/** The Source tools this server drives, all of them Windows binaries. */
const BINARIES = ["hammer.exe", "vbsp.exe", "vvis.exe", "vrad.exe", "vbspinfo.exe"];
/**
 * Extra .fgd files worth reporting on. The *required* ones are no longer listed here:
 * they come from the active game's own `gameinfo.txt`, so this stays correct for a game
 * nobody here owns.
 */
const EXTRA_FGDS = ["base.fgd", "halflife2.fgd"];

/**
 * The Hammer++ rebuild of the same compilers. Optional, and reported separately rather
 * than merged into the list above: they live in another directory, are x86-64 where the
 * stock ones are i386, and their absence is normal rather than a fault.
 */
const PLUSPLUS = [
  "vbspplusplus.exe",
  "vvisplusplus.exe",
  "vradplusplus.exe",
  "bspzipplusplus.exe",
];

export const health = defineTool({
  name: "health",
  description:
    "State of the toolchain this server depends on: repo root, the GMod bin directory " +
    "(which ships with the client, not with srcds), which compilers and .fgd files are " +
    "present, whether the Wine or Proton backend can be executed, and whether the Python " +
    "sidecar (srctools) is installed. Start here when a tool reports something missing.",
  realm: "local",
  inputSchema: {},
  handler: async (_args, ctx) => {
    const { config } = ctx;
    const binDir = config.gmodBin;
    const binDirExists = existsSync(binDir);

    const wine = await run("wine", ["--version"], { timeoutMs: 10_000 }).catch(() => null);
    const sidecar = await probeSidecar(config);

    // Never throws: health has to stay callable precisely when the configuration is what
    // is wrong. A bad default profile id is reported, not raised.
    let active: ReturnType<typeof gameFor> | null = null;
    let gamesError: string | null = null;
    try {
      active = gameFor(config);
    } catch (e) {
      gamesError = e instanceof Error ? e.message : String(e);
    }
    const profiles = gamesError ? {} : allGames(config);
    const fgdList = [...(active?.game.fgd ?? []), ...EXTRA_FGDS];

    const plusDir = toolchainDir(config, "plusplus", active?.game);
    const plusDirExists = existsSync(plusDir);
    const plusBinaries = Object.fromEntries(
      PLUSPLUS.map((b) => [b, plusDirExists && existsSync(join(plusDir, b))]),
    );

    return {
      version: VERSION,
      repoRoot: config.repoRoot,
      stateDir: config.stateDir,
      auditLog: ctx.audit.path,
      game: gamesError
        ? { error: gamesError, active: null, known: [] }
        : {
            error: null,
            active: {
              id: active!.game.id,
              displayName: active!.game.displayName,
              branch: active!.game.branch,
              gameDir: active!.game.gameDir,
              binDir: active!.game.binDir,
              fgd: active!.game.fgd,
              instancePath: active!.game.instancePath,
              unusableForCompile: active!.game.unusableForCompile,
              // Which values were read off disk and which are built-in guesses. Only one
              // game has ever been run here, so this is not decoration.
              provenance: active!.game.provenance,
            },
            known: Object.entries(profiles).map(([id, g]) => ({
              id,
              displayName: g.displayName,
              installed: g.gameDir !== null,
              usableForCompile: g.unusableForCompile === null,
            })),
          },
      toolchain: {
        gmodBin: binDir,
        present: binDirExists,
        binaries: Object.fromEntries(
          BINARIES.map((b) => [b, binDirExists && existsSync(join(binDir, b))]),
        ),
        fgd: Object.fromEntries(
          fgdList.map((f) => [f, binDirExists && existsSync(join(binDir, f))]),
        ),
        gameDir: config.gmodGameDir,
        gameDirPresent: existsSync(config.gmodGameDir),
      },
      plusplus: {
        dir: plusDir,
        present: plusDirExists,
        binaries: plusBinaries,
        // Reported rather than inferred by the caller: "some of them" is the state that
        // produces a compile which starts and then fails at the second stage.
        usable: Object.values(plusBinaries).every(Boolean),
        note:
          "Optional. Absent is normal: run_compile and run_pack default to the stock " +
          "chain, and only toolchain: 'plusplus' needs these. From tools_plusplus.zip " +
          "(ficool2/misc_tools); they require the x86-64 beta branch of GMod.",
      },
      backend: {
        kind: config.backend,
        winePrefix: config.winePrefix,
        wineVersion: wine?.code === 0 ? wine.stdout.trim() : null,
        protonPath: config.protonPath ?? null,
      },
      sidecar,
      guardedToolsAllowlisted: config.toolAllowlist,
      note:
        "This server never talks to a running srcds and never touches " +
        "srcds/garrysmod/data/gmod_mcp/. Use gmod-mcp for anything live.",
    };
  },
});

export const healthTools = [health];
