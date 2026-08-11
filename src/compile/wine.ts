import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { run } from "@rolists/mcp-core";
import type { RunResult } from "@rolists/mcp-core";
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
): Promise<CompilerRun> {
  const binary = join(config.gmodBin, exe);
  if (!existsSync(binary)) {
    throw new ToolchainError(
      `${binary} not found. These ship with the GMod client, not with srcds; ` +
        `check gmodBin with the health tool`,
    );
  }
  if (config.backend !== "wine") {
    throw new ToolchainError(
      `backend "${config.backend}" is not implemented; only wine is proven here`,
    );
  }

  const started = Date.now();
  const result = await run("wine", [binary, ...args], {
    cwd: config.gmodBin,
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
