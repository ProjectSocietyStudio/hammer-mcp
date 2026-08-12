/**
 * Rendering a `.vmf` from a camera, so the agent can look at the map instead of reading
 * coordinates about it.
 *
 * `docs/PIEGES.md:47` records what happens without this: a visual diagnosis built from the
 * code alone, with no picture, that was **entirely wrong** -- it accused draw density, and
 * the real faults were a missing blur, icons that never arrived and a paperdoll four times
 * too small. The rule written down that day was "no diagnosis of appearance before there is
 * an image". This is the first image this server can produce.
 *
 * ## What it shows, and what it cannot
 *
 * Flat colour per face, one directional light, no textures, no lightmaps, no fog, no props.
 * It shows **form and occlusion**: what stands where, what hides what, how much room there
 * is at eye height. It does not show atmosphere, and no amount of work here would -- that
 * is what a capture from the running game is for. Saying so is part of the tool's output,
 * because a rendering that looks like a screenshot invites being read as one.
 *
 * A face's colour is a stable hash of its material name, shaded by Lambert. Stability is the
 * point: the same wall is the same colour in two renderings taken an edit apart, so the two
 * can be compared. A palette assigned in draw order would make every rendering incomparable
 * with every other one while looking perfectly sensible.
 *
 * ## The oracle, and why the id buffer exists
 *
 * Alongside the pixels, the rasteriser fills an Int32 buffer holding the brush id visible at
 * every pixel. That is not a debugging extra -- it is what makes the picture checkable. For
 * a sample of pixels, the test reconstructs the primary ray and asks `src/space/trace.ts`
 * what it hits, then demands the same brush. Scan-conversion with a z-buffer and a BVH
 * descent share the camera and nothing else, and the ray side is itself already cross-checked
 * against the engine's own tracer. The chain of oracles ends at the game.
 */
import { traceRay } from "../space/trace.js";
import type { Scene, SceneBrush, SceneFace } from "../space/scene.js";
import { MASK_SIGHT } from "../space/scene.js";
import type { Vec3 } from "../vmf/solid.js";
import { basisOf, planeScale, toView } from "./camera.js";
import type { Camera, CameraBasis, ViewPoint } from "./camera.js";

/** No brush here. -1 rather than 0, because 0 is a legal Hammer id. */
export const NO_BRUSH = -1;

export interface Framebuffer {
  width: number;
  height: number;
  /** RGB, row-major from the top left. */
  rgb: Uint8Array;
  /** Brush id per pixel, or NO_BRUSH. The oracle's half of the output. */
  ids: Int32Array;
  /** 1/z per pixel, for the depth test. Zero where nothing was drawn. */
  invDepth: Float32Array;
}

/** One face, ready to draw: already in view space, already clipped, already shaded. */
export interface DisplayFace {
  brushId: number;
  sideId: number | null;
  material: string;
  /** View-space corners, z > 0 for all of them. */
  points: ViewPoint[];
  /** 0..1, the Lambert term. */
  shade: number;
  colour: [number, number, number];
}

export interface RenderResult extends Framebuffer {
  facesConsidered: number;
  facesDrawn: number;
  /** Faces dropped for facing away from the camera. */
  facesCulled: number;
  /** Faces dropped entirely behind the near plane. */
  facesBehind: number;
}

/**
 * A stable colour for a material name.
 *
 * FNV-1a, then a hue on a fixed wheel with high lightness and low saturation. Pastel rather
 * than saturated because the shading has to remain visible on top of it, and because a dozen
 * saturated hues in one frame is a picture nobody can read.
 */
export function colourFor(material: string): [number, number, number] {
  let h = 0x811c9dc5;
  const name = material.toLowerCase();
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const hue = (h % 360) / 60;
  const sector = Math.floor(hue) % 6;
  const f = hue - Math.floor(hue);
  const v = 0.86;
  const s = 0.32;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  const rgb: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const c = rgb[sector]!;
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
}

