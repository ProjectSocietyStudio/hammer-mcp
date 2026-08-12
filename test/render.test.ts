import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { basisOf, planeScale, project, rayThrough } from "../src/render/camera.js";
import type { Camera } from "../src/render/camera.js";
import { decodePng, encodePng } from "../src/render/png.js";
import { colourFor, displayList, NO_BRUSH, render } from "../src/render/raster.js";
import { buildScene, MASK_SIGHT } from "../src/space/scene.js";
import { traceRay } from "../src/space/trace.js";
import { insertSolids } from "../src/vmf/build.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probeScene = buildScene(PROBE, readFileSync(PROBE, "utf8"));

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

/** A single 256-unit cube centred on the origin, built by the proven writer. */
const cubeScene = buildScene(
  "cube.vmf",
  insertSolids(SEED, [{ shape: "box", mins: [-128, -128, -128], maxs: [128, 128, 128] }], {
    material: "DEV/DEV_MEASUREGENERIC01",
  }).text,
);

const camera = (over: Partial<Camera> = {}): Camera => ({
  origin: [0, 0, 128],
  angles: [0, 0, 0],
  fov: 90,
  width: 160,
  height: 120,
  near: 4,
  ...over,
});

describe("the camera follows Source's convention", () => {
  it("looks along +x at zero angles, with +y to its left and +z up", () => {
    // Not a preference. gmod-mcp's read_view reports a player's eye in exactly these terms,
    // so a rendering and a capture from the same numbers frame the same thing. Getting it
    // wrong here cannot be fixed later without invalidating every rendering anyone looked at.
    const b = basisOf([0, 0, 0]);
    expect(b.forward[0]).toBeCloseTo(1, 6);
    expect(b.left[1]).toBeCloseTo(1, 6);
    expect(b.up[2]).toBeCloseTo(1, 6);
  });

  it("makes positive pitch look down, as Source does", () => {
    expect(basisOf([90, 0, 0]).forward[2]).toBeCloseTo(-1, 6);
    expect(basisOf([-90, 0, 0]).forward[2]).toBeCloseTo(1, 6);
  });

  it("turns left for positive yaw", () => {
    expect(basisOf([0, 90, 0]).forward[1]).toBeCloseTo(1, 6);
  });

  it("treats fov as horizontal, so the vertical one follows the aspect", () => {
    // A vertical fov would give a picture that is right at 4:3 and subtly wrong at every
    // other shape -- which is the kind of error nobody sees and everybody measures against.
    const wide = planeScale(camera({ width: 320, height: 120, fov: 90 }));
    expect(wide.sx).toBeCloseTo(1, 6);
    expect(wide.sy).toBeCloseTo(120 / 320, 6);
  });
});

describe("the display list, in closed form", () => {
  /**
   * The framebuffer cannot be checked by hand; this can. A 256-unit cube seen head-on from
   * 1024 away at 90 degrees puts its near face at a computable place, and the arithmetic is
   * short enough to state in the test rather than record from the output.
   */
  it("puts the cube's near face exactly where the arithmetic says", () => {
    const cam = camera({ origin: [-1024, 0, 0], width: 256, height: 256, fov: 90 });
    const { faces } = displayList(cubeScene, cam);

    // Six faces, one of them facing the camera; the other five are culled or edge-on.
    const near = faces.find((f) => f.points.every((p) => Math.abs(p.z - 896) < 0.001));
    expect(near, "the -x face, 896 units in front of the camera").toBeDefined();

    // tan(45) = 1, so the half-width of the view at depth 896 is 896 units. The cube's
    // half-width is 128, so it covers 128/896 of the half-screen: 18.286 px either side.
    const spread = (128 / 896) * 128;
    const xs = near!.points.map((p) => project(cam, p).px);
    expect(Math.min(...xs)).toBeCloseTo(128 - spread, 3);
    expect(Math.max(...xs)).toBeCloseTo(128 + spread, 3);

    const ys = near!.points.map((p) => project(cam, p).py);
    expect(Math.min(...ys)).toBeCloseTo(128 - spread, 3);
    expect(Math.max(...ys)).toBeCloseTo(128 + spread, 3);
  });

  it("drops the faces pointing away, which is five of a cube's six", () => {
    const { faces, culled } = displayList(cubeScene, camera({ origin: [-1024, 0, 0] }));
    expect(faces).toHaveLength(1);
    expect(culled).toBe(5);
  });

  it("clips a face that straddles the camera rather than wrapping it across the frame", () => {
    // A corner behind the eye projects with a negative depth and lands on the OPPOSITE side
    // of the screen, so an unclipped face paints over the whole picture. The clip is not
    // cosmetic.
    const cam = camera({ origin: [0, 0, 0], width: 64, height: 64 });
    const { faces } = displayList(cubeScene, cam);
    for (const f of faces) {
      for (const p of f.points) expect(p.z).toBeGreaterThanOrEqual(cam.near - 1e-9);
    }
  });
});

