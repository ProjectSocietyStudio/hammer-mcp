import type { AnyToolDef } from "../mcp/registry.js";
import { healthTools } from "./health.js";

export const allTools: AnyToolDef[] = [...healthTools];