/** Fixed light, so shading is a property of the geometry and not of the call. */
const LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.4, 0.5, 0.766];
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
})();

/**
 * Clips a view-space polygon against the near plane.
 *
 * One plane, so Sutherland-Hodgman is four lines. Skipping it is not a cosmetic fault: a
 * corner behind the camera projects with a negative depth and lands on the *opposite* side
 * of the screen, so the face wraps across the frame and paints over everything.
 */
function clipNear(points: readonly ViewPoint[], near: number): ViewPoint[] {
  const out: ViewPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const aIn = a.z >= near;
    const bIn = b.z >= near;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (near - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
    }
  }
  return out;
}

/**
 * The faces a camera could see, in view space, shaded -- everything before rasterisation.
 *
 * Separated from the fill so the geometry can be asserted in closed form. "The 512 cube seen
 * from 1024 at 90 degrees occupies this quad" is a statement a test can check by hand; a
 * framebuffer is not.
 */
export function displayList(scene: Scene, camera: Camera): {
  faces: DisplayFace[];
  considered: number;
  culled: number;
  behind: number;
} {
  const basis = basisOf(camera.angles);
  const faces: DisplayFace[] = [];
  let considered = 0;
  let culled = 0;
  let behind = 0;

  for (const brush of scene.brushes) {
    if ((brush.mask & MASK_SIGHT) === 0) continue;
    for (const face of brush.faces) {
      considered += 1;
      if (face.loop.length < 3) continue;

      // Backface cull in world space: a face whose outward normal points away from the eye
      // is the far side of a solid brush and is never visible from here.
      const n = face.plane.normal;
      const toEye =
        n[0] * (camera.origin[0] - face.loop[0]![0]) +
        n[1] * (camera.origin[1] - face.loop[0]![1]) +
        n[2] * (camera.origin[2] - face.loop[0]![2]);
      if (toEye <= 0) {
        culled += 1;
        continue;
      }

      const view = face.loop.map((p) => toView(camera, basis, p));
      const clipped = clipNear(view, camera.near);
      if (clipped.length < 3) {
        behind += 1;
        continue;
      }

      // Half-Lambert, so a face turned away is dark rather than black: a black face in a
      // flat-shaded picture reads as a hole, and a hole is what a leak looks like.
      const lambert = n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2];
      const shade = 0.45 + 0.55 * Math.max(0, lambert);

      faces.push({
        brushId: brush.id,
        sideId: face.sideId,
        material: face.material,
        points: clipped,
        shade,
        colour: colourFor(face.material),
      });
    }
  }

  return { faces, considered, culled, behind };
}

