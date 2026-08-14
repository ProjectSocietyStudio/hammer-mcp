/**
 * Closing the loop a builder never closed on its own.
 *
 * `render_vmf_view` has existed since 12/08/2026. Across three sessions in which cold agents
 * built the same map end to end -- 145 tool calls between them -- it was called **once**.
 * They worked from coordinates and declared themselves finished on numbers, and the map that
 * came out of it passed every check and, in game, had a door painted flat on a wall, counters
 * that were single boxes and not one skirting board anywhere.
 *
 * So these are about the two things that stopped a builder looking: aiming a camera cost a
 * yaw and a pitch worked out by hand, and seeing a whole place cost one call per room.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anglesTowards } from "../src/render/camera.js";
import { contactSheet } from "../src/render/sheet.js";
import type { Tile } from "../src/render/sheet.js";
import type { Framebuffer } from "../src/render/raster.js";
import { glyphPixels } from "../src/render/font.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { renderVmfTourTool } from "../src/tools/render.js";
import { buildScene } from "../src/space/scene.js";
import { eyeAt, standingAt } from "../src/space/measure.js";
import { readFileSync } from "node:fs";
import { ctx as sharedCtx, FIXTURES } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const BODEGA = join(FIXTURES, "hmcp_bodega.vmf");

const frame = (w: number, h: number): Framebuffer => ({
  width: w,
  height: h,
  rgb: new Uint8Array(w * h * 3),
  ids: new Int32Array(w * h),
  sky: new Uint8Array(w * h),
  invDepth: new Float32Array(w * h),
});
const tile = (label: string, w = 16, h = 12): Tile => ({ label, frame: frame(w, h) });

describe("aiming a camera at a place", () => {
  it("looks along +x at yaw 0, and along +y at yaw 90", () => {
    expect(anglesTowards([0, 0, 0], [100, 0, 0])).toEqual([0, 0, 0]);
    expect(anglesTowards([0, 0, 0], [0, 100, 0])).toEqual([0, 90, 0]);
  });

  /**
   * The convention that is easy to get backwards, which is why it is asserted rather than
   * commented: Source's positive pitch looks *down*.
   */
  it("pitches down to look at something below, and up to look above", () => {
    expect(anglesTowards([0, 0, 100], [0, 0, 0])[0]).toBeCloseTo(90, 6);
    expect(anglesTowards([0, 0, 0], [0, 0, 100])[0]).toBeCloseTo(-90, 6);
  });

  it("keeps a yaw of zero when straight up, rather than letting atan2(0,0) decide", () => {
    expect(anglesTowards([0, 0, 0], [0, 0, 50])[1]).toBe(0);
  });

  it("never rolls", () => {
    for (const to of [[1, 2, 3], [-40, 9, -2], [0, 0, 1]] as const) {
      expect(anglesTowards([0, 0, 0], to)[2]).toBe(0);
    }
  });
});

describe("the eye and the body are not the same point", () => {
  /**
   * A 27-unit difference, which is a whole face. `standingAt` returns the centre of the
   * hull, because that is what a swept measurement is centred on. The first sheet
   * `render_vmf_tour` produced stood every camera there -- z 37 rather than 64 -- and no
   * number in its output disclosed it. Found by looking at the picture.
   */
  it("puts the eye at Source's own height above the floor, not at the hull's centre", () => {
    const scene = buildScene(BODEGA, readFileSync(BODEGA, "utf8"));
    const at: [number, number, number] = [128, 96, 16];
    expect(eyeAt(scene, at)[2] - standingAt(scene, at)[2]).toBeCloseTo(27.5, 6);
    // Not exactly 64: the downward trace stops an epsilon clear of the floor it hit, which
    // is the tracer being careful and not worth undoing for a camera.
    expect(eyeAt(scene, at)[2]).toBeCloseTo(64, 1);
  });
});

