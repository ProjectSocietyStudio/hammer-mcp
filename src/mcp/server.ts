import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ToolContext, ToolRegistry, ToolResult } from "./registry.js";
import { isCallAllowed } from "./registry.js";

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

export function successResult(result: ToolResult): CallToolResult {
  return textResult(JSON.stringify(result, null, 2));
}

/**
 * Builds the MCP server and wires every tool in the registry into it.
 * Every handler is wrapped with auditing (call/result/error) and a confirmation gate
 * for guarded tools. No tool writes MCP plumbing of its own.
 */
export function createMcpServer(
  registry: ToolRegistry,
  ctx: ToolContext,
  meta: { name: string; version: string },
): McpServer {
  const server = new McpServer({ name: meta.name, version: meta.version });

  for (const def of registry.list()) {
    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: { title: def.name },
      },
      async (args: Record<string, unknown>): Promise<CallToolResult> => {
        const commandId = randomUUID();
        ctx.audit.record({
          kind: "tool_call",
          commandId,
          data: { tool: def.name, realm: def.realm, args },
        });

        if (!isCallAllowed(def, args, ctx.config.toolAllowlist)) {
          const msg = `Guarded tool "${def.name}": pass confirm:true (sensitive action, audited).`;
          ctx.audit.record({
            kind: "tool_result",
            commandId,
            data: { tool: def.name, ok: false, error: msg },
          });
          return textResult(msg, true);
        }

        try {
          const result = await def.handler(args, ctx);
          ctx.audit.record({
            kind: "tool_result",
            commandId,
            data: { tool: def.name, ok: true },
          });
          return successResult(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.audit.record({
            kind: "error",
            commandId,
            data: { tool: def.name, error: message },
          });
          return textResult(`${def.name} failed: ${message}`, true);
        }
      },
    );
  }

  return server;
}
