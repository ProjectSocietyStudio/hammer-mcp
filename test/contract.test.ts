import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Config } from "../src/config.js";
import { assertWritable, FORBIDDEN_TREES, WriteRefused } from "../src/fs/guard.js";
import { isCallAllowed, ToolRegistry } from "../src/mcp/registry.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { writeVmfSolidTool } from "../src/tools/build.js";
import { allTools } from "../src/tools/index.js";
import {
  setLightmapScaleTool,
  setSolidClassTool,
  writeHintBrushTool,
} from "../src/tools/optimise.js";
import { editVmf } from "../src/tools/vmfedit.js";
import { FIXTURES } from "./support/env.js";

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

/**
 * The test above checks a property of the schemas. It passed for months while four of the
 * five VMF writers called `writeFileSync` directly and never reached the guard at all --
 * because none of them has a default output path, so there was nothing for it to inspect.
 *
 * This one calls each writer for real, on a map sitting inside the forbidden tree, and
 * requires it to refuse. It fails if the guard is removed from any one of them, which is
 * what "every write goes through it" is supposed to mean.
 */
describe("every VMF writer reaches the guard", () => {
  const ctx = { config: CONFIG, audit: { record: () => {} } } as unknown as ToolContext;
  const inside = join(REPO, "srcds", "garrysmod", "maps", "probe.vmf");
  mkdirSync(join(REPO, "srcds", "garrysmod", "maps"), { recursive: true });
  copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), inside);
  const before = readFileSync(inside, "utf8");

  const calls: Array<[string, () => unknown]> = [
    [
      "write_vmf_solid",
      () =>
        writeVmfSolidTool.handler(
          {
            path: inside,
            solids: [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
            backup: false,
            confirm: true,
          },
          ctx,
        ),
    ],
    [
      "write_hint_brush",
      () =>
        writeHintBrushTool.handler(
          { path: inside, mins: [0, 0, 0], maxs: [64, 64, 8], backup: false, confirm: true },
          ctx,
        ),
    ],
    [
      "set_solid_class",
      () =>
        setSolidClassTool.handler(
          { path: inside, solidIds: [21], to: "func_detail", backup: false, confirm: true },
          ctx,
        ),
    ],
    [
      "set_lightmap_scale",
      () =>
        setLightmapScaleTool.handler(
          { path: inside, scale: 32, all: true, backup: false, confirm: true },
          ctx,
        ),
    ],
    [
      "edit_vmf",
      () =>
        editVmf.handler(
          {
            path: inside,
            // Must really change bytes: a no-op writes nothing, so it would never reach
            // the guard and this test would pass for the wrong reason.
            ops: [{ op: "update", match: { classname: "info_target" }, set: { probe: "1" } }],
            backup: false,
            confirm: true,
          },
          ctx,
        ),
    ],
  ];

  for (const [name, call] of calls) {
    it(`${name} refuses to write into srcds/`, () => {
      expect(call).toThrow(WriteRefused);
      expect(readFileSync(inside, "utf8"), "the map must be untouched").toBe(before);
    });
  }
});

/**
 * #97. A `.vmf` tool handed a `.bsp` used to read the whole file into a string and then
 * fail inside the KeyValues lexer -- `unterminated quoted string at offset 61907
 * (line 43)`, a byte offset into binary, which reads exactly like a defect in the map.
 *
 * The eastcoast audit spent a pass believing that, filed an issue on it, and wrote it into
 * two documents. The map was 79 MB. The one this project actually serves is 1.13 GB, and
 * the first rule in the `source-map` skill is that reading it whole kills the transport.
 *
 * So the contract is behavioural and it is checked against the registry rather than
 * against a list: any tool that says it takes a `.vmf` must refuse a `.bsp` by name. A
 * tool added later gets the check for free, which a hand-written list would not give.
 */
describe("a .vmf tool refuses a compiled map (#97)", () => {
  const BSP = join(FIXTURES, "hmcp_probe.bsp");
  const ctx = { config: CONFIG } as unknown as ToolContext;

  const describes = (t: (typeof allTools)[number], key: string): string => {
    const shape = t.inputSchema as Record<string, { description?: string }> | undefined;
    return shape?.[key]?.description ?? "";
  };

  const vmfTools = allTools.flatMap((t) => {
    for (const key of ["path", "vmf"]) {
      const d = describes(t, key);
      if (d.includes(".vmf") && !d.includes(".bsp")) return [[t, key] as const];
    }
    return [];
  });

  it("finds the .vmf tools to check", () => {
    // If this ever drops to a handful, the detection broke rather than the server.
    expect(vmfTools.length).toBeGreaterThan(25);
  });

  for (const [tool, key] of vmfTools) {
    it(`${tool.name} says it is a compiled map`, async () => {
      const args = { [key]: BSP, confirm: true } as never;
      let message = "";
      try {
        await tool.handler(args, ctx);
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message, `${tool.name} did not refuse`).toMatch(/compiled map/);
      expect(message, `${tool.name} must name a reader that does answer`).toMatch(
        /read_bsp_entities/,
      );
    });
  }
});
