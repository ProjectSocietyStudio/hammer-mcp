import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { readVmfLeakTool, readVmfRoomsTool, readVmfSurfacesTool } from "../src/tools/scene.js";
import { ctx as sharedCtx, FIXTURES } from "./support/env.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const ctx = sharedCtx as unknown as ToolContext;
const dir = mkdtempSync(join(tmpdir(), "hammer-scene-"));

const write = (name: string, text: string): string => {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
};

const SEALED = write("rooms.vmf", roomsVmf());
const LEAKY = write("rooms-leak.vmf", roomsVmf({ leak: true }));
const PROBE = join(FIXTURES, "hmcp_probe.vmf");

const defaults = { step: 16, maxCells: 4_000_000 };

const leak = (path: string): Record<string, unknown> =>
  readVmfLeakTool.handler({ path, ...defaults } as never, ctx) as unknown as Record<string, unknown>;

const rooms = (path: string, over: Record<string, unknown> = {}): Record<string, unknown> =>
  readVmfRoomsTool.handler(
    { path, ...defaults, minRoomArea: 4096, ...over } as never,
    ctx,
  ) as unknown as Record<string, unknown>;

describe("read_vmf_leak", () => {
  it("says a sealed map is sealed", () => {
    const r = leak(SEALED);
    expect(r.sealed).toBe(true);
    expect(r.leakPath).toEqual([]);
    expect(r.escapedAt).toBeNull();
  });

  it("finds the hole and hands back a path to follow", () => {
    // The whole point: vbsp is the only thing that can answer this today, and it costs a
    // toolchain and minutes -- and then refuses to run vvis.
    const r = leak(LEAKY) as { sealed: boolean; escapedAt: number[]; leakPath: number[][] };
    expect(r.sealed).toBe(false);
    expect(r.leakPath.length).toBeGreaterThan(2);
    expect(r.escapedAt[1]).toBeGreaterThan(ROOMS.west.y[1]);
  });

  it("seeds itself from the map's own spawn, without being told where inside is", () => {
    const r = leak(SEALED) as { seeds: number[][]; notes: string[] };
    expect(r.seeds).toHaveLength(1);
    // info_player_start sits in the corridor, lifted clear of the floor it rests on.
    expect(r.seeds[0]![1]).toBeLessThan(ROOMS.corridor.y[1]);
    expect(r.notes.join(" ")).not.toMatch(/No spawn entity/);
  });

  it("says when it had to guess where inside was", () => {
    // A guessed seed outside the sealed part describes the void, and every number after it
    // is about the void. That has to be visible in the answer, not in the source.
    const noSpawn = write("nospawn.vmf", roomsVmf().replace(/info_player_start/g, "info_target"));
    const r = leak(noSpawn) as { notes: string[] };
    expect(r.notes.join(" ")).toMatch(/No spawn entity/);
  });

  it("agrees with the compiled probe map, which is known to seal", () => {
    // hmcp_probe.vmf compiles clean and boots: an independent witness that it is sealed.
    expect(leak(PROBE).sealed).toBe(true);
  });
});

describe("read_vmf_rooms", () => {
  it("finds the three spaces and the two doorways, at the widths the fixture states", () => {
    const r = rooms(SEALED) as {
      roomCount: number;
      portals: Array<{ approxWidthUnits: number; between: number[] }>;
      rooms: Array<{ floorAreaSquareMetres: number; connectsTo: number[] }>;
    };
    expect(r.roomCount).toBe(3);
    expect(r.portals).toHaveLength(2);
    for (const p of r.portals) expect(p.approxWidthUnits).toBe(ROOMS.doorWidth);

    // The graph, not just the count: one space touches both others, and they do not touch.
    const degrees = r.rooms.map((x) => x.connectsTo.length).sort();
    expect(degrees).toEqual([1, 1, 2]);
  });

  it("declares its method and parameters, because it is a heuristic", () => {
    const r = rooms(SEALED) as { method: string; parameters: Record<string, number>; notes: string[] };
    expect(r.method).toBe("watershed-clearance");
    expect(r.parameters.step).toBe(16);
    expect(r.notes.join(" ")).toMatch(/heuristic/);
  });

  it("warns that a leaking map's rooms may include the outside", () => {
    const r = rooms(LEAKY) as { sealed: boolean; notes: string[] };
    expect(r.sealed).toBe(false);
    expect(r.notes.join(" ")).toMatch(/not sealed/);
  });

  it("refuses a cell budget it cannot meet rather than answering about part of the map", () => {
    expect(() => rooms(SEALED, { maxCells: 1000 })).toThrow(/coarsen step/);
  });

  it("gives one room for the probe's single sealed box", () => {
    const r = rooms(PROBE) as { roomCount: number; portals: unknown[] };
    expect(r.roomCount).toBe(1);
    expect(r.portals).toEqual([]);
  });
});

describe("read_vmf_surfaces", () => {
  it("separates what a person could touch from what is buried between brushes", () => {
    const r = readVmfSurfacesTool.handler(
      { path: SEALED, kind: "any", exposedOnly: true, limit: 50 } as never,
      ctx,
    ) as unknown as {
      faceCount: number;
      buriedCount: number;
      matched: number;
      exposedAreaByKind: Record<string, number>;
      touchingBrushes: Record<string, number[]>;
    };
    expect(r.buriedCount).toBeGreaterThan(0);
    expect(r.matched).toBeLessThan(r.faceCount);
    expect(r.exposedAreaByKind.wall).toBeGreaterThan(0);
    // Adjacency, which nothing in this repository knew before.
    expect(Object.keys(r.touchingBrushes).length).toBeGreaterThan(0);
  });

  it("filters to one kind, and the filter actually narrows", () => {
    const all = readVmfSurfacesTool.handler(
      { path: SEALED, kind: "any", exposedOnly: true, limit: 500 } as never,
      ctx,
    ) as unknown as { matched: number };
    const floors = readVmfSurfacesTool.handler(
      { path: SEALED, kind: "floor", exposedOnly: true, limit: 500 } as never,
      ctx,
    ) as unknown as { matched: number; faces: Array<{ kind: string }> };
    expect(floors.matched).toBeGreaterThan(0);
    expect(floors.matched).toBeLessThan(all.matched);
    for (const f of floors.faces) expect(f.kind).toBe("floor");
  });

  it("says what 'exposed' means, since it includes the roof", () => {
    const r = readVmfSurfacesTool.handler(
      { path: SEALED, kind: "any", exposedOnly: true, limit: 5 } as never,
      ctx,
    ) as unknown as { notes: string[] };
    expect(r.notes.join(" ")).toMatch(/outside of the map/);
  });
});