describe("the material colour is stable", () => {
  it("gives the same material the same colour every time", () => {
    // The whole point: the same wall is the same colour in two renderings an edit apart, so
    // they can be compared. A palette handed out in draw order makes every rendering
    // incomparable with every other one while looking perfectly sensible.
    expect(colourFor("BRICK/BRICKWALL001")).toEqual(colourFor("brick/brickwall001"));
    expect(colourFor("BRICK/BRICKWALL001")).not.toEqual(colourFor("CONCRETE/CONCRETEFLOOR001"));
  });
});

describe("render", () => {
  it("draws the room and leaves nothing at the background colour in the middle", () => {
    const r = render(probeScene, camera());
    expect(r.facesDrawn).toBeGreaterThan(0);
    const centre = (r.height >> 1) * r.width + (r.width >> 1);
    expect(r.ids[centre]).not.toBe(NO_BRUSH);
  });

  it("shows sky where there is no geometry, rather than a black hole", () => {
    // Outside the map looking away from it. A picture that is black there and black in a
    // leak looks the same in both cases, and one of them is a bug.
    const r = render(probeScene, camera({ origin: [4000, 0, 128], angles: [0, 0, 0] }));
    const centre = (r.height >> 1) * r.width + (r.width >> 1);
    expect(r.ids[centre]).toBe(NO_BRUSH);
    expect(r.rgb[centre * 3]).toBeGreaterThan(0);
  });
});

describe("the rasteriser against the tracer", () => {
  /**
   * The oracle. Scan-conversion with a z-buffer and a BVH descent share the camera and
   * nothing else, and the ray side is itself cross-checked against the engine's own tracer
   * on the compiled probe. So the chain ends at the game rather than at an opinion.
   */
  it("agrees with a traced ray about the brush at 2000 pixels", () => {
    const cam = camera({ origin: [-180, -180, 96], angles: [10, 35, 0], width: 200, height: 150 });
    const fb = render(probeScene, cam);
    const basis = basisOf(cam.angles);

    let compared = 0;
    let agreed = 0;
    let solid = 0;
    const rng = lcg(88);
    for (let i = 0; i < 2000; i++) {
      const px = Math.floor(rng() * cam.width);
      const py = Math.floor(rng() * cam.height);
      const far = rayThrough(cam, basis, px, py, 20000);
      const t = traceRay(probeScene, cam.origin, far, MASK_SIGHT);
      const drawn = fb.ids[py * cam.width + px]!;
      const traced = t.hit ? t.brushId : NO_BRUSH;

      compared += 1;
      if (traced !== NO_BRUSH) solid += 1;
      if (drawn === traced) agreed += 1;
    }

    // The disagreements are silhouette pixels: a pixel centre that falls within half a
    // pixel of an edge is on one side for the scan-converter and the other for the ray.
    // The tolerance is declared here rather than hidden in an epsilon somewhere.
    expect(compared).toBe(2000);
    expect(agreed / compared, `${agreed}/${compared} pixels agree`).toBeGreaterThan(0.99);
    // The negative sisters: a render that drew nothing, or a trace that hit everything,
    // would both be perfectly self-consistent.
    expect(solid).toBeGreaterThan(1500);
    expect(fb.facesDrawn).toBeGreaterThan(2);
  });
});

