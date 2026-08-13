/**
 * The first map this toolkit ever built.
 *
 * `hmcp_probe.vmf` is a sealed box that exists to make a compiler agree with a checker.
 * This is a place: a corner shop of two rooms, a counter, shelving and a doorway, built to
 * a written brief by an agent with these tools and nothing else — no text editor, no
 * script, every byte through a tool call. `docs/dogfood/2026-08-13-bodega/` has the brief
 * it was built to and the account of what building it was like.
 *
 * It is a fixture rather than a demo. What it pins is the whole chain at once: a map that
 * seals, satisfies its own rules, and compiles. A regression anywhere between the solid
 * writer and the room pass shows up here as one of these failing.
 *
 * The `step` assertions are the uncomfortable half, and they are here on purpose. This map
 * segments correctly at 32 and not at 16, 8 or 64 — the defect in issue #53 — so the test
 * states the measured behaviour rather than the desired one, and will fail when #53 is
 * fixed. That failure is the point: it is how the fix announces itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { checkVmfRulesTool } from "../src/tools/rules.js";
import { readVmfLeakTool, readVmfRoomsTool } from "../src/tools/scene.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const MAP = join(FIXTURES, "hmcp_bodega.vmf");

const rooms = (step: number) =>
  readVmfRoomsTool.handler(
    { path: MAP, step, maxCells: 4_000_000, minRoomArea: 4096, mergeLimit: 20 } as never,
    ctx,
  ) as unknown as { roomCount: number; portals: unknown[]; unreachable: unknown[] };

describe("hmcp_bodega, the first map built with these tools", () => {
  it("is made of solids the checker accepts", () => {
    const report = checkVmfSolids(MAP, readFileSync(MAP, "utf8"));
    expect(report.solidCount).toBeGreaterThan(0);
    expect(report.validCount).toBe(report.solidCount);
  });

  it("seals", () => {
    const r = readVmfLeakTool.handler(
      { path: MAP, step: 16, maxCells: 4_000_000 } as never,
      ctx,
    ) as unknown as { sealed: boolean };
    expect(r.sealed).toBe(true);
  });

  it("passes every rule of the brief it was built to", () => {
    const r = checkVmfRulesTool.handler(
      {
        path: MAP,
        severity: "all",
        step: 32,
        minRoomArea: 4096,
        maxCells: 4_000_000,
        limit: 100,
      } as never,
      ctx,
    ) as unknown as { overall: string; matchedNothing: string[]; errorCount: number };

    expect(r.overall).toBe("pass");
    expect(r.matchedNothing).toEqual([]);
    expect(r.errorCount).toBe(0);
  });

  /**
   * The measured behaviour, not the desired one.
   *
   * Two rooms and one doorway is what the map is. The pass finds them at a cell size of 32
   * and at no other value tried — 8, 16 and 64 all return one room and no portal, so the
   * response is not even monotone and there is no procedure that finds 32 from either side.
   *
   * Asserting it pins the defect where a reader will meet it, and makes the fix for #53
   * announce itself by breaking this test.
   */
  it("only segments at one cell size, which is the defect in #53", () => {
    expect(rooms(32).roomCount).toBe(2);
    expect(rooms(32).portals).toHaveLength(1);

    for (const step of [8, 16, 64]) {
      expect(rooms(step).roomCount).toBe(1);
      expect(rooms(step).portals).toHaveLength(0);
    }
  });
});
