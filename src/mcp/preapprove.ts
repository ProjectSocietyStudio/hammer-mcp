/**
 * Honouring `toolAllowlist` in both places a guarded tool asks permission.
 *
 * A guarded tool has two gates, and they belong to different people.
 *
 * `confirm: true` is **ours**: the server refuses the call without it, an agent satisfies
 * it by itself, and its purpose is to make a destructive call deliberate rather than
 * incidental. `meta["anthropic/requiresUserInteraction"]` is the **client's**: it asks for
 * a human, and no argument an agent can pass will satisfy it.
 *
 * `toolAllowlist` used to lift only the first. So an operator who had written a tool down
 * as pre-approved still got a prompt for every call of it -- which is not a stricter
 * reading of their intent, it is a contradiction of it: they have already answered the
 * question the prompt asks, in a config file, on purpose.
 *
 * Found the hard way. A cold agent building a map through this server was interrupted for
 * a human decision on `write_vmf_solid` several dozen times in a session, with the tool
 * named in the allowlist the whole time, because the two gates did not agree about what
 * that list meant.
 *
 * The narrowing matters: this only ever *removes* the human gate, only for tools the
 * operator named, and it leaves `guarded` and `confirm` exactly as they were. A tool not
 * on the list keeps both gates, which stays the default for everything.
 */
import type { ToolDef } from "./registry.js";

/** The client-side flag that asks for a human regardless of what an agent passes. */
export const HUMAN_GATE = "anthropic/requiresUserInteraction";

/**
 * The tools as the client should see them, given what the operator has pre-approved.
 *
 * Returns the same definitions untouched when nothing is allowlisted, which is the common
 * case and the one worth not paying for.
 */
export function preapprove<T extends ToolDef>(tools: readonly T[], allowlist: readonly string[]): T[] {
  if (allowlist.length === 0) return [...tools];
  const allowed = new Set(allowlist);

  return tools.map((def) => {
    if (!allowed.has(def.name) || !def.meta || !(HUMAN_GATE in def.meta)) return def;
    const meta = { ...def.meta };
    delete meta[HUMAN_GATE];
    // An empty `_meta` is dropped rather than sent: an object with no keys says nothing,
    // and a client is entitled to read its presence as meaningful.
    return { ...def, ...(Object.keys(meta).length > 0 ? { meta } : { meta: undefined }) };
  });
}
