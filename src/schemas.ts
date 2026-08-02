import { z } from "zod";

/**
 * Where a tool does its work.
 *
 * `map` -- offline file work on a VMF, a BSP or a lump patch. Pure Node, no engine.
 * `local` -- shells out to a host binary (the Source compilers, under Wine).
 *
 * Deliberately NOT gmod-mcp's `sv`/`cl`: this server has no GLua realm and never
 * speaks to a running srcds. Anything needing the live engine belongs in gmod-mcp.
 */
export const Realm = z.enum(["map", "local"]);
export type Realm = z.infer<typeof Realm>;

/** A problem found in a map, a VMF or a compile log. */
export interface Finding {
  severity: "error" | "warning" | "info";
  /** Short stable identifier for the check that produced this, e.g. `duplicate-targetname`. */
  rule: string;
  message: string;
  /** The addon that cares, when the finding comes from a repo requirement. */
  owner?: string;
  file?: string;
  line?: number;
  /** VMF/BSP entity id, when the finding is about one entity. */
  entityId?: number;
  classname?: string;
}
