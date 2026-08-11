import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Config } from "../src/config.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { allTools } from "../src/tools/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const PROBE = join(FIXTURES, "hmcp_probe.bsp");

const config = {
  repoRoot: FIXTURES,
  stateDir: join(FIXTURES, ".hammer-mcp"),
  toolAllowlist: [],
} as unknown as Config;

const ctx = {
  config,
  audit: { record: () => undefined },
} as unknown as ToolContext;

function tool(name: string) {
  const t = allTools.find((d) => d.name === name);
  if (!t) throw new Error(`no such tool: ${name}`);
  return t;
}

/**
 * A declared output schema is a promise the SDK enforces at call time: a successful
 * result that does not match it is turned into an error. Calling a handler directly --
 * as the other suites do -- bypasses that check entirely, so a schema could drift from
 * its handler and every test would stay green until an agent actually called the tool.
 *
 * These tests close that gap by parsing real handler output against the declared shape.
 */
describe("declared output schemas match what the handlers return", () => {
  it("read_bsp_info", async () => {
    const def = tool("read_bsp_info");
    expect(def.outputSchema).toBeDefined();
    const result = await def.handler({ path: PROBE, allLumps: false }, ctx);
    expect(() => z.object(def.outputSchema!).parse(result)).not.toThrow();
  });

  it("read_bsp_entities, full page", async () => {
    const def = tool("read_bsp_entities");
    expect(def.outputSchema).toBeDefined();
    const result = await def.handler(
      { path: PROBE, limit: 200, offset: 0, histogramOnly: false },
      ctx,
    );
    expect(() => z.object(def.outputSchema!).parse(result)).not.toThrow();
  });

  it("read_bsp_entities, histogram only", async () => {
    // The shape is conditional: histogramOnly drops three keys. If they were declared
    // required, this call would fail validation in production and never in tests.
    const def = tool("read_bsp_entities");
    const result = await def.handler(
      { path: PROBE, limit: 200, offset: 0, histogramOnly: true },
      ctx,
    );
    expect(() => z.object(def.outputSchema!).parse(result)).not.toThrow();
    expect(result).not.toHaveProperty("entities");
  });

  it("catches a handler that drifts from its declared shape", async () => {
    // The negative control: proves these assertions can fail. Without it, a parse
    // that silently accepted anything would look exactly like a passing test.
    const def = tool("read_bsp_info");
    const result = await def.handler({ path: PROBE, allLumps: false }, ctx);
    const drifted = { ...(result as Record<string, unknown>), mapRevision: "1" };
    expect(() => z.object(def.outputSchema!).parse(drifted)).toThrow();
  });
});
