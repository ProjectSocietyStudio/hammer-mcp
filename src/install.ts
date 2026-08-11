import { fileURLToPath } from "node:url";
import { installProject as coreInstall, installReport } from "@projectsociety/mcp-core";
import type { Config } from "./config.js";

/**
 * Absolute path to this server's entry point (dist/index.js), next to this module.
 *
 * Computed here and not in `@projectsociety/mcp-core`: resolving `./index.js` against the shared
 * package would point at mcp-core's own dist, and the installed entry would launch the
 * wrong thing.
 */
function serverEntry(): string {
  return fileURLToPath(new URL("./index.js", import.meta.url));
}

function spec(config: Config) {
  return {
    serverName: "hammer-mcp",
    envVar: "HAMMER_MCP_REPO",
    repoRoot: config.repoRoot,
    entryPath: serverEntry(),
  };
}

/**
 * Merges the hammer-mcp entry into `<repoRoot>/.mcp.json` (project scope, committed and
 * shared). Other declared servers -- gmod-mcp above all -- are preserved.
 */
export function installProject(config: Config): { path: string; entry: unknown } {
  return coreInstall(spec(config));
}

/** Entry point of the `hammer-mcp install` subcommand. */
export function runInstall(config: Config): void {
  const s = spec(config);
  const { path } = coreInstall(s);
  process.stdout.write(
    installReport(s, path, [
      "",
      "Build first: (cd hammer-mcp && pnpm install && pnpm build)",
    ]),
  );
}