describe("the contact sheet", () => {
  it("lays frames out squarish rather than in a strip", () => {
    expect(contactSheet([tile("A"), tile("B"), tile("C")]).columns).toBe(2);
    expect(contactSheet(Array.from({ length: 9 }, (_, i) => tile(`${i}`))).columns).toBe(3);
    expect(contactSheet([tile("A")]).columns).toBe(1);
  });

  it("leaves room under each frame for its caption", () => {
    const s = contactSheet([tile("A", 100, 80)]);
    expect(s.width).toBeGreaterThan(100);
    expect(s.height).toBeGreaterThan(80 + 8);
  });

  it("refuses a sheet of nothing rather than returning an empty image", () => {
    expect(() => contactSheet([])).toThrow(/not a picture/);
  });

  it("refuses frames of different sizes, which would need a packing pass", () => {
    expect(() => contactSheet([tile("A", 16, 12), tile("B", 20, 12)])).toThrow(/same size/);
  });
});

describe("the font", () => {
  /**
   * The regression this guards: the font carried only what `render_vmf_plan` wrote --
   * digits and the four compass points -- so the first captioned sheet came back reading
   * "____ 0-1 ___m 0". A character set chosen for one caller is a set the next one cannot
   * spell in.
   */
  it("can spell any word a caption uses", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.") {
      // The fallback for an undefined glyph is a filled box: 5x7 solid, 29 lit pixels.
      const lit = glyphPixels(ch, 0, 7, 1).length;
      expect(lit, `${ch} falls back to the missing-glyph box`).not.toBe(29);
    }
  });
});

describe("render_vmf_tour on the first map these tools built", () => {
  const tour = (step: number) =>
    renderVmfTourTool.handler(
      { path: BODEGA, step, maxCells: 4_000_000, minRoomArea: 4096, fov: 90, width: 160, height: 120 },
      ctx,
    ) as unknown as {
      views: { label: string; origin: number[]; insideSolid: boolean }[];
      roomCount: number;
      portalCount: number;
      omitted: string[];
      notes: string[];
      pngBytes: number;
    };

  it("walks both rooms and both sides of the doorway, in one call", () => {
    const r = tour(32);
    expect(r.roomCount).toBe(2);
    expect(r.portalCount).toBe(1);
    expect(r.views.map((v) => v.label)).toEqual([
      "ROOM 0 - 29.1m2",
      "ROOM 1 - 28.4m2",
      "DOOR 0-1 FROM 0",
      "DOOR 0-1 FROM 1",
    ]);
    expect(r.pngBytes).toBeGreaterThan(0);
  });

  it("stands every camera at eye height, and none inside a wall", () => {
    for (const v of tour(32).views) {
      expect(v.origin[2], `${v.label} is not at eye height`).toBeCloseTo(64, 1);
      expect(v.insideSolid, `${v.label} is inside a brush`).toBe(false);
    }
  });

  /**
   * The tour inherits #53 and does not hide it. At the default cell size this map reads as
   * one 64 m2 room with no doorway -- the two rooms and the door between them are found at
   * 32 and at no other value tried. So the sheet shows one frame, which is the truth about
   * what the room pass returned rather than the truth about the map.
   */
  it("shows what the room pass found, defect included", () => {
    const r = tour(16);
    expect(r.roomCount).toBe(1);
    expect(r.portalCount).toBe(0);
    expect(r.views).toHaveLength(1);
  });

  /**
   * An empty sheet would read as "there is nothing here", which is a different and wrong
   * claim from "the flood found no room big enough to stand in".
   */
  it("falls back to the spawn rather than returning an empty sheet", () => {
    const r = tour(256);
    expect(r.roomCount).toBe(0);
    expect(r.views.map((v) => v.label)).toEqual(["SPAWN"]);
    expect(r.notes.join(" ")).toMatch(/found nothing to walk/);
  });

  it("names what a full sheet left out rather than dropping it quietly", () => {
    expect(tour(32).omitted).toEqual([]);
  });
});
