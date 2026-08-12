import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import {
  readVmfClearanceTool,
  readVmfTraceTool,
  readVmfVisibilityTool,
} from "../src/tools/space.js";
import { writeDisplacements } from "../src/vmf/dispwrite.js";
import { ctx as sharedCtx, FIXTURES } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const PROBE = join(FIXTURES, "hmcp_probe.vmf");

interface TraceOut {
  hit: boolean;
  distanceUnits: number;
  material: string | null;
  brushId: number | null;
  startSolid: boolean;
  brushCount: number;
  notes: string[];
}

const trace = (args: Record<string, unknown>): TraceOut =>
  readVmfTraceTool.handler({ path: PROBE, mask: "solid", hull: "none", ...args } as never, ctx) as unknown as TraceOut;

describe("read_vmf_trace", () => {
  it("measures to the wall the generator wrote, in units and in metres", () => {
    const r = readVmfTraceTool.handler(
      { path: PROBE, from: [0, 0, 128], to: [1000, 0, 128], mask: "solid", hull: "none" } as never,
      ctx,
    ) as unknown as TraceOut & { distanceMetres: number; normal: number[] };
    expect(r.hit).toBe(true);
    expect(r.distanceUnits).toBeCloseTo(256, 1);
    // 256 units at 0.0254 m per unit. The conversion is the repo's, not this test's.
    expect(r.distanceMetres).toBeCloseTo(6.502, 2);
    expect(r.normal).toEqual([-1, 0, 0]);
    expect(r.brushCount).toBe(6);
  });

  it("reports the swept hull stopping short of where the ray reached", () => {
    const ray = trace({ from: [0, 0, 64], to: [1000, 0, 64] });
    const hull = trace({ from: [0, 0, 64], to: [1000, 0, 64], hull: "standing" });
    expect(ray.distanceUnits).toBeCloseTo(256, 1);
    expect(hull.distanceUnits).toBeCloseTo(240, 1);
  });

  it("says a start inside solid is unanswerable, and names no brush", () => {
    const r = trace({ from: [270, 0, 128], to: [1000, 0, 128] });
    expect(r.startSolid).toBe(true);
    expect(r.brushId).toBeNull();
  });

  it("restricts the scene to the owners asked for", () => {
    const r = trace({ from: [0, 0, 128], to: [1000, 0, 128], owners: ["func_detail"] });
    expect(r.brushCount).toBe(0);
    expect(r.hit).toBe(false);
  });
});

describe("read_vmf_visibility", () => {
  it("separates the clear line from the blocked one and names what blocks it", () => {
    const r = readVmfVisibilityTool.handler(
      {
        path: PROBE,
        mask: "sight",
        pairs: [
          { name: "across the room", from: [-200, 0, 64], to: [200, 0, 64] },
          { name: "through the +x wall", from: [0, 0, 64], to: [1000, 0, 64] },
        ],
      } as never,
      ctx,
    ) as unknown as {
      clear: number;
      blocked: number;
      lines: Array<{ name: string; clear: boolean; blockedAtUnits: number | null; blockedBy: { material: string | null } | null }>;
    };

    expect(r.clear).toBe(1);
    expect(r.blocked).toBe(1);
    const open = r.lines.find((l) => l.name === "across the room")!;
    expect(open.clear).toBe(true);
    expect(open.blockedBy).toBeNull();
    const shut = r.lines.find((l) => l.name === "through the +x wall")!;
    expect(shut.blockedAtUnits).toBeCloseTo(256, 1);
    expect(shut.blockedBy!.material).toMatch(/DEV_MEASUREGENERIC01/i);
  });
});

describe("read_vmf_nearest_surface", () => {
  it("finds the floor from the middle of the room", () => {
    const r = readVmfClearanceTool.handler(
      { path: PROBE, at: [0, 0, 64], radius: 512, mask: "solid" } as never,
      ctx,
    ) as unknown as {
      insideSolid: boolean;
      nearest: { distanceUnits: number; material: string; point: number[] } | null;
    };
    expect(r.insideSolid).toBe(false);
    expect(r.nearest!.distanceUnits).toBeCloseTo(64, 3);
    expect(r.nearest!.point[2]).toBeCloseTo(0, 3);
  });

  it("says nothing is near rather than reaching past its radius", () => {
    const r = readVmfClearanceTool.handler(
      { path: PROBE, at: [0, 0, 128], radius: 8, mask: "solid" } as never,
      ctx,
    ) as unknown as { nearest: unknown };
    expect(r.nearest).toBeNull();
  });

  it("knows a point inside a wall is inside it", () => {
    const r = readVmfClearanceTool.handler(
      { path: PROBE, at: [270, 0, 128], radius: 512, mask: "solid" } as never,
      ctx,
    ) as unknown as { insideSolid: boolean };
    expect(r.insideSolid).toBe(true);
  });
});

describe("what the tools refuse to leave unsaid", () => {
  it("says when a displacement was left out, instead of measuring without it", () => {
    // A displacement's flat quad is not the surface the game builds, so dropping it is
    // right -- and dropping it silently gives a floor height wrong by the whole depth of
    // the terrain, in an answer that reads exactly like a correct one.
    const dir = mkdtempSync(join(tmpdir(), "hammer-space-"));
    const file = join(dir, "disp.vmf");
    const terrained = writeDisplacements(
      readFileSync(PROBE, "utf8"),
      { facing: "up", minArea: 1000 },
      { power: 3 },
    );
    expect(terrained.created.length).toBeGreaterThan(0);
    writeFileSync(file, terrained.text);

    const r = readVmfTraceTool.handler(
      { path: file, from: [0, 0, 128], to: [0, 0, -1000], mask: "solid", hull: "none" } as never,
      ctx,
    ) as unknown as TraceOut & { excluded: { displacement: number } };

    expect(r.excluded.displacement).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/displacement/i);
    expect(r.brushCount).toBeLessThan(6);

    // The negative sister: the untouched probe reports nothing excluded and all six
    // brushes, so the note above is about this file rather than about every file.
    const clean = trace({ from: [0, 0, 128], to: [0, 0, -1000] });
    expect(clean.notes).toEqual([]);
    expect(clean.brushCount).toBe(6);
  });
});
