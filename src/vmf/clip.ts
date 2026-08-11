/**
 * Cutting a brush with a plane.
 *
 * The most-used tool in Hammer, and the one that unlocks every shape that is not an
 * assembly of boxes. Everything before this could add a brush, move it or delete it whole;
 * nothing could take a piece off one.
 *
 * The implementation is short because the pieces were already here: a brush is the
 * intersection of its half-spaces, so cutting it is adding one more, and `hullFromPlanes`
 * already turns a plane set back into corners. What takes the words is what happens to the
 * *faces*, and there are three cases that all have to be right at once:
 *
 * **A face that survives keeps its own bytes.** Its material, texture axes, lightmap scale
 * and smoothing groups come through untouched, because the `side` block is copied rather
 * than rebuilt. A clip that reset the texturing of every face it did not remove would be
 * technically correct and useless.
 *
 * **A face that no longer bounds anything is dropped.** After the cut some sides touch
 * fewer than three corners of the new hull -- they are outside the piece that was kept.
 * Leaving them in would not change the shape, since the intersection is the same, but it
 * would leave `read_vmf_solids` reporting `redundant-side` on every brush this tool made.
 *
 * **The cut face is new, and gets its axes from vbsp's table.** It inherits the material
 * of the largest surviving face rather than a fixed default: cutting a brick wall in two
 * and getting a nodraw face in the middle of it is the wrong answer often enough that
 * Hammer does the same thing.
 *
 * `keep: "both"` produces two brushes whose volumes sum to the original. That is the whole
 * oracle for this file, and it is exact enough to catch a plane taken in the wrong sense:
 * the sum comes out doubled or zero, not slightly off.
 */
import { get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { textureAxesFor } from "./build.js";
import { findSolids, isEmptySelector, lineRange, matchesSolid } from "./select.js";
import type { SolidSelector } from "./select.js";
import {
  checkVmfSolids,
  hullFromPlanes,
  ON_EPSILON,
  planeFromPoints,
  pointsFromPlane,
} from "./solid.js";
import type { Plane, SolidCheck, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { maxId } from "./edit.js";

export class VmfClipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfClipError";
  }
}

export type KeepSide = "front" | "back" | "both";

export interface ClipOptions {
  /**
   * Which side to keep. `front` is the side the plane's normal points towards.
   *
   * `both` leaves two brushes where there was one, which is what Hammer's clip tool does
   * when you cycle it past "keep front" and "keep back".
   */
  keep: KeepSide;
  /** Material for the newly cut face. Default: the material of the largest face kept. */
  cutMaterial?: string;
}

export interface ClippedSolid {
  id: number;
  owner: string;
  volumeBefore: number;
  /** Volume of the piece that kept the original id. Zero when the whole brush was cut away. */
  volumeAfter: number;
  /** Id of the second piece, when `keep: "both"` made one. */
  otherId: number | null;
  volumeOther: number;
  facesDropped: number;
  removed: boolean;
}

