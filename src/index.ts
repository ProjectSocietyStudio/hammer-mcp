#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { runInstall } from "./install.js";
import { AuditLog } from "./logger.js";
import { ToolRegistry } from "./mcp/registry.js";
import type { ToolContext } from "./mcp/registry.js";
import { createMcpServer } from "./mcp/server.js";

/**
 * Handed to the client at connection time.
 *
 * With tool search, a client no longer loads every tool definition upfront: this prose
 * may be the only thing it reads before deciding whether to look for our tools at all.
 * So it says what the server is FOR and when to reach for it -- not how each tool works,
 * which the tool definitions already carry.
 */
const INSTRUCTIONS = `Offline Source-engine map tooling for the Project Society repo.

Reach for it to: measure a map (extents, entity counts and histogram, lump sizes) --
including a 1 GB shipped .bsp, which it reads by offset in milliseconds rather than
loading whole; inspect or edit a .vmf; change the entities of a compiled map you have no
source for, via an entity-lump patch that needs no recompile; and drive the Windows
compilers under Wine.

Prefer it over reading map files by hand: a .bsp is binary, and a naive full read of the
production map would stall this transport.

Realms: \`map\` is pure file work, \`local\` shells out to a host binary. Tools that write
or execute are guarded and take confirm:true. It never talks to a running game server and
holds no lock -- for cubemaps, nav mesh generation, in-game verification or anything else
needing the live engine, use gmod-mcp.`;
import { allTools } from "./tools/index.js";
import { preapprove } from "./mcp/preapprove.js";
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
  // `toolAllowlist` lifts both of a guarded tool's gates, not just ours -- see
  // `src/mcp/preapprove.ts`. Applied here rather than inside the registry because it is a
  // property of this deployment's configuration, not of the tools.
  registry.registerAll(preapprove(allTools, config.toolAllowlist));

  const ctx: ToolContext = { config, audit, registry };
  const server = createMcpServer(registry, ctx, {
    name: "hammer-mcp",
    version: VERSION,
    instructions: INSTRUCTIONS,
  });

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
