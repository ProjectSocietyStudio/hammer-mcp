/**
 * MCP plumbing lives in `@rolists/mcp-core`, shared with gmod-mcp. This module exists so
 * the rest of the server keeps importing a local path, and so the shared server can be
 * swapped or wrapped here without touching every call site.
 */
export { createMcpServer, successResult, type ServerMeta } from "@rolists/mcp-core";
