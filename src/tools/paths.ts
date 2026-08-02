import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.js";

/** Resolves a caller-supplied path, relative to the repo root when not absolute. */
export function resolveInput(path: string, config: Config): string {
  return isAbsolute(path) ? path : resolve(config.repoRoot, path);
}

/**
 * The confirmation flag every guarded tool declares.
 *
 * The guard reads `args.confirm`, so a guarded tool that forgets to declare it is
 * unreachable: zod strips the key before the handler ever runs. A contract test asserts
 * the pairing rather than trusting it.
 */
export const CONFIRM = z
  .boolean()
  .optional()
  .describe("Required (true) to run this tool: it writes or executes.");
