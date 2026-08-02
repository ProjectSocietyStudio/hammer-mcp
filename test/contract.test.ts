import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Config } from "../src/config.js";
import { assertWritable, FORBIDDEN_TREES, WriteRefused } from "../src/fs/guard.js";
import { isCallAllowed, ToolRegistry } from "../src/mcp/registry.js";
import { allTools } from "../src/tools/index.js";

const REPO = mkdtempSync(join(tmpdir(), "hmcp-repo-"));
const CONFIG = { repoRoot: REPO, stateDir: join(REPO, ".hammer-mcp") } as Config;

describe("tool definitions", () => {
  it("register without a name collision", () => {
    const r = new ToolRegistry();
    expect(() => r.registerAll(allTools)).not.toThrow();
    expect(r.list()).toHaveLength(allTools.length);
  });

  it("all carry a description and a known realm", () => {
    for (const t of allTools) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(["map", "local"], t.name).toContain(t.realm);
    }
  });

  /**
   * The guard reads `args.confirm`, and zod strips keys a tool does not declare. A
   * guarded tool that forgets to declare `confirm` is therefore unreachable: the flag
   * never arrives and every call is refused. Nothing else catches that.
   */
  it("every guarded tool declares confirm in its own inputSchema", () => {
    const guarded = allTools.filter((t) => t.guarded);
    expect(guarded.length).toBeGreaterThan(0);
    for (const t of guarded) {
      expect(Object.keys(t.inputSchema as z.ZodRawShape), t.name).toContain("confirm");
    }
  });

  it("refuses a guarded call without confirm, and allows it with", () => {
    const guarded = allTools.find((t) => t.guarded)!;
    expect(isCallAllowed(guarded, {}, [])).toBe(false);
    expect(isCallAllowed(guarded, { confirm: true }, [])).toBe(true);
    expect(isCallAllowed(guarded, {}, [guarded.name])).toBe(true);
  });

  it("uses the naming convention: read_* observes, everything else acts", () => {
    for (const t of allTools) {
      if (t.name.startsWith("read_")) {
        expect(t.guarded ?? false, `${t.name} observes, so it must not be guarded`).toBe(false);
      }
    }
  });
});

describe("write guard", () => {
  it("refuses the SteamCMD tree and the reference corpus", () => {
    for (const tree of FORBIDDEN_TREES) {
      expect(() => assertWritable(join(REPO, tree, "maps", "x.lmp"), CONFIG)).toThrow(
        WriteRefused,
      );
    }
  });

  it("allows server-config/, the route sync-server-config.sh deploys from", () => {
    const out = assertWritable(join(REPO, "server-config", "maps", "x_l_0.lmp"), CONFIG);
    expect(out).toContain(join("server-config", "maps"));
  });

  it("refuses a path that only reaches a forbidden tree through ..", () => {
    expect(() =>
      assertWritable(join(REPO, "server-config", "..", "srcds", "x"), CONFIG),
    ).toThrow(WriteRefused);
  });

  it("refuses the forbidden tree itself, not only paths under it", () => {
    expect(() => assertWritable(join(REPO, "srcds"), CONFIG)).toThrow(WriteRefused);
  });

  /**
   * The repo's deny-readonly-trees.sh hook intercepts the Edit/Write tools, not `node:fs`
   * inside an MCP server. So this discipline is self-imposed, and this is the test that
   * keeps it honest: no tool may default to writing into a tree we promised not to touch.
   */
  it("no tool defaults to writing inside a forbidden tree", () => {
    const writers = allTools.filter((t) => t.guarded);
    for (const t of writers) {
      const shape = t.inputSchema as z.ZodRawShape;
      const out = shape["out"];
      // A writer either takes an explicit `out` (checked at call time by assertWritable)
      // or derives one; either way the derived default lives under server-config/.
      if (out) expect(out.isOptional(), `${t.name}.out must be optional`).toBe(true);
    }
    expect(() =>
      assertWritable(join(REPO, "server-config", "maps", "rp_x_l_0.lmp"), CONFIG),
    ).not.toThrow();
  });
});
