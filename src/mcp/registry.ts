import type {
  AnyToolDef as CoreAnyToolDef,
  BaseToolContext,
  ToolDef as CoreToolDef,
} from "@projectsociety/mcp-core";
import { makeToolkit, ToolRegistry as CoreToolRegistry } from "@projectsociety/mcp-core";
import type { ZodRawShape } from "zod";
import type { Config } from "../config.js";
import type { AuditLog } from "../logger.js";
import type { Realm } from "../schemas.js";

/**
 * Context injected into every tool handler.
 *
 * Deliberately smaller than gmod-mcp's: there is no bridge and no lock, because this
 * server never talks to a running engine. It must not touch
 * `srcds/garrysmod/data/gmod_mcp/` -- a second reader of that directory deletes the
 * results the gmod-mcp daemon is waiting on.
 */
export interface ToolContext extends BaseToolContext {
  config: Config;
  audit: AuditLog;
  /** The registry itself, for tools that reason about other tools. */
  registry?: ToolRegistry;
}

/** This server's tool definition: map/local realms, no bridge in context. */
export type ToolDef<Shape extends ZodRawShape = ZodRawShape> = CoreToolDef<
  ToolContext,
  Realm,
  Shape
>;

/** Shape-erased version, as stored in the registry. */
export type AnyToolDef = CoreAnyToolDef<ToolContext, Realm>;

/** In-memory tool registry, keyed by name. */
export class ToolRegistry extends CoreToolRegistry<ToolContext, Realm> {}

const toolkit = makeToolkit<ToolContext, Realm>();

/** Preserves type inference at the definition site. */
export const defineTool = toolkit.defineTool;

export { clip, isCallAllowed, type ToolResult } from "@projectsociety/mcp-core";
