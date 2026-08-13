import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
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

  /**
   * The gap the tests above still leave: they hand the handler arguments directly, so
   * every optional input is always supplied. In production the SDK parses the caller's
   * arguments through the declared input schema first, and an optional key with no
   * default arrives as `undefined`. A tool that echoes such a key into an output it
   * declares *required* then fails validation on a call that fully succeeded -- the file
   * is written, and the caller is told the call errored.
   *
   * That is not hypothetical: `edit_vmf` did exactly this on 13/08/2026, and the danger
   * was never the error. It was that a caller retrying what looked like a failure would
   * have applied every operation twice.
   *
   * A purely static version of this check was tried first -- "no output key may be
   * required when the input key of the same name is optional with no default" -- and
   * abandoned: it flagged eighteen pairs of which seventeen were correct. `game`,
   * `profile` and `seeds` are optional inputs that the handler *resolves* and reports
   * back, which is the useful thing for them to do. Only a call tells a key that is
   * echoed from one that is resolved, so this calls.
   *
   * It covers one tool, which is the honest scope: the general guard would be a helper
   * that parses arguments through the declared input schema before invoking a handler,
   * and retrofitting the twenty call sites that bypass it is its own piece of work.
   */
  it("edit_vmf survives a caller who omits every optional argument", async () => {
    const def = tool("edit_vmf");
    const path = join(mkdtempSync(join(tmpdir(), "hmcp-schema-")), "probe.vmf");
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), path);

    // The production path, and the whole point of this test: the SDK parses the caller's
    // arguments through the declared input schema before the handler ever sees them.
    const args = z
      .object(def.inputSchema as Record<string, z.ZodTypeAny>)
      .parse({
        path,
        ops: [
          { op: "add", keyvalues: { classname: "info_target", origin: "0 0 32" } },
        ],
        confirm: true,
      });

    const result = await def.handler(args, ctx);
    expect(() => z.object(def.outputSchema!).parse(result)).not.toThrow();
    expect((result as { written: boolean }).written).toBe(true);
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
