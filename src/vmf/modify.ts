/**
 * Changing brushes that are already in the file: moving them, and removing them.
 *
 * Until now the write path could only add. `write_vmf_solid` puts a brush in the file and
 * nothing could shift it by an inch or take it back out, which makes a mistake permanent
 * in the one kind of file a mapper usually has only one copy of. That is the gap this
 * closes, and it is the reason the guard and the backup were made real first.
 *
 * Two decisions worth stating, because both could reasonably have gone the other way.
 *
 * **A plane is transformed by transforming its three points, not by transforming the
 * plane.** A `.vmf` side states its plane as three points, so applying the matrix to each
 * of them is both exact and shorter than computing a normal and a distance and writing
 * them back. Winding survives an orientation-preserving map for free; a mirror flips it,
 * so the triple is reversed when the determinant is negative. Nothing else needs to know.
 *
 * **Texture lock is on by default and refused when it cannot be done exactly.** With it
 * on, the texture stays put on the face as the brush moves -- the same default Hammer
 * ships. The arithmetic is exact for a similarity (a rotation, a mirror, a move, a uniform
 * scale); for a scale that stretches one axis more than another there is no answer, because
 * a texture axis pair cannot express a shear. So that combination is refused rather than
 * approximated: a wrong texture is exactly the "compiles and is wrong" failure this repo's
 * checks exist to catch, and it is one no compiler will report.
 */
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { findSolids, isEmptySelector, lineRange, matchesSolid } from "./select.js";
import type { SolidSelector } from "./select.js";
import { checkVmfSolids, parsePlanePoints, parseTextureAxis } from "./solid.js";
import type { SolidCheck, TextureAxis, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import { applyDirection, applyPoint, determinant, snapPoint } from "./transform.js";
import type { Mat34 } from "./transform.js";

export class VmfModifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfModifyError";
  }
}

export interface TransformOptions {
  /** Keep each texture where it sits on its face. Hammer's own default, and this one. */
  textureLock?: boolean;
  /**
   * Round every corner to this grid after transforming. Zero, the default, rounds nothing.
   *
   * Snapping is what breaks a face's flatness, not what preserves it -- see
   * `./transform.ts`. It is offered because a mapper working on grid 16 wants the result on
   * grid 16, and it is measured rather than assumed: `worstPlanarityError` reports what it
   * cost, and the caller can refuse.
   */
  grid?: number;
}

export interface TransformedSolid {
  id: number;
  owner: string;
  volumeBefore: number;
  volumeAfter: number;
  minsAfter: Vec3;
  maxsAfter: Vec3;
  gridAfter: number;
}

export interface ModifyResult {
  text: string;
  matched: number;
  warnings: string[];
  unchanged: boolean;
}

export interface TransformResult extends ModifyResult {
  solids: TransformedSolid[];
  /** Worst distance, in units, from any corner to the plane its face claims. */
  worstPlanarityError: number;
}

