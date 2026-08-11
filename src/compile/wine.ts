import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { run } from "@projectsociety/mcp-core";
import type { RunResult } from "@projectsociety/mcp-core";
import type { Config } from "../config.js";

export class ToolchainError extends Error {}

/**
 * Converts a Linux path to the Windows form the compilers need.
 *
 * Wine maps `Z:` to `/`, so `/home/x` becomes `Z:\home\x`. This is not cosmetic: a
 * relative path is resolved against wine's own working directory, and vbsp then compiles
 * a different file than the one asked for, silently and successfully.
 */
export function toWindowsPath(path: string): string {
  if (!isAbsolute(path)) {
    throw new ToolchainError(
      `${path}: the Source compilers need an absolute path, because a relative one ` +
        `resolves against wine's working directory and quietly compiles the wrong file`,
    );
  }
  return `Z:${path.replace(/\//g, "\\")}`;
}

export interface CompilerRun extends RunResult {
  command: string;
  args: string[];
  durationMs: number;
}

/**
 * Which set of compilers to drive.
 *
 * `stock` is what ships with the GMod client. `plusplus` is ficool2's rebuild of the same
 * SDK 2013 tools -- same inputs, same outputs, faster and with extra flags. They coexist
 * rather than replace each other, and that is the point: comparing a `plusplus` result
 * against the `stock` one on the same source is the only oracle available for judging
 * whether the faster chain changed anything it should not have.
 */
export type Toolchain = "stock" | "plusplus";

/** The compile stages, and the pack step, that both toolchains provide. */
export type CompileStage = "vbsp" | "vvis" | "vrad" | "bspzip";

/**
 * Where a toolchain's binaries live. Measured at gate C, 11/08/2026, and not guessable:
 * the ++ builds are x86-64 and sit in `bin/win64/`, while the stock ones are i386 and sit
 * in `bin/`. `bin/win64/` also holds its own 64-bit stock compilers, and requires the
 * x86-64 beta branch of GMod.
 *
 * `gmodBin` therefore cannot mean both "the compilers" and "the .fgd files" any more: the
 * .fgd files stay in `bin/`.
 */
export function toolchainDir(config: Config, chain: Toolchain): string {
  if (chain === "stock") return config.gmodBin;
  return config.gmodBinPlusPlus ?? join(config.gmodBin, "win64");
}

/** `vbsp.exe` or `vbspplusplus.exe`. One place knows the naming convention. */
export function compilerExe(stage: CompileStage, chain: Toolchain): string {
  return chain === "stock" ? `${stage}.exe` : `${stage}plusplus.exe`;
}

/**
 * Runs one Source compiler under wine.
 *
 * Two settings are load-bearing, both measured rather than guessed (README, gate A):
 * the working directory must be the `bin` folder or `tier0.dll` fails to resolve, and
 * `WINEDEBUG=-all` must be set or stderr is a wall of `fixme:` lines that buries the
 * compiler's own output.
 */
export async function runCompiler(
  config: Config,
  exe: string,
  args: readonly string[],
  timeoutMs: number,
  chain: Toolchain = "stock",
): Promise<CompilerRun> {
  const dir = toolchainDir(config, chain);
  const binary = join(dir, exe);
  if (!existsSync(binary)) {
    throw new ToolchainError(
      chain === "stock"
        ? `${binary} not found. These ship with the GMod client, not with srcds; ` +
          `check gmodBin with the health tool`
        : // Naming the chain matters: without it this reads like a broken GMod install,
          // when in fact the stock compilers are fine and only Hammer++ is absent.
          `${binary} not found: the "plusplus" toolchain is not installed. The four ` +
          `Hammer++ compilers come from tools_plusplus.zip and go in ${dir}; the stock ` +
          `chain is unaffected and remains the default. See health`,
    );
  }
  if (config.backend !== "wine") {
    throw new ToolchainError(
      `backend "${config.backend}" is not implemented; only wine is proven here`,
    );
  }

  const started = Date.now();
  const result = await run("wine", [binary, ...args], {
    cwd: dir,
    timeoutMs,
    env: {
      ...process.env,
      WINEPREFIX: config.winePrefix,
      WINEDEBUG: "-all",
    },
  });

  return {
    ...result,
    command: exe,
    args: [...args],
    durationMs: Date.now() - started,
  };
}
