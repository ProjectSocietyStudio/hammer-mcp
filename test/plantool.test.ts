import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import type { ToolContext } from "../src/mcp/registry.js";
import { decodePng } from "../src/render/png.js";
import { renderVmfPlanTool } from "../src/tools/plan.js";
import { ctx as sharedCtx } from "./support/env.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const ctx = sharedCtx as unknown as ToolContext;
const dir = mkdtempSync(join(tmpdir(), "hammer-plan-"));
const MAP = join(dir, "rooms.vmf");
writeFileSync(MAP, roomsVmf());

interface PlanOut {
  cutZ: number;
  unitsPerPixel: number;
  pageWidth: number;
  pageHeight: number;
  brushesCut: number;
  roomCount: number;
  portals: Array<{ approxWidthUnits: number }>;
  svg: string | null;
  notes: string[];
  pngBytes: number;
  [IMAGE_KEY]: { data: string; mimeType: string };
}

const plan = (over: Record<string, unknown> = {}): PlanOut =>
  renderVmfPlanTool.handler(
    { path: MAP, width: 700, height: 500, grid: 512, rooms: true, svg: false, ...over } as never,
    ctx,
  ) as unknown as PlanOut;

describe("render_vmf_plan", () => {
  it("returns a picture whose bytes decode to the page it reports", () => {
    const r = plan();
    expect(r[IMAGE_KEY].mimeType).toBe("image/png");
    const png = decodePng(Buffer.from(r[IMAGE_KEY].data, "base64"));
    expect(png.width).toBe(r.pageWidth);
    expect(png.height).toBe(r.pageHeight);
  });

  it("dimensions both doorways at the width the map is built to", () => {
    const r = plan();
    expect(r.roomCount).toBe(3);
    expect(r.portals).toHaveLength(2);
    for (const p of r.portals) expect(p.approxWidthUnits).toBe(ROOMS.doorWidth);
  });

  it("withholds the SVG unless asked, and returns the same drawing when asked", () => {
    expect(plan().svg).toBeNull();
    const withSvg = plan({ svg: true });
    expect(withSvg.svg).toMatch(/^<svg xmlns/);
    // Every doorway's dimension is in the text form too, so the two are the same drawing.
    expect(withSvg.svg).toContain(`${ROOMS.doorWidth}u`);
  });

  it("says where it cut, because everything above and below is missing", () => {
    const r = plan();
    expect(r.notes.join(" ")).toMatch(/Cut at z/);
    expect(r.cutZ).toBeGreaterThan(0);
  });

  it("says so when the cut passes through nothing at all", () => {
    // A blank plan and a plan of an empty map look identical. One of them is a mistake.
    const r = plan({ cutZ: 9000 });
    expect(r.brushesCut).toBe(0);
    expect(r.notes.join(" ")).toMatch(/passes through no brush/);
    expect(r.notes.join(" ")).toMatch(/pass cutZ/);
  });

  it("says why there are no rooms when it had nowhere to flood from", () => {
    const noSpawn = join(dir, "nospawn.vmf");
    writeFileSync(noSpawn, roomsVmf().replace(/info_player_start/g, "info_target"));
    const r = renderVmfPlanTool.handler(
      { path: noSpawn, width: 400, height: 400, grid: 512, rooms: true, svg: false } as never,
      ctx,
    ) as unknown as PlanOut;
    expect(r.roomCount).toBe(0);
    expect(r.notes.join(" ")).toMatch(/No spawn entity/);
  });

  it("draws the brushes even with rooms turned off", () => {
    const r = plan({ rooms: false });
    expect(r.brushesCut).toBeGreaterThan(4);
    expect(r.roomCount).toBe(0);
  });
});