export interface ClipResult {
  text: string;
  matched: number;
  solids: ClippedSolid[];
  warnings: string[];
  unchanged: boolean;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Corners of `hull` lying on `plane`, within the tolerance vbsp itself works to. */
function onPlane(hull: readonly Vec3[], plane: Plane): Vec3[] {
  return hull.filter((v) => Math.abs(dot(plane.normal, v) - plane.dist) < ON_EPSILON);
}

/** Volume of a convex hull from its bounding planes, by the divergence theorem. */
function volumeOf(planes: readonly Plane[], hull: readonly Vec3[]): number {
  let total = 0;
  for (const p of planes) {
    const face = onPlane(hull, p);
    if (face.length < 3) continue;
    total += p.dist * polygonArea(face, p.normal);
  }
  return total / 3;
}

function polygonArea(vertices: readonly Vec3[], normal: Vec3): number {
  if (vertices.length < 3) return 0;
  const c: Vec3 = [
    vertices.reduce((s, v) => s + v[0], 0) / vertices.length,
    vertices.reduce((s, v) => s + v[1], 0) / vertices.length,
    vertices.reduce((s, v) => s + v[2], 0) / vertices.length,
  ];
  const d: Vec3 = [vertices[0]![0] - c[0], vertices[0]![1] - c[1], vertices[0]![2] - c[2]];
  const l = Math.hypot(d[0], d[1], d[2]);
  if (l < 1e-9) return 0;
  const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const v: Vec3 = [
    normal[1] * u[2] - normal[2] * u[1],
    normal[2] * u[0] - normal[0] * u[2],
    normal[0] * u[1] - normal[1] * u[0],
  ];
  const ordered = [...vertices].sort((p, q) => {
    const dp: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const dq: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    return Math.atan2(dot(dp, v), dot(dp, u)) - Math.atan2(dot(dq, v), dot(dq, u));
  });
  let area = 0;
  for (let i = 0; i < ordered.length; i++) {
    const p = ordered[i]!;
    const q = ordered[(i + 1) % ordered.length]!;
    const a: Vec3 = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const b: Vec3 = [q[0] - c[0], q[1] - c[1], q[2] - c[2]];
    area += dot(normal, [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]);
  }
  return Math.abs(area) / 2;
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
const vec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;

/** The `side` blocks of a solid, in file order. */
function sideBlocks(solid: KvBlock): KvBlock[] {
  return solid.entries.filter((n): n is KvBlock => n.kind === "block" && n.name === "side");
}

/** A copy of a `side` block's text with a new id. */
function renumberSide(source: string, side: KvBlock, id: number): string {
  const text = source.slice(side.start, side.end);
  return text.replace(/"id"\s+"\d+"/, `"id" "${id}"`);
}

/** A fresh `side` block for the cut face, indented like the ones beside it. */
function cutFaceText(
  plane: Plane,
  hull: readonly Vec3[],
  id: number,
  material: string,
  lightmapScale: number,
  textureScale: number,
  indent: string,
): string | null {
  const corners = onPlane(hull, plane);
  const pts = pointsFromPlane(plane, corners);
  if (!pts) return null;
  const axes = textureAxesFor(plane.normal);
  const body = [
    `"id" "${id}"`,
    `"plane" "(${vec(pts[0])}) (${vec(pts[1])}) (${vec(pts[2])})"`,
    `"material" "${material}"`,
    `"uaxis" "[${vec(axes.u)} 0] ${fmt(textureScale)}"`,
    `"vaxis" "[${vec(axes.v)} 0] ${fmt(textureScale)}"`,
    `"rotation" "0"`,
    `"lightmapscale" "${lightmapScale}"`,
    `"smoothing_groups" "0"`,
  ];
  return `${indent}side\n${indent}{\n${body.map((l) => `${indent}\t${l}`).join("\n")}\n${indent}}\n`;
}

/** Indentation of a block, taken from the line it starts on. */
function indentOf(source: string, block: KvBlock): string {
  const lineStart = source.lastIndexOf("\n", block.start - 1) + 1;
  return source.slice(lineStart, block.start).match(/^[\t ]*/)?.[0] ?? "\t\t";
}

interface Half {
  planes: Plane[];
  hull: Vec3[];
  volume: number;
  /** Index into the original side list for each surviving face. */
  keptSides: number[];
}

/** Works out one half of the cut: which planes bound it and which faces survive. */
function halfOf(sides: Plane[], cut: Plane, hullTolerance = ON_EPSILON): Half | null {
  const planes = [...sides, cut];
  const hull = hullFromPlanes(planes);
  if (hull.length < 4) return null;
  const volume = volumeOf(planes, hull);
  if (volume < hullTolerance) return null;
  const keptSides: number[] = [];
  for (let i = 0; i < sides.length; i++) {
    if (onPlane(hull, sides[i]!).length >= 3) keptSides.push(i);
  }
  return { planes, hull, volume, keptSides };
}

const flip = (p: Plane): Plane => ({
  normal: [-p.normal[0], -p.normal[1], -p.normal[2]],
  dist: -p.dist,
});

/**
 * Cuts every selected brush with `plane`.
 *
 * A brush lying entirely on the kept side is left exactly as it was -- not rewritten with
 * the same bytes, which would be indistinguishable from a real edit in a diff. A brush
 * lying entirely on the discarded side is removed, and reported as removed rather than as
 * clipped to nothing.
 */
export function clipSolids(
  source: string,
  selector: SolidSelector,
  plane: Plane,
  options: ClipOptions,
): ClipResult {
  if (isEmptySelector(selector)) {
    throw new VmfClipError(
      "refusing an empty selector: it would cut every brush in the map. Name ids, an " +
        "owner, a material or a bounding box.",
    );
  }
  const len = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
  if (len < 1e-9) throw new VmfClipError("the cutting plane has no normal direction");
  const cut: Plane = {
    normal: [plane.normal[0] / len, plane.normal[1] / len, plane.normal[2] / len],
    dist: plane.dist / len,
  };

  const nodes = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const report = checkVmfSolids("(memory)", source);
  const byId = new Map<number, SolidCheck>();
  for (const s of report.solids) if (s.id !== null) byId.set(s.id, s);

  const wanted = findSolids(nodes).filter((f) => {
    const check = byId.get(f.id);
    return check ? matchesSolid(check, selector) : false;
  });
  if (wanted.length === 0) {
    return {
      text: source,
      matched: 0,
      solids: [],
      warnings: ["nothing matched the selector, so nothing was cut"],
      unchanged: true,
    };
  }
  const hidden = wanted.filter((f) => f.hidden);
  if (hidden.length > 0) {
    throw new VmfClipError(
      `refusing to cut ${hidden.length} solid(s) inside a hidden block: ` +
        `${hidden.map((h) => h.id).join(", ")}.`,
    );
  }
  const withDisp = wanted.filter((f) => byId.get(f.id)?.sides.some((s) => s.hasDisplacement));
  if (withDisp.length > 0) {
    throw new VmfClipError(
      `refusing to cut ${withDisp.length} solid(s) carrying a displacement: ` +
        `${withDisp.map((h) => h.id).join(", ")}. A dispinfo maps a fixed grid onto one ` +
        `face, and cutting that face leaves the grid describing a surface that is no ` +
        `longer there.`,
    );
  }

  const splices: Splice[] = [];
  const warnings: string[] = [];
  const results: ClippedSolid[] = [];
  let nextId = maxId(nodes) + 1;

  for (const found of wanted) {
    const check = byId.get(found.id)!;
    const blocks = sideBlocks(found.block);
    const planes = check.sides.map((s) => s.plane).filter((p): p is Plane => p !== null);
    if (planes.length !== blocks.length) {
      throw new VmfClipError(
        `solid ${found.id} has ${blocks.length} side blocks but ${planes.length} readable ` +
          `planes; refusing rather than cutting the wrong face`,
      );
    }

    // "front" is the side the normal points towards, which is the half-space the *flipped*
    // plane bounds: a brush is the intersection of `dot(n, x) <= dist`.
    const front = halfOf(planes, flip(cut));
    const back = halfOf(planes, cut);

    const wantFront = options.keep === "front" || options.keep === "both";
    const wantBack = options.keep === "back" || options.keep === "both";

    if (!front && !back) {
      throw new VmfClipError(`solid ${found.id} produced no volume on either side of the cut`);
    }
    if (!front || !back) {
      // The plane misses the brush entirely. Whichever half exists is the whole brush.
      const whole = front ?? back!;
      const keepIt = front ? wantFront : wantBack;
      if (keepIt) {
        results.push({
          id: found.id,
          owner: found.owner,
          volumeBefore: check.volume,
          volumeAfter: whole.volume,
          otherId: null,
          volumeOther: 0,
          facesDropped: 0,
          removed: false,
        });
      } else {
        splices.push({ ...lineRange(source, found.block), text: "" });
        results.push({
          id: found.id,
          owner: found.owner,
          volumeBefore: check.volume,
          volumeAfter: 0,
          otherId: null,
          volumeOther: 0,
          facesDropped: 0,
          removed: true,
        });
      }
      continue;
    }

    const material =
      options.cutMaterial ??
      largestFaceMaterial(check, front.keptSides.concat(back.keptSides));
    const lightmapScale = check.sides.find((s) => s.lightmapScale !== null)?.lightmapScale ?? 16;
    const textureScale = check.sides.find((s) => s.uaxis)?.uaxis?.scale ?? 0.25;
    const indent = indentOf(source, blocks[0]!);

    // The half that keeps the original id, so a caller's other references still resolve.
    const primary = wantFront ? front : back;
    // The face to write is the plane that was *added* to bound this half, not the plane
    // the caller handed in: keeping the front adds `flip(cut)`, because a brush is the
    // intersection of `dot(n, x) <= dist` and the front is `dot(n, x) >= dist`.
    const primaryCut = wantFront ? flip(cut) : cut;
    const dropped = blocks.length - primary.keptSides.length;
    for (let i = 0; i < blocks.length; i++) {
      if (primary.keptSides.includes(i)) continue;
      splices.push({ ...lineRange(source, blocks[i]!), text: "" });
    }
    const newFace = cutFaceText(
      primaryCut,
      primary.hull,
      nextId++,
      material,
      lightmapScale,
      textureScale,
      indent,
    );
    if (!newFace) {
      throw new VmfClipError(
        `solid ${found.id}: the cut face has no area, so it cannot be written as a plane`,
      );
    }
    const at = lineRange(source, blocks[blocks.length - 1]!).end;
    splices.push({ start: at, end: at, text: newFace });

    let otherId: number | null = null;
    let volumeOther = 0;
    if (options.keep === "both") {
      const other = wantFront ? back : front;
      // Same rule as above, one side over: the back half is the one `cut` itself bounds.
      const otherCut = wantFront ? cut : flip(cut);
      otherId = nextId++;
      volumeOther = other.volume;
      const kept = other.keptSides.map((i) => renumberSide(source, blocks[i]!, nextId++));
      const face = cutFaceText(
        otherCut,
        other.hull,
        nextId++,
        material,
        lightmapScale,
        textureScale,
        indent,
      );
      if (!face) {
        throw new VmfClipError(`solid ${found.id}: the second piece's cut face has no area`);
      }
      const solidIndent = indentOf(source, found.block);
      // The source brush's own editor block, copied verbatim. Two things go wrong without
      // it: a piece with no editor block at all can never be put in a visgroup or a group,
      // and a piece given a fresh one loses the membership and the colour the original
      // had -- so half of a brush that was in "north tenement" comes back outside it the
      // next time Hammer opens the map.
      const sourceEditor = found.block.entries.find(
        (n): n is KvBlock => n.kind === "block" && n.name === "editor",
      );
      const editorText = sourceEditor
        ? source.slice(
            lineRange(source, sourceEditor).start,
            lineRange(source, sourceEditor).end,
          )
        : `${solidIndent}\teditor\n${solidIndent}\t{\n${solidIndent}\t\t"color" "0 180 220"\n` +
          `${solidIndent}\t\t"visgroupshown" "1"\n${solidIndent}\t\t"visgroupautoshown" "1"\n` +
          `${solidIndent}\t}\n`;
      const body = `${solidIndent}solid\n${solidIndent}{\n${solidIndent}\t"id" "${otherId}"\n${kept
        .map((t) => `${indent}${t}\n`)
        .join("")}${face}${editorText}${solidIndent}}\n`;
      const after = lineRange(source, found.block).end;
      splices.push({ start: after, end: after, text: body });
    }

    results.push({
      id: found.id,
      owner: found.owner,
      volumeBefore: check.volume,
      volumeAfter: primary.volume,
      otherId,
      volumeOther,
      facesDropped: dropped,
      removed: false,
    });
  }

  const cutAway = results.filter((r) => r.removed).length;
  if (cutAway > 0) {
    warnings.push(
      `${cutAway} brush(es) lay entirely on the discarded side and were removed, not cut. ` +
        `If one of them held part of the map's hull, the next compile leaks.`,
    );
  }
  const missed = results.filter((r) => !r.removed && r.otherId === null && r.facesDropped === 0);
  if (missed.length > 0 && options.keep === "both") {
    warnings.push(
      `${missed.length} brush(es) lay entirely on one side of the plane, so there was ` +
        `nothing to cut and no second piece was made.`,
    );
  }

  const text = applySplices(source, splices);
  return { text, matched: wanted.length, solids: results, warnings, unchanged: text === source };
}

/**
 * Material of the biggest face among those kept, which is what Hammer gives the cut.
 *
 * Tool textures are skipped when the brush has anything else, because a nodraw side is
 * usually the one nobody sees and a cut face usually is seen. But a brush made **only** of
 * tool textures is a tool brush -- a hint, a trigger, a skip -- and forcing NODRAW onto it
 * strips the semantics it exists for: a hint brush cut in two would come back as a hint
 * with a nodraw face, which vvis reads as neither. So the fallback is the largest tool
 * face of such a brush, not a fixed default.
 */
function largestFaceMaterial(check: SolidCheck, kept: readonly number[]): string {
  const pick = (toolTextures: boolean): { material: string; area: number } | null => {
    let best: { material: string; area: number } | null = null;
    for (const i of kept) {
      const side = check.sides[i];
      if (!side) continue;
      if (side.material.toUpperCase().startsWith("TOOLS/") !== toolTextures) continue;
      if (!best || side.area > best.area) best = { material: side.material, area: side.area };
    }
    return best;
  };
  return (pick(false) ?? pick(true))?.material ?? "TOOLS/TOOLSNODRAW";
}

export { planeFromPoints };
