/**
 * A guarded tool asks permission twice, and `toolAllowlist` used to answer only one of them.
 *
 * `confirm: true` is the server's own gate; `meta["anthropic/requiresUserInteraction"]` is
 * the client's, and no argument satisfies it. An operator who names a tool in
 * `toolAllowlist` has answered the question both gates ask -- in a config file, on purpose
 * -- and was still prompted for every call.
 *
 * Measured: a cold agent building a map was interrupted for a human decision on
 * `write_vmf_solid` dozens of times in one session with the tool allowlisted throughout.
 */
import { describe, expect, it } from "vitest";
import { HUMAN_GATE, preapprove } from "../src/mcp/preapprove.js";
import type { ToolDef } from "../src/mcp/registry.js";
import { allTools } from "../src/tools/index.js";

const tool = (name: string, meta?: Record<string, unknown>): ToolDef =>
  ({ name, description: "", realm: "map", inputSchema: {}, handler: () => ({}), ...(meta ? { meta } : {}) }) as unknown as ToolDef;

describe("preapprove", () => {
  it("drops the human gate for a tool the operator named", () => {
    const out = preapprove([tool("write_vmf_solid", { [HUMAN_GATE]: true })], ["write_vmf_solid"]);
    expect(out[0]!.meta?.[HUMAN_GATE]).toBeUndefined();
  });

  it("leaves every other tool exactly as it was", () => {
    const kept = tool("edit_vmf", { [HUMAN_GATE]: true });
    const out = preapprove([kept], ["write_vmf_solid"]);
    // Identity, not equality: an untouched tool must not even be copied, so nothing
    // downstream can come to depend on a fresh object.
    expect(out[0]).toBe(kept);
    expect(out[0]!.meta?.[HUMAN_GATE]).toBe(true);
  });

  it("changes nothing at all when the allowlist is empty, which is the default", () => {
    const before = allTools.filter((d) => d.meta && HUMAN_GATE in d.meta);
    expect(before.length).toBeGreaterThan(0);
    const after = preapprove(allTools, []);
    for (let i = 0; i < allTools.length; i++) expect(after[i]).toBe(allTools[i]);
  });

  /**
   * The narrowing that makes this safe to ship: it removes the *client's* gate and never
   * touches ours. A tool that refuses without `confirm: true` goes on refusing.
   */
  it("never touches `guarded`", () => {
    const guarded = { ...tool("write_vmf_solid", { [HUMAN_GATE]: true }), guarded: true } as ToolDef;
    const out = preapprove([guarded], ["write_vmf_solid"]);
    expect(out[0]!.guarded).toBe(true);
  });

  it("drops an emptied _meta rather than sending a bare object", () => {
    const out = preapprove([tool("write_vmf_solid", { [HUMAN_GATE]: true })], ["write_vmf_solid"]);
    expect(out[0]!.meta).toBeUndefined();
  });

  it("keeps any other meta key the tool declared", () => {
    const out = preapprove(
      [tool("write_vmf_solid", { [HUMAN_GATE]: true, "x/other": 1 })],
      ["write_vmf_solid"],
    );
    expect(out[0]!.meta).toEqual({ "x/other": 1 });
  });
});
