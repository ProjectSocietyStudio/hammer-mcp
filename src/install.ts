import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.js";

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

/** Absolute path to this server's entry point (dist/index.js), next to this module. */
function serverEntry(): string {
  return fileURLToPath(new URL("./index.js", import.meta.url));
}

/**
 * Merges the hammer-mcp entry into `<repoRoot>/.mcp.json` (project scope, committed and
 * shared). Other declared servers -- gmod-mcp above all -- are preserved.
 */
export function installProject(config: Config): { path: string; entry: unknown } {
  const path = join(config.repoRoot, ".mcp.json");
  let current: McpConfig = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as McpConfig;
    } catch {
      current = {};
    }
  }
  const entry = {
    command: "node",
    args: [serverEntry()],
    env: { HAMMER_MCP_REPO: config.repoRoot },
  };
  const next: McpConfig = {
    ...current,
    mcpServers: { ...current.mcpServers, "hammer-mcp": entry },
  };
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  return { path, entry };
}

/** Entry point of the `hammer-mcp install` subcommand. */
export function runInstall(config: Config): void {
  const { path, entry } = installProject(config);
  const e = entry as { args: string[] };
  process.stdout.write(
    [
      `hammer-mcp installed (project scope): ${path}`,
      "",
      "Claude Code will load the server the next time it starts in this repo.",
      'Remember to add "hammer-mcp" to enabledMcpjsonServers in .claude/settings.json.',
      "Command-line equivalent:",
      `  claude mcp add hammer-mcp -e HAMMER_MCP_REPO=${config.repoRoot} -- node ${e.args[0]}`,
      "",
      "Build first: (cd hammer-mcp && pnpm install && pnpm build)",
      "",
    ].join("\n"),
  );
}
