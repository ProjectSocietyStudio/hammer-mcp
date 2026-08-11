import { existsSync } from "node:fs";
import { join } from "node:path";
import { toolchainDir } from "../compile/wine.js";
import { defineTool } from "../mcp/registry.js";
import { run } from "../proc/run.js";
import { probeSidecar } from "../sidecar/client.js";
import { VERSION } from "../version.js";

/** The Source tools this server drives, all of them Windows binaries. */
const BINARIES = ["hammer.exe", "vbsp.exe", "vvis.exe", "vrad.exe", "vbspinfo.exe"];
const FGDS = ["base.fgd", "halflife2.fgd", "garrysmod.fgd"];

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

    const plusDir = toolchainDir(config, "plusplus");
    const plusDirExists = existsSync(plusDir);
    const plusBinaries = Object.fromEntries(
      PLUSPLUS.map((b) => [b, plusDirExists && existsSync(join(plusDir, b))]),
    );

    return {
      version: VERSION,
      repoRoot: config.repoRoot,
      stateDir: config.stateDir,
      auditLog: ctx.audit.path,
      toolchain: {
        gmodBin: binDir,
        present: binDirExists,
        binaries: Object.fromEntries(
          BINARIES.map((b) => [b, binDirExists && existsSync(join(binDir, b))]),
        ),
        fgd: Object.fromEntries(
          FGDS.map((f) => [f, binDirExists && existsSync(join(binDir, f))]),
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
