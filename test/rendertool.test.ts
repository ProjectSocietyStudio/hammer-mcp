import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import type { ToolContext } from "../src/mcp/registry.js";
import { decodePng } from "../src/render/png.js";
import { renderVmfViewTool } from "../src/tools/render.js";
import { ctx as sharedCtx, FIXTURES } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const PROBE = join(FIXTURES, "hmcp_probe.vmf");
/** The only fixture with an outside: a walled garden under a toolsskybox shell. */
const BACKYARD = join(FIXTURES, "hmcp_backyard.vmf");

interface ViewOut {
  origin: number[];
  angles: number[];
  facesDrawn: number;
  skyFraction: number;
  voidFraction: number;
  insideSolid: boolean;
  notes: string[];
  pngBytes: number;
  width: number;
  height: number;
  [IMAGE_KEY]: { data: string; mimeType: string };
}

const view = (args: Record<string, unknown> = {}): ViewOut =>
  renderVmfViewTool.handler(
    { path: PROBE, eyeHeight: 0, fov: 90, width: 160, height: 120, near: 4, ...args } as never,
    ctx,
  ) as unknown as ViewOut;

const backyard = (args: Record<string, unknown> = {}): ViewOut =>
  renderVmfViewTool.handler(
    { path: BACKYARD, eyeHeight: 0, fov: 90, width: 160, height: 120, near: 4, ...args } as never,
    ctx,
  ) as unknown as ViewOut;

describe("render_vmf_view", () => {
  it("returns a PNG on the image channel, whose bytes decode to the size it claims", () => {
    // The image channel is mcp-core's IMAGE_KEY, the same one gmod-mcp's capture_screen
    // uses: the base64 leaves the JSON body and arrives as a picture the model can see.
    // Left in the text it would be billed token by token and looked at by nobody.
    const r = view({ origin: [0, 0, 128], angles: [0, 0, 0] });
    expect(r[IMAGE_KEY].mimeType).toBe("image/png");
    const decoded = decodePng(Buffer.from(r[IMAGE_KEY].data, "base64"));
    expect(decoded.width).toBe(160);
    expect(decoded.height).toBe(120);
    expect(r.pngBytes).toBeGreaterThan(100);
  });

  it("stands where an entity stands", () => {
    // info_player_start sits at 0 0 16 in gen_probe.py, and eyeHeight is Source's own 64.
    const r = view({ fromEntity: "hmcp_probe", eyeHeight: 64 });
    expect(r.origin).toEqual([0, 0, 128]); // info_target at 0 0 64, plus 64
  });

  it("says which entity it could not find rather than rendering from nowhere", () => {
    expect(() => view({ fromEntity: "no_such_thing" })).toThrow(/no entity named/);
  });

  it("frames the whole map when told nothing, and says that is what it did", () => {
    const r = view({});
    expect(r.facesDrawn).toBeGreaterThan(0);
    expect(r.notes.join(" ")).toMatch(/No camera given/);
  });

  it("says the eye is inside a wall instead of showing an inexplicable picture", () => {
    // A camera inside a brush renders a frame that looks empty, and so does one pointing at
    // the sky. The engine is asked which it is rather than the pixels being interpreted.
    const inside = view({ origin: [270, 0, 128], angles: [0, 0, 0] });
    expect(inside.insideSolid).toBe(true);
    expect(inside.notes.join(" ")).toMatch(/inside a brush/);

    const outside = view({ origin: [0, 0, 128], angles: [0, 0, 0] });
    expect(outside.insideSolid).toBe(false);
  });

  it("warns when the camera is looking at nothing", () => {
    // The void, which is not the sky: this frame shows no geometry at all, and a sealed
    // map's sky is geometry -- a toolsskybox face like any other.
    const r = view({ origin: [6000, 0, 128], angles: [0, 0, 0] });
    expect(r.voidFraction).toBeGreaterThan(0.95);
    expect(r.skyFraction).toBe(0);
    expect(r.notes.join(" ")).toMatch(/no geometry/);
  });

  // #78. skyFraction counted pixels that hit nothing, which on a sealed map is zero by
  // construction -- so it read 0 in a garden whose frame is a third toolsskybox, and read
  // 1 outside the map where there is no sky at all. Both are the wrong way round.
  describe("skyFraction (#78)", () => {
    it("counts the sky a camera can actually see", () => {
      const r = backyard({ origin: [224, 470, 0], stand: true, angles: [-18, -90, 0], fov: 100 });
      expect(r.skyFraction).toBeGreaterThan(0.15);
      expect(r.voidFraction).toBe(0);
    });

    it("is zero indoors, where there is no sky face to see", () => {
      const r = backyard({ origin: [112, 112, 0], stand: true, angles: [0, 0, 0] });
      expect(r.skyFraction).toBe(0);
      expect(r.facesDrawn).toBeGreaterThan(0);
    });

    it("is nearly all of a frame looking straight up in the garden", () => {
      const r = backyard({ origin: [224, 400, 0], stand: true, angles: [-89, 0, 0] });
      expect(r.skyFraction).toBeGreaterThan(0.9);
    });
  });

  it("never lets the picture pass for a screenshot", () => {
    // A flat-shaded rendering looks enough like a game frame to be read as one, and it
    // carries no texture, no lightmap and no fog. Every call says so, not just the ones
    // where it might matter.
    const r = view({ origin: [0, 0, 128], angles: [0, 0, 0] });
    expect(r.notes.join(" ")).toMatch(/does not show what the place looks like/);
    expect(r.notes.join(" ")).toMatch(/gmod-mcp/);
  });
});

/**
 * #79. `render_vmf_view` skipped every displaced brush and said so:
 *
 *   "4 displacement brush(es) are not drawn: their flat quad is not the surface the game
 *    builds, so drawing it would show terrain that does not exist."
 *
 * Honest, and it left the only tool that LOOKS at a map blind to every piece of terrain in
 * it. `hmcp_backyard`'s garden is 85 m² whose entire content is terrain: in every render it
 * was a flat slab, because the terrain was not drawn and the sealing slab beneath it was.
 * It produced a false reading in that round's own account, where the terrain was described
 * as reading dead flat when it had not been drawn at all.
 */
describe("displacements are drawn (#79)", () => {
  it("shows the terrain rather than the slab under it", () => {
    // Straight down over the garden, where the only thing to see is its ground.
    const r = backyard({ origin: [224, 400, 240], angles: [89, 0, 0], fov: 100 });
    expect(r.facesDrawn).toBeGreaterThan(200);
    expect(r.notes.join(" ")).not.toMatch(/are not drawn/);
  });

  it("says nothing at all about terrain on a map that has none", () => {
    // Absence, not a rewording: `not.toMatch(/are not drawn/)` passed against a note reading
    // "0 displacement brush(es) are drawn as 0 triangles", so it could only ever have caught
    // the old sentence coming back. Sabotage found that; the assertion is now about the note
    // existing at all.
    const r = view({ origin: [0, 0, 128], angles: [0, 0, 0] });
    expect(r.notes.filter((n) => n.includes("displacement"))).toEqual([]);
  });
});
