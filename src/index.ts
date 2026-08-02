#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { runInstall } from "./install.js";
import { AuditLog } from "./logger.js";
import { ToolRegistry } from "./mcp/registry.js";
import type { ToolContext } from "./mcp/registry.js";
import { createMcpServer } from "./mcp/server.js";
import { allTools } from "./tools/index.js";
import { VERSION } from "./version.js";

/**
 * Entry point of the hammer-mcp MCP server (stdio transport, local-first).
 *
 * Offline file tooling for Source maps: VMF, BSP, entity-lump patches and the Windows
 * compilers under Wine. It holds no lock and opens no transport into GMod's data
 * sandbox -- a second reader of `srcds/garrysmod/data/gmod_mcp/` deletes the results the
 * gmod-mcp daemon is waiting on. Anything that needs a running engine belongs there, not
 * here.
 *
 * Launched by Claude Code, so nothing may go to stdout: that is the protocol channel.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  if (process.argv[2] === "install") {
    runInstall(config);
    return;
  }

  const audit = new AuditLog(config.stateDir);
  audit.record({
    kind: "server_start",
    data: { version: VERSION, repoRoot: config.repoRoot, backend: config.backend },
  });

  const registry = new ToolRegistry();
  registry.registerAll(allTools);

  const ctx: ToolContext = { config, audit, registry };
  const server = createMcpServer(registry, ctx, { name: "hammer-mcp", version: VERSION });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `hammer-mcp ${VERSION} ready -- repoRoot=${config.repoRoot} ` +
      `backend=${config.backend} tools=${registry.list().length}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`hammer-mcp: failed to start -- ${message}\n`);
  process.exit(1);
});
