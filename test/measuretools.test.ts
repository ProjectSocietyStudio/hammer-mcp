import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import {
  measureVmfApproachTool,
  measureVmfClearanceTool,
  readVmfSightlinesTool,
} from "../src/tools/measurespace.js";
import { applyVmfOps } from "../src/vmf/edit.js";
import { ctx as sharedCtx } from "./support/env.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const ctx = sharedCtx as unknown as ToolContext;
const dir = mkdtempSync(join(tmpdir(), "hammer-measure-"));

const MAP = join(dir, "rooms.vmf");
writeFileSync(MAP, roomsVmf());

/** The same map with a door facing the corridor's north wall, 128 units from it. */
const WITH_DOOR = join(dir, "door.vmf");
writeFileSync(
  WITH_DOOR,
  applyVmfOps(roomsVmf(), [
    {
      op: "add",
      keyvalues: {
        classname: "prop_door_rotating",
        targetname: "front_door",
        origin: "0 -256 0",
        angles: "0 90 0",
      },
    },
  ]).text,
);

const clearance = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  measureVmfClearanceTool.handler(
    { path: MAP, at: [0, -256, 64], hull: "standing", mask: "player", ...over } as never,
    ctx,
  ) as unknown as Record<string, unknown>;

describe("measure_vmf_clearance", () => {
  it("measures the corridor at exactly the width it is built to", () => {
    const r = clearance() as {
      widthUnits: number;
      widthMetres: number;
      headroomUnits: number;
      boundedBy: Array<{ brushId: number | null }>;
    };
    expect(r.widthUnits).toBeCloseTo(ROOMS.corridorWidth, 1);
    expect(r.headroomUnits).toBeCloseTo(ROOMS.HEIGHT, 1);
    // 256 units at 0.0254 m per unit.
    expect(r.widthMetres).toBeCloseTo(6.502, 2);
    // Both sides named, which is what makes a finding actionable.
    for (const side of r.boundedBy) expect(side.brushId).not.toBeNull();
  });

  /**
   * The failure that produced this test, on the map of 13/08/2026: measuring at a
   * floor-level point returned `widthUnits: 32` -- exactly the standing hull's own
   * footprint -- with `insideSolid: false` and a bound naming no brush at distance 0.
   * The hull is 72 tall and centred on the point, so at floor level it is buried in the
   * floor and every sweep returns nothing.
   *
   * A confident wrong number, indistinguishable from a real one-cell passage. It is the
   * same class of error as the `standingAt` defect `check_vmf_rules` was built to avoid --
   * a point on the floor is not a body position -- in a tool that does not go through
   * `standingAt`.
   */
  describe("a point the hull cannot occupy", () => {
    // Just above the corridor's floor -- the height the round-2 builder measured at, and
    // the interesting case: the point is in open air, the body is not. At z 0 the point
    // is itself inside the floor brush, which the old check would already have caught.
    const onTheFloor = { at: [0, -256, 16] };

    it("says the hull does not fit rather than measuring anyway", () => {
      const r = clearance(onTheFloor) as {
        hullFits: boolean;
        widthUnits: number | null;
        insideSolid: boolean;
      };
      expect(r.hullFits).toBe(false);
      // Null, not the hull's own width. A number here is read as a measurement.
      expect(r.widthUnits).toBeNull();
      // The point itself really is in open air, which is why the old check missed it.
      expect(r.insideSolid).toBe(false);
    });

    it("names the point that would have worked", () => {
      const r = clearance(onTheFloor) as { notes: string[]; standingAt: number[] | null };
      expect(r.standingAt).not.toBeNull();
      expect(r.standingAt![2]).toBeGreaterThan(0);
      expect(r.notes.join(" ")).toMatch(/hull/i);
    });

    it("measures the same place correctly once the hull fits", () => {
      const r = clearance() as { hullFits: boolean; widthUnits: number };
      expect(r.hullFits).toBe(true);
      expect(r.widthUnits).toBeCloseTo(ROOMS.corridorWidth, 1);
    });
  });

  it("finds the narrow direction by itself", () => {
    const r = clearance() as { narrowestAxis: number[] };
    // The corridor runs along x, so the narrow axis is y.
    expect(Math.abs(r.narrowestAxis[1]!)).toBeGreaterThan(0.9);
  });

  it("measures along an axis when told to, even a wide one", () => {
    const acrossX = clearance({ axis: [1, 0, 0] }) as { widthUnits: number };
    const narrow = clearance() as { widthUnits: number };
    expect(acrossX.widthUnits).toBeGreaterThan(narrow.widthUnits * 4);
  });

  it("says the point is inside a brush instead of reporting a width of nothing", () => {
    const r = clearance({ at: [0, 0, 128] }) as { insideSolid: boolean; notes: string[] };
    expect(r.insideSolid).toBe(true);
    expect(r.notes.join(" ")).toMatch(/inside a brush/);
  });

  it("names the hull it used, since a ray would answer differently", () => {
    const stand = clearance() as { notes: string[] };
    expect(stand.notes.join(" ")).toMatch(/32x32x72/);
    const crouch = clearance({ hull: "crouching" }) as { notes: string[] };
    expect(crouch.notes.join(" ")).toMatch(/32x32x36/);
  });
});