export interface DeleteResult extends ModifyResult {
  deleted: Array<{ id: number; owner: string; volume: number }>;
  /** World brushes left afterwards. Zero means nothing seals the map. */
  worldSolidsAfter: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();
const vec = (v: Vec3): string => `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;

/**
 * True when `m` scales every direction by the same factor and keeps angles.
 *
 * Checked by transforming the three basis vectors: a similarity sends them to three
 * mutually perpendicular vectors of equal length. That covers moves, rotations, mirrors
 * and uniform scales, and excludes exactly the case texture lock has no answer for.
 */
function similarityScale(m: Mat34): number | null {
  const e: Vec3[] = [
    applyDirection(m, [1, 0, 0]),
    applyDirection(m, [0, 1, 0]),
    applyDirection(m, [0, 0, 1]),
  ];
  const k = len(e[0]!);
  if (k < 1e-9) return null;
  for (const v of e) if (Math.abs(len(v) - k) > 1e-6 * k) return null;
  if (Math.abs(dot(e[0]!, e[1]!)) > 1e-6 * k * k) return null;
  if (Math.abs(dot(e[0]!, e[2]!)) > 1e-6 * k * k) return null;
  if (Math.abs(dot(e[1]!, e[2]!)) > 1e-6 * k * k) return null;
  return k;
}

/**
 * Moves a texture axis so the texture lands on the same place on the moved face.
 *
 * A face's texture coordinate is `dot(p, axis) / scale + offset`. Writing the transform as
 * `p -> Rp + t` with `R = k * Q` for an orthogonal `Q`, keeping the stored axis unit-length
 * means storing `Qa`, and then `dot(Rp + t, Qa)` is `k * dot(p, a) + dot(t, Qa)`. Matching
 * the coordinate before and after gives the scale a factor of `k` and moves the offset by
 * `dot(t, Qa) / scale`.
 */
function lockAxis(axis: TextureAxis, m: Mat34, k: number): TextureAxis {
  const raw = applyDirection(m, axis.axis);
  const stored: Vec3 = [raw[0] / k, raw[1] / k, raw[2] / k];
  const scale = axis.scale * k;
  const t: Vec3 = [m[3]!, m[7]!, m[11]!];
  return { axis: stored, offset: axis.offset - dot(t, stored) / scale, scale };
}

const axisText = (a: TextureAxis): string =>
  `[${vec(a.axis)} ${fmt(a.offset)}] ${fmt(a.scale)}`;

/** Pairs each `side` block with what the reader measured for it, by id then by plane. */
function pairSides(block: KvBlock, check: SolidCheck): Array<[KvBlock, number]> {
  const out: Array<[KvBlock, number]> = [];
  const sideBlocks = block.entries.filter(
    (n): n is KvBlock => n.kind === "block" && n.name === "side",
  );
  for (let i = 0; i < sideBlocks.length; i += 1) out.push([sideBlocks[i]!, i]);
  if (sideBlocks.length !== check.sides.length) return [];
  return out;
}

function setPairIn(block: KvBlock, key: string, value: string, splices: Splice[]): boolean {
  for (const node of block.entries) {
    if (node.kind === "pair" && node.key === key) {
      splices.push({ start: node.start, end: node.end, text: `"${key}" "${value}"` });
      return true;
    }
  }
  return false;
}

/**
 * Applies an affine transform to the selected solids, in place.
 *
 * Every corner of every selected brush moves; nothing else in the file does. Displacements
 * are refused rather than moved: a `dispinfo` carries its own vertex offsets and a
 * `startposition`, and moving the face under them without moving those would slide the
 * terrain off its own brush. That belongs with the displacement tools, not here.
 */
export function transformSolids(
  source: string,
  selector: SolidSelector,
  matrix: Mat34,
  options: TransformOptions = {},
): TransformResult {
  if (isEmptySelector(selector)) {
    throw new VmfModifyError(
      "refusing an empty selector: it would move every brush in the map. Name ids, an " +
        "owner, a material or a bounding box.",
    );
  }
  const grid = options.grid ?? 0;
  const lock = options.textureLock !== false;
  const flips = determinant(matrix) < 0;
  const k = similarityScale(matrix);
  if (lock && k === null) {
    throw new VmfModifyError(
      "refusing textureLock on a transform that scales one axis more than another: a " +
        "texture axis pair cannot express the shear that would keep the texture in place. " +
        "Pass textureLock:false to accept that the texture stretches with the brush.",
    );
  }

  const { nodes } = parseRoots(source);
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
      worstPlanarityError: 0,
      warnings: ["nothing matched the selector, so nothing moved"],
      unchanged: true,
    };
  }

  const hidden = wanted.filter((f) => f.hidden);
  if (hidden.length > 0) {
    throw new VmfModifyError(
      `refusing to move ${hidden.length} solid(s) inside a hidden block: ` +
        `${hidden.map((h) => h.id).join(", ")}. Moving a hidden brush leaves it hidden and ` +
        `somewhere else, which is the hardest kind of change to notice.`,
    );
  }

  const withDisp = wanted.filter((f) => byId.get(f.id)?.sides.some((s) => s.hasDisplacement));
  if (withDisp.length > 0) {
    throw new VmfModifyError(
      `refusing to move ${withDisp.length} solid(s) carrying a displacement: ` +
        `${withDisp.map((h) => h.id).join(", ")}. A dispinfo holds its own startposition and ` +
        `per-vertex offsets, and moving the face without them would slide the terrain off ` +
        `its own brush.`,
    );
  }

  const splices: Splice[] = [];
  const warnings: string[] = [];
  const solids: TransformedSolid[] = [];
  let worst = 0;

  for (const found of wanted) {
    const check = byId.get(found.id)!;
    const pairs = pairSides(found.block, check);
    if (pairs.length === 0) {
      throw new VmfModifyError(
        `solid ${found.id} has ${check.sides.length} readable sides but a different number ` +
          `of side blocks; refusing rather than editing the wrong one`,
      );
    }

    const movedVertices: Vec3[] = [];
    for (const [sideBlock, index] of pairs) {
      const side = check.sides[index]!;
      const raw = side.points ?? readPoints(sideBlock);
      if (!raw) {
        throw new VmfModifyError(`solid ${found.id} has a side with no readable plane`);
      }
      let pts = raw.map((p) => snapPoint(applyPoint(matrix, p), grid)) as [Vec3, Vec3, Vec3];
      if (flips) pts = [pts[2], pts[1], pts[0]];
      setPairIn(sideBlock, "plane", `(${vec(pts[0])}) (${vec(pts[1])}) (${vec(pts[2])})`, splices);

      if (lock && k !== null) {
        const u = side.uaxis ?? readAxis(sideBlock, "uaxis");
        const v = side.vaxis ?? readAxis(sideBlock, "vaxis");
        if (u) setPairIn(sideBlock, "uaxis", axisText(lockAxis(u, matrix, k)), splices);
        if (v) setPairIn(sideBlock, "vaxis", axisText(lockAxis(v, matrix, k)), splices);
      }
      for (const p of side.vertices) movedVertices.push(snapPoint(applyPoint(matrix, p), grid));
    }

    // What the snap cost, measured per face against the plane its own corners now define.
    for (const [, index] of pairs) {
      const side = check.sides[index]!;
      if (!side.plane || side.vertices.length < 3) continue;
      const moved = side.vertices.map((p) => snapPoint(applyPoint(matrix, p), grid));
      const n = applyDirection(matrix, side.plane.normal);
      const nl = len(n);
      if (nl < 1e-9) continue;
      const unit: Vec3 = [n[0] / nl, n[1] / nl, n[2] / nl];
      const d = moved.reduce((s, p) => s + dot(unit, p), 0) / moved.length;
      for (const p of moved) worst = Math.max(worst, Math.abs(dot(unit, p) - d));
    }

    solids.push({
      id: found.id,
      owner: found.owner,
      volumeBefore: check.volume,
      volumeAfter: check.volume * Math.abs(determinant(matrix)),
      minsAfter: [
        Math.min(...movedVertices.map((p) => p[0])),
        Math.min(...movedVertices.map((p) => p[1])),
        Math.min(...movedVertices.map((p) => p[2])),
      ],
      maxsAfter: [
        Math.max(...movedVertices.map((p) => p[0])),
        Math.max(...movedVertices.map((p) => p[1])),
        Math.max(...movedVertices.map((p) => p[2])),
      ],
      gridAfter: grid,
    });
  }

  if (!lock) {
    warnings.push(
      "textureLock is off, so every texture on these brushes moves with the world rather " +
        "than with its face. That is what Hammer does with texture lock disabled, and it " +
        "is rarely what a mapper wants on a rotation.",
    );
  }

  // Compared against the source rather than counted: a splice that rewrites a line with
  // the bytes it already had is not a change, and translating along x leaves the texture
  // offset of every face perpendicular to x exactly where it was.
  const text = applySplices(source, splices);
  return {
    text,
    matched: wanted.length,
    solids,
    worstPlanarityError: worst,
    warnings,
    unchanged: text === source,
  };
}

/**
 * Removes the selected solids.
 *
 * Refuses a hidden solid for the same reason `set_solid_class` does, and warns -- rather
 * than refuses -- when the world is left with no brushes at all. Nothing here can prove a
 * map still seals; only a compile can, so the honest output is a warning and a next step.
 */
export function deleteSolids(source: string, selector: SolidSelector): DeleteResult {
  if (isEmptySelector(selector)) {
    throw new VmfModifyError(
      "refusing an empty selector: it would delete every brush in the map. Name ids, an " +
        "owner, a material or a bounding box.",
    );
  }
  const { nodes } = parseRoots(source);
  const report = checkVmfSolids("(memory)", source);
  const byId = new Map<number, SolidCheck>();
  for (const s of report.solids) if (s.id !== null) byId.set(s.id, s);

  const found = findSolids(nodes);
  const wanted = found.filter((f) => {
    const check = byId.get(f.id);
    return check ? matchesSolid(check, selector) : false;
  });
  if (wanted.length === 0) {
    return {
      text: source,
      matched: 0,
      deleted: [],
      worldSolidsAfter: found.filter((f) => f.owner === "world").length,
      warnings: ["nothing matched the selector, so nothing was deleted"],
      unchanged: true,
    };
  }

  const hidden = wanted.filter((f) => f.hidden);
  if (hidden.length > 0) {
    throw new VmfModifyError(
      `refusing to delete ${hidden.length} solid(s) inside a hidden block: ` +
        `${hidden.map((h) => h.id).join(", ")}. They are invisible in the editor, so their ` +
        `removal would be invisible too until something else went wrong.`,
    );
  }

  const splices: Splice[] = wanted.map((f) => ({ ...lineRange(source, f.block), text: "" }));
  const warnings: string[] = [];
  const worldAfter = found.filter(
    (f) => f.owner === "world" && !wanted.some((w) => w.id === f.id),
  ).length;
  if (worldAfter === 0 && found.some((f) => f.owner === "world")) {
    warnings.push(
      "this leaves the world with no brushes at all. Nothing in a brush entity seals a " +
        "map, so the next compile will leak.",
    );
  }

  // A brush entity with no solids left is not an entity any more, it is a stray keyvalue
  // block that vbsp will complain about. Say so; removing it is the caller's decision.
  const emptied = new Set<string>();
  for (const f of wanted) {
    if (f.owner === "world") continue;
    const left = found.filter((o) => o.ownerBlock === f.ownerBlock && !wanted.includes(o));
    if (left.length === 0) emptied.add(f.owner);
  }
  if (emptied.size > 0) {
    warnings.push(
      `this empties at least one ${[...emptied].join(", ")} of all its brushes. A brush ` +
        `entity with no solids is a vbsp warning and does nothing in game; delete it with ` +
        `edit_vmf if it is no longer wanted.`,
    );
  }

  return {
    text: applySplices(source, splices),
    matched: wanted.length,
    deleted: wanted.map((f) => ({
      id: f.id,
      owner: f.owner,
      volume: byId.get(f.id)?.volume ?? 0,
    })),
    worldSolidsAfter: worldAfter,
    warnings,
    unchanged: splices.length === 0,
  };
}

function parseRoots(source: string): { nodes: KvBlock[] } {
  const nodes = parse(source).filter((n): n is KvBlock => n.kind === "block");
  return { nodes };
}

function readPoints(side: KvBlock): [Vec3, Vec3, Vec3] | null {
  for (const n of side.entries) {
    if (n.kind === "pair" && n.key === "plane") return parsePlanePoints(n.value);
  }
  return null;
}

function readAxis(side: KvBlock, key: string): TextureAxis | null {
  for (const n of side.entries) {
    if (n.kind === "pair" && n.key === key) return parseTextureAxis(n.value);
  }
  return null;
}
