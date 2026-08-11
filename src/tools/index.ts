import type { AnyToolDef } from "../mcp/registry.js";
import { bspTools } from "./bsp.js";
import { compileTools } from "./compile.js";
import { gameTools } from "./games.js";
import { healthTools } from "./health.js";
import { lmpTools } from "./lmp.js";
import { measureTools } from "./measure.js";
import { vmfTools } from "./vmf.js";
import { vmfEditTools } from "./vmfedit.js";

export const allTools: AnyToolDef[] = [
  ...healthTools,
  ...gameTools,
  ...bspTools,
  ...measureTools,
  ...vmfTools,
  ...vmfEditTools,
  ...compileTools,
  ...lmpTools,
];