describe("measure_vmf_approach", () => {
  it("measures the room in front of a door", () => {
    const r = measureVmfApproachTool.handler(
      { path: WITH_DOOR, classname: "prop_door", hull: "standing", minClearUnits: 0, limit: 10 } as never,
      ctx,
    ) as unknown as {
      matched: number;
      entities: Array<{ targetname: string | null; clearUnits: number; blockedByBrushId: number | null }>;
    };
    expect(r.matched).toBe(1);
    // Facing north from the corridor's middle: the wall is 128 away, less the hull.
    expect(r.entities[0]!.clearUnits).toBeCloseTo(112, 1);
    expect(r.entities[0]!.targetname).toBe("front_door");
    expect(r.entities[0]!.blockedByBrushId).not.toBeNull();
  });

  it("reports only what is tighter than the bar, and sorts the worst first", () => {
    const all = measureVmfApproachTool.handler(
      { path: WITH_DOOR, hull: "standing", minClearUnits: 0, limit: 100 } as never,
      ctx,
    ) as unknown as { reported: number; entities: Array<{ clearUnits: number }> };
    expect(all.reported).toBeGreaterThan(1);
    for (let i = 1; i < all.entities.length; i++) {
      expect(all.entities[i]!.clearUnits).toBeGreaterThanOrEqual(all.entities[i - 1]!.clearUnits);
    }

    const tight = measureVmfApproachTool.handler(
      { path: WITH_DOOR, hull: "standing", minClearUnits: 16, limit: 100 } as never,
      ctx,
    ) as unknown as { reported: number };
    expect(tight.reported).toBeLessThan(all.reported);
  });

  it("refuses to claim it knows whether a door can swing", () => {
    // A leaf's width lives in a model this server cannot open offline. Saying so is the
    // difference between a measurement and a guess wearing one's clothes.
    const r = measureVmfApproachTool.handler(
      { path: WITH_DOOR, classname: "prop_door", hull: "standing", minClearUnits: 0, limit: 10 } as never,
      ctx,
    ) as unknown as { notes: string[]; assumedHull: number[] };
    expect(r.notes.join(" ")).toMatch(/does not say whether a door can swing/);
    expect(r.assumedHull).toEqual([32, 32, 72]);
  });
});

describe("read_vmf_sightlines", () => {
  it("finds the corridor's own length as the longest clear line", () => {
    const r = readVmfSightlinesTool.handler(
      { path: MAP, step: 16, eyeHeight: 64, spacing: 16, limit: 3, maxCells: 4_000_000 } as never,
      ctx,
    ) as unknown as {
      samplePoints: number;
      longest: Array<{ units: number; from: number[]; to: number[] }>;
      notes: string[];
    };
    expect(r.samplePoints).toBeGreaterThan(10);
    expect(r.longest.length).toBeGreaterThan(0);

    // The corridor is 2048 long inside; nothing in this map is longer, and a line the
    // length of the diagonal would mean the sight check was not working.
    const longest = r.longest[0]!.units;
    expect(longest).toBeGreaterThan(1500);
    expect(longest).toBeLessThan(2100);
  });

  it("declares how coarsely it sampled, because that changes the claim", () => {
    const r = readVmfSightlinesTool.handler(
      { path: MAP, step: 16, eyeHeight: 64, spacing: 32, limit: 3, maxCells: 4_000_000 } as never,
      ctx,
    ) as unknown as { notes: string[]; samplePoints: number };
    expect(r.notes.join(" ")).toMatch(/sample points/);
    expect(r.notes.join(" ")).toMatch(/closed door blocks/);
  });

  it("says it had nowhere to start rather than returning nothing quietly", () => {
    const noSpawn = join(dir, "nospawn.vmf");
    writeFileSync(noSpawn, roomsVmf().replace(/info_player_start/g, "info_target"));
    const r = readVmfSightlinesTool.handler(
      { path: noSpawn, step: 16, eyeHeight: 64, spacing: 8, limit: 3, maxCells: 4_000_000 } as never,
      ctx,
    ) as unknown as { samplePoints: number; notes: string[] };
    expect(r.samplePoints).toBe(0);
    expect(r.notes.join(" ")).toMatch(/No spawn entity/);
  });
});
