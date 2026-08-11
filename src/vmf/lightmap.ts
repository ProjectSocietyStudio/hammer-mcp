/**
 * Changing how many luxels a surface gets.
 *
 * `lightmapscale` is **units per luxel**, so it works backwards from intuition: a smaller
 * number is a finer, more expensive lightmap. Hammer's default is 16. Halving it to 8
 * quadruples the luxels on that face, because the cost is an area.
 *
 * That squaring is the whole reason this tool exists. `LIGHTING` is capped at 16 MiB
 * (`MAX_MAP_LIGHTING`), and on the production map audited here it sits at **264% of that
 * ceiling** -- a map that only loads because its compilers raise the limit. Nobody arrives
 * there by choosing a fine lightmap once; they arrive by never coarsening the surfaces
 * that did not need one. A 1024x1024 warehouse floor at scale 16 costs 4225 luxels. At
 * scale 32 it costs 1089, and nobody can tell.
 *
 * ## The cap that turns a cheap edit into an expensive one
 *
 * `MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER` is **32**, read from `src/public/bspfile.h` of
 * source-sdk-2013 on 11/08/2026. A brush face may not carry more than 32 luxels along
 * either texture axis, and vbsp does not refuse when you ask for more -- it **splits the
 * face** until each piece fits. So lowering the scale on a large surface does not only
 * multiply luxels, it multiplies faces, and `FACES` has a ceiling of its own.
 *
 * The projection is reported before the write for exactly that reason: the expensive part
 * of this edit is the part that does not look like an edit.
 */
import type { KvNode } from "../kv/parse.js";
import { resolveFaces, setSidePair } from "./face.js";
import type { FaceSelector } from "./select.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

import type { SolidSide, Vec3 } from "./solid.js";

export class VmfLightmapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfLightmapError";
  }
}

/**
 * `MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER`, from `src/public/bspfile.h`, read 11/08/2026.
 *
 * Not the displacement one, which is 125 -- `MAX_LIGHTMAP_DIM_WITHOUT_BORDER` in that
 * header aliases the *displacement* value, so reading the obvious name gives four times
 * the real limit for a brush face.
 */
export const MAX_BRUSH_LUXELS_PER_AXIS = 32;

export interface FaceChange {
  solidId: number;
  sideId: number | null;
  material: string;
  areaUnits: number;
  from: number;
  to: number;
  /** Luxels this face carried before, and will carry after. */
  luxelsBefore: number;
  luxelsAfter: number;
  /** Luxels along the longer texture axis after the change; past 32 vbsp splits the face. */
  worstAxisAfter: number;
}

export interface LightmapResult {
  text: string;
  changed: FaceChange[];
  /** Faces the selector matched but which already carried the requested scale. */
  alreadyAtScale: number;
  luxelsBefore: number;
  luxelsAfter: number;
  warnings: string[];
  unchanged: boolean;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function unit(v: Vec3): Vec3 | null {
  const l = Math.sqrt(dot(v, v));
  return l < 1e-9 ? null : [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * Luxels a face costs at a given scale: its extent along each texture axis, divided by the
 * scale, plus Source's off-by-one in each direction.
 */
function luxelsFor(side: SolidSide, scale: number): { total: number; worstAxis: number } {
  if (side.vertices.length < 3 || !side.uaxis || !side.vaxis) return { total: 0, worstAxis: 0 };
  const u = unit(side.uaxis.axis);
  const v = unit(side.vaxis.axis);
  if (!u || !v) return { total: 0, worstAxis: 0 };

  const extent = (axis: Vec3): number => {
    const p = side.vertices.map((w) => dot(w, axis));
    return Math.max(...p) - Math.min(...p);
  };
  const cu = Math.floor(extent(u) / scale) + 1;
  const cv = Math.floor(extent(v) / scale) + 1;
  return { total: cu * cv, worstAxis: Math.max(cu, cv) };
}

export function setLightmapScale(
  source: string,
  scale: number,
  selector: FaceSelector,
): LightmapResult {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new VmfLightmapError(`lightmapscale must be a positive number, not ${scale}`);
  }

  const warnings: string[] = [];
  if (Math.log2(scale) % 1 !== 0) {
    warnings.push(
      `${scale} is not a power of two. vrad accepts it, and Hammer's own control only ` +
        `offers powers of two -- a value between them tends to mean a typo rather than an ` +
        `intention.`,
    );
  }

  // resolveFaces does the walking, the geometry and the reconciliation between a side
  // block and what the reader measured for it. This file had its own copy of all three,
  // and face.ts was written from it -- so when the copy in face.ts was fixed to tell two
  // faces apart by their normal as well as their distance, this one kept the fault. An
  // origin-centred box has four walls at one distance, and set_lightmap_scale was giving
  // all four of them the first wall's normal, its area and its corners: the `facing`
  // selector picked the wrong faces and the luxel projection measured the wrong extent.
  //
  // One copy now. The lesson is the copy, not the fix: a second implementation of a
  // subtlety is a place for it to survive being corrected.
  const faces = resolveFaces(source, selector);
  const splices: Splice[] = [];
  const changed: FaceChange[] = [];
  let alreadyAtScale = 0;
  let luxelsBefore = 0;
  let luxelsAfter = 0;
  let overCap = 0;

  for (const face of faces) {
    const parsed = face.side;
    const side = face.block;

    const current = parsed.lightmapScale ?? 16;
    const before = luxelsFor(parsed, current);
    const after = luxelsFor(parsed, scale);
    luxelsBefore += before.total;
    luxelsAfter += after.total;

    if (current === scale) {
      alreadyAtScale++;
      continue;
    }
    if (after.worstAxis > MAX_BRUSH_LUXELS_PER_AXIS) overCap++;

    changed.push({
      solidId: face.solidId,
      sideId: parsed.id,
      material: parsed.material,
      areaUnits: Math.round(parsed.area),
      from: current,
      to: scale,
      luxelsBefore: before.total,
      luxelsAfter: after.total,
      worstAxisAfter: after.worstAxis,
    });

    const existing = side.entries.find(
      (e: KvNode) => e.kind === "pair" && e.key === "lightmapscale",
    );
    if (existing && existing.kind === "pair") {
      splices.push({
        start: existing.start,
        end: existing.end,
        text: `"lightmapscale" "${scale}"`,
      });
    } else {
      // No such key: insert it where Hammer puts it, just before the closing brace.
      setSidePair(source, side, "lightmapscale", String(scale), splices);
    }
  }

  if (overCap > 0) {
    warnings.push(
      `${overCap} face(s) would carry more than ${MAX_BRUSH_LUXELS_PER_AXIS} luxels along a ` +
        `texture axis, which is MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER. vbsp does not refuse ` +
        `this -- it splits the face until each piece fits, so the real cost is extra faces ` +
        `as well as extra luxels, and FACES has a ceiling of its own.`,
    );
  }

  const text = applySplices(source, splices);

  return {
    text,
    changed,
    alreadyAtScale,
    luxelsBefore,
    luxelsAfter,
    warnings,
    unchanged: splices.length === 0,
  };
}