/** Fills a convex polygon with a z-buffer in 1/z, which interpolates linearly on screen. */
function fillFace(fb: Framebuffer, camera: Camera, face: DisplayFace): boolean {
  const { sx, sy } = planeScale(camera);
  const n = face.points.length;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const iz = new Float64Array(n);
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const v = face.points[i]!;
    px[i] = ((v.x / (v.z * sx)) * 0.5 + 0.5) * fb.width;
    py[i] = (0.5 - (v.y / (v.z * sy)) * 0.5) * fb.height;
    iz[i] = 1 / v.z;
    if (py[i]! < minY) minY = py[i]!;
    if (py[i]! > maxY) maxY = py[i]!;
  }

  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(fb.height - 1, Math.floor(maxY - 0.5));
  if (y1 < y0) return false;

  const r = Math.round(face.colour[0] * face.shade);
  const g = Math.round(face.colour[1] * face.shade);
  const b = Math.round(face.colour[2] * face.shade);
  let drew = false;

  for (let y = y0; y <= y1; y++) {
    const scanY = y + 0.5;
    // The polygon is convex, so a scanline meets it in exactly one span: the leftmost and
    // rightmost crossings bound it, and nothing between them is outside.
    let xLo = Infinity;
    let xHi = -Infinity;
    let izLo = 0;
    let izHi = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ya = py[i]!;
      const yb = py[j]!;
      if (ya === yb) continue;
      if (scanY < Math.min(ya, yb) || scanY >= Math.max(ya, yb)) continue;
      const t = (scanY - ya) / (yb - ya);
      const x = px[i]! + (px[j]! - px[i]!) * t;
      const z = iz[i]! + (iz[j]! - iz[i]!) * t;
      if (x < xLo) {
        xLo = x;
        izLo = z;
      }
      if (x > xHi) {
        xHi = x;
        izHi = z;
      }
    }
    if (xLo > xHi) continue;

    const x0 = Math.max(0, Math.ceil(xLo - 0.5));
    const x1 = Math.min(fb.width - 1, Math.floor(xHi - 0.5));
    const span = xHi - xLo;
    for (let x = x0; x <= x1; x++) {
      const t = span > 0 ? (x + 0.5 - xLo) / span : 0;
      const invZ = izLo + (izHi - izLo) * t;
      const at = y * fb.width + x;
      if (invZ <= fb.invDepth[at]!) continue;
      fb.invDepth[at] = invZ;
      fb.ids[at] = face.brushId;
      fb.rgb[at * 3] = r;
      fb.rgb[at * 3 + 1] = g;
      fb.rgb[at * 3 + 2] = b;
      drew = true;
    }
  }
  return drew;
}

/** Sky, or rather the absence of geometry. Deliberately not black: black reads as a hole. */
const BACKGROUND: [number, number, number] = [24, 28, 36];

export function render(scene: Scene, camera: Camera): RenderResult {
  const fb: Framebuffer = {
    width: camera.width,
    height: camera.height,
    rgb: new Uint8Array(camera.width * camera.height * 3),
    ids: new Int32Array(camera.width * camera.height).fill(NO_BRUSH),
    invDepth: new Float32Array(camera.width * camera.height),
  };
  for (let i = 0; i < camera.width * camera.height; i++) {
    fb.rgb[i * 3] = BACKGROUND[0];
    fb.rgb[i * 3 + 1] = BACKGROUND[1];
    fb.rgb[i * 3 + 2] = BACKGROUND[2];
  }

  const { faces, considered, culled, behind } = displayList(scene, camera);
  let drawn = 0;
  for (const face of faces) if (fillFace(fb, camera, face)) drawn += 1;

  return { ...fb, facesConsidered: considered, facesDrawn: drawn, facesCulled: culled, facesBehind: behind };
}

/**
 * Where to stand to see a box, given a direction to look from.
 *
 * Pulls back until the box's bounding sphere fits the narrower of the two fields of view, so
 * the framing does not depend on the aspect ratio being landscape.
 */
export function frameBox(
  mins: Vec3,
  maxs: Vec3,
  camera: Pick<Camera, "fov" | "width" | "height">,
  yaw: number,
  pitch: number,
): { origin: Vec3; angles: Vec3 } {
  const centre: Vec3 = [
    (mins[0] + maxs[0]) / 2,
    (mins[1] + maxs[1]) / 2,
    (mins[2] + maxs[2]) / 2,
  ];
  const radius =
    0.5 * Math.hypot(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]);
  const { sx, sy } = planeScale({ ...camera, near: 1, origin: centre, angles: [0, 0, 0] });
  const distance = radius / Math.max(1e-6, Math.min(sx, sy));

  const basis = basisOf([pitch, yaw, 0]);
  return {
    origin: [
      centre[0] - basis.forward[0] * distance,
      centre[1] - basis.forward[1] * distance,
      centre[2] - basis.forward[2] * distance,
    ],
    angles: [pitch, yaw, 0],
  };
}

/** Re-exported so a caller checking a rendering does not have to know where trace lives. */
export { traceRay };
export type { CameraBasis, SceneBrush, SceneFace };
