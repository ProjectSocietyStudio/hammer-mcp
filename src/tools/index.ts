import type { AnyToolDef } from "../mcp/registry.js";
import { bspTools } from "./bsp.js";
import { healthTools } from "./health.js";
import { lmpTools } from "./lmp.js";

export const allTools: AnyToolDef[] = [...healthTools, ...bspTools, ...lmpTools];