describe("one thing in front of another", () => {
  /**
   * The sealed room proves nothing about depth: it is convex seen from inside, so no face
   * hides another and the painter's algorithm would score just as well. Removing the depth
   * test left every assertion above green, which is what this scene is for.
   */
  const occluded = buildScene(
    "occluded.vmf",
    insertSolids(
      SEED,
      // The NEAR one first, deliberately. In file order the painter's algorithm draws it and
      // then paints the far wall over it, so a missing depth test is visible. With the far
      // one first the wrong code gets the right answer, which is how this test spent its
      // first version passing against a rasteriser that had no z-buffer at all.
      [
        { shape: "box", mins: [128, -64, -64], maxs: [192, 64, 64] }, // near crate
        { shape: "box", mins: [512, -512, -512], maxs: [544, 512, 512] }, // far wall
      ],
      { material: "DEV/DEV_MEASUREGENERIC01" },
    ).text,
  );

  it("draws the nearer brush over the farther one, whatever the order", () => {
    const cam = camera({ origin: [0, 0, 0], angles: [0, 0, 0], width: 120, height: 120 });
    const fb = render(occluded, cam);
    const centre = (cam.height >> 1) * cam.width + (cam.width >> 1);

    const crate = occluded.brushes.find((b) => b.maxs[0] === 192)!;
    const wall = occluded.brushes.find((b) => b.maxs[0] === 544)!;
    expect(fb.ids[centre], "the crate hides the wall behind it").toBe(crate.id);

    // The negative sister: the wall is visible where the crate is not, so the crate is not
    // simply painted over everything.
    expect([...fb.ids]).toContain(wall.id);
  });

  it("agrees with a traced ray about which of the two is in front", () => {
    const cam = camera({ origin: [0, 0, 0], angles: [0, 0, 0], width: 120, height: 120 });
    const fb = render(occluded, cam);
    const basis = basisOf(cam.angles);
    let agreed = 0;
    let occludedPixels = 0;
    const crate = occluded.brushes.find((b) => b.maxs[0] === 192)!;
    for (let py = 0; py < cam.height; py += 2) {
      for (let px = 0; px < cam.width; px += 2) {
        const far = rayThrough(cam, basis, px, py, 20000);
        const t = traceRay(occluded, cam.origin, far, MASK_SIGHT);
        const traced = t.hit ? t.brushId : NO_BRUSH;
        if (traced === crate.id) occludedPixels += 1;
        if (fb.ids[py * cam.width + px] === traced) agreed += 1;
      }
    }
    const total = (cam.height / 2) * (cam.width / 2);
    expect(agreed / total).toBeGreaterThan(0.99);
    expect(occludedPixels, "pixels where the crate is the nearer of two").toBeGreaterThan(100);
  });
});

describe("encodePng", () => {
  it("round-trips a framebuffer through its own bytes", () => {
    // The filter byte is the trap: omit it and the file is still valid, deflate still
    // compresses, the CRC still checks out, and every row shears one byte further than the
    // last. Only reading the bytes back shows it.
    const width = 17; // not a multiple of anything, so a stride error cannot cancel out
    const height = 9;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 37) % 256;

    const png = encodePng(rgb, width, height);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const back = decodePng(png);
    expect(back.width).toBe(width);
    expect(back.height).toBe(height);
    expect(Buffer.from(back.rgb)).toEqual(Buffer.from(rgb));
  });

  it("refuses a framebuffer that is not the size it claims", () => {
    expect(() => encodePng(new Uint8Array(10), 4, 4)).toThrow(/expected 48/);
  });

  it("notices a corrupted chunk instead of returning wrong pixels", () => {
    const png = encodePng(new Uint8Array(3 * 4).fill(200), 2, 2);
    const broken = Buffer.from(png);
    broken[broken.length - 20] = broken[broken.length - 20]! ^ 0xff;
    expect(() => decodePng(broken)).toThrow(/CRC/);
  });
});

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
