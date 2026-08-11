/**
 * Writing displacements: creating them, sewing them, painting them, shaping them.
 *
 * `./displacement.ts` came first and is the reason this file can be checked at all. Every
 * writer here is judged by reading its own result back through it, and by srctools reading
 * the same file and agreeing.
 *
 * The one thing worth stating before the code: **a displacement is not geometry the way a
 * brush is.** vbsp builds the map's hull from the brush's own planes and draws the terrain
 * over the top, so displacing a wall does not move the wall -- it leaves a wall-shaped hole
 * in the world with a hillside painted on it. That is why `write_displacement` warns about
 * a world brush and why nothing here will displace a face of a sealing hull quietly.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { readDisplacements } from "./displacement.js";
import type { Displacement, DispVertex } from "./displacement.js";
import { resolveFaces } from "./face.js";
import type { FaceSelector } from "./select.js";
import { orderedLoop } from "./solid.js";
import type { Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfDispWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfDispWriteError";
  }
}

/** Hammer's dialog offers these; 0 and 1 are legal and nobody builds terrain with them. */
export const USEFUL_POWERS = [2, 3, 4] as const;

export interface DispWriteResult {
  text: string;
  /** Faces the selector matched. */
  matched: number;
  created: Array<{ solidId: number; sideIndex: number; power: number; vertices: number }>;
  warnings: string[];
  unchanged: boolean;
}

const fmt = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(4)).toString();

/** One `rowN` block, as Hammer writes it. */
function rowBlock(
  name: string,
  size: number,
  indent: string,
  value: (x: number, y: number) => number[],
): string {
  const rows: string[] = [];
  for (let y = 0; y < size; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < size; x += 1) row.push(...value(x, y));
    rows.push(`${indent}\t"row${y}" "${row.map(fmt).join(" ")}"`);
  }
  return `${indent}${name}\n${indent}{\n${rows.join("\n")}\n${indent}}\n`;
}

export interface DispSpec {
  power: number;
  /**
   * Distance along each vertex's normal, given its grid coordinates.
   *
   * Absent means a flat sheet, which is what Hammer's "create displacement" makes and what
   * a mapper then sculpts.
   */
  height?: (x: number, y: number, size: number) => number;
  /** The blend, 0 to 255. Absent leaves it unpainted. */
  alpha?: (x: number, y: number, size: number) => number;
  /** Face normal to push along. Defaults to the face's own. */
  elevation?: number;
}

/**
 * The `dispinfo` text for one face.
 *
 * `startposition` names the corner the grid walks from, and it must be one of the face's
 * own corners: Source finds the nearest, so a position that is merely near the face gives
 * a grid rotated by a quarter turn, which reads as terrain that has been mirrored.
 */
export function dispInfoText(
  spec: DispSpec,
  corner: Vec3,
  normal: Vec3,
  indent: string,
): string {
  const size = 2 ** spec.power + 1;
  const tagRows: string[] = [];
  for (let y = 0; y < 2 ** spec.power; y += 1) {
    tagRows.push(`${indent}\t\t"row${y}" "${new Array(2 * 2 ** spec.power).fill(9).join(" ")}"`);
  }
  const inner = `${indent}\t`;

  return (
    `${indent}dispinfo\n${indent}{\n` +
    `${inner}"power" "${spec.power}"\n` +
    `${inner}"startposition" "[${corner.map(fmt).join(" ")}]"\n` +
    `${inner}"flags" "0"\n` +
    `${inner}"elevation" "${fmt(spec.elevation ?? 0)}"\n` +
    `${inner}"subdiv" "0"\n` +
    rowBlock("normals", size, inner, () => [normal[0], normal[1], normal[2]]) +
    rowBlock("distances", size, inner, (x, y) => [spec.height ? spec.height(x, y, size) : 0]) +
    rowBlock("offsets", size, inner, () => [0, 0, 0]) +
    rowBlock("offset_normals", size, inner, () => [normal[0], normal[1], normal[2]]) +
    rowBlock("alphas", size, inner, (x, y) => [spec.alpha ? spec.alpha(x, y, size) : 0]) +
    `${inner}triangle_tags\n${inner}{\n${tagRows.join("\n")}\n${inner}}\n` +
    `${inner}allowed_verts\n${inner}{\n${inner}\t"10" "-1 -1 -1 -1 -1 -1 -1 -1 -1 -1"\n${inner}}\n` +
    `${indent}}\n`
  );
}

/**
 * Puts a displacement on every selected face.
 *
 * Refuses a face that already has one -- replacing it silently would throw away whatever
 * had been sculpted and painted onto it, which is the most expensive thing in a terrain
 * and the least visible in a diff.
 */
export function writeDisplacements(
  source: string,
  selector: FaceSelector,
  spec: DispSpec,
): DispWriteResult {
  if (!USEFUL_POWERS.includes(spec.power as (typeof USEFUL_POWERS)[number])) {
    throw new VmfDispWriteError(
      `power must be 2, 3 or 4, not ${spec.power}. Source accepts 0 and 1 and no terrain ` +
        `is built with them: a power-1 displacement is a 3x3 grid.`,
    );
  }

  const faces = resolveFaces(source, selector);
  const splices: Splice[] = [];
  const warnings: string[] = [];
  const created: DispWriteResult["created"] = [];

  for (const face of faces) {
    if (face.side.hasDisplacement) {
      throw new VmfDispWriteError(
        `solid ${face.solidId} already has a displacement on that face. Replacing it would ` +
          `discard whatever was sculpted and painted onto it, which is the most expensive ` +
          `thing in a terrain and the least visible in a diff.`,
      );
    }
    if (!face.side.plane || face.side.vertices.length !== 4) {
      warnings.push(
        `solid ${face.solidId}: a face with ${face.side.vertices.length} corners cannot be ` +
          `displaced. Source only displaces quadrilaterals.`,
      );
      continue;
    }

    const loop = orderedLoop(face.side.vertices, face.side.plane.normal);
    const corner = loop[0]!;
    const indent = indentOf(source, face.block) + "\t";
    const text = dispInfoText(spec, corner, face.side.plane.normal, indent);
    splices.push({ start: face.block.bodyEnd, end: face.block.bodyEnd, text });
    created.push({
      solidId: face.solidId,
      sideIndex: 0,
      power: spec.power,
      vertices: (2 ** spec.power + 1) ** 2,
    });
  }

  if (faces.length === 0) warnings.push("nothing matched the selector, so nothing was created");

  const text = applySplices(source, splices);
  return { text, matched: faces.length, created, warnings, unchanged: text === source };
}

function indentOf(source: string, block: KvBlock): string {
  const lineStart = source.lastIndexOf("\n", block.start - 1) + 1;
  return source.slice(lineStart, block.start).match(/^[\t ]*/)?.[0] ?? "\t\t\t";
}

export { children, get, parse, readDisplacements };
export type { Displacement, DispVertex };

export interface SewResult {
  text: string;
  /** Vertex pairs that were pulled together. */
  moved: number;
  /** Worst gap before, and after. */
  worstBefore: number;
  worstAfter: number;
  warnings: string[];
  unchanged: boolean;
}

/**
 * Pulls apart displacements back together along the edges they share.
 *
 * Two vertices belong together when their *undisplaced* positions coincide -- the faces
 * share that point, whatever either grid has since done to it. Each such group is moved to
 * the average of its members, which is what Hammer's Sew does and what keeps a ridge from
 * being dragged to one side of the join.
 *
 * The oracle is exact and it is the reader: after sewing, `findSeams` must report nothing.
 * That is a stronger check than it looks, because the reader decides adjacency the same way
 * this does and would find any pair this missed.
 */
export function sewDisplacements(source: string, tolerance = 0.1): SewResult {
  // The grouping key divides every coordinate by the tolerance, so a zero produces
  // Infinity and NaN keys: unrelated vertices land in one group and their distances are
  // averaged together, which reshapes several displacements at once. A caller asking for
  // exact matching is asking for something this cannot do, and must hear so.
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new VmfDispWriteError(
      `sew tolerance must be a positive number, not ${tolerance}. Zero would group every ` +
        `vertex of the map into one and average them together.`,
    );
  }
  const before = readDisplacements(source);
  if (before.displacements.length < 2) {
    return {
      text: source,
      moved: 0,
      worstBefore: 0,
      worstAfter: 0,
      warnings: ["fewer than two displacements, so there is no seam to sew"],
      unchanged: true,
    };
  }

  // Group every vertex by where it sits on the flat face, rounded to the tolerance. Two
  // grids that share an edge put their vertices on the same flat points, so the groups of
  // more than one are exactly the joins.
  const key = (v: Vec3): string =>
    `${Math.round(v[0] / tolerance)},${Math.round(v[1] / tolerance)},${Math.round(v[2] / tolerance)}`;
  const groups = new Map<string, Array<{ disp: Displacement; vertex: DispVertex }>>();
  for (const disp of before.displacements) {
    for (const vertex of disp.vertices) {
      const k = key(vertex.flat);
      const list = groups.get(k);
      if (list) list.push({ disp, vertex });
      else groups.set(k, [{ disp, vertex }]);
    }
  }

  // What each vertex's distance has to become for the group to meet in the middle. The
  // normals are shared along a join in every terrain Hammer builds, so averaging the
  // distances is averaging the positions -- and where they are not, the check afterwards
  // is what says so rather than this arithmetic.
  const wanted = new Map<Displacement, Map<string, number>>();
  let worstBefore = 0;
  let moved = 0;

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const owners = new Set(list.map((m) => m.disp));
    if (owners.size < 2) continue;

    const distances = list.map((m) => m.vertex.distance);
    const spread = Math.max(...distances) - Math.min(...distances);
    if (spread <= tolerance) continue;
    if (spread > worstBefore) worstBefore = spread;

    const average = distances.reduce((a, b) => a + b, 0) / distances.length;
    for (const member of list) {
      if (Math.abs(member.vertex.distance - average) <= tolerance) continue;
      const per = wanted.get(member.disp) ?? new Map<string, number>();
      per.set(`${member.vertex.x},${member.vertex.y}`, average);
      wanted.set(member.disp, per);
      moved += 1;
    }
  }

  if (moved === 0) {
    return {
      text: source,
      moved: 0,
      worstBefore: 0,
      worstAfter: 0,
      warnings: ["every shared vertex already agreed, so nothing was moved"],
      unchanged: true,
    };
  }

  const text = rewriteDistances(source, before.displacements, wanted);
  const after = readDisplacements(text);
  const worstAfter = after.seams.reduce((m, s) => Math.max(m, s.worstGap), 0);

  const warnings: string[] = [];
  if (after.seams.length > 0) {
    warnings.push(
      `${after.seams.length} seam(s) are still open after sewing, the worst by ` +
        `${worstAfter.toFixed(3)} units. That happens when the two grids meet at different ` +
        `resolutions or their normals disagree, and it is not something averaging can fix.`,
    );
  }

  return { text, moved, worstBefore, worstAfter, warnings, unchanged: text === source };
}

/** Rewrites the `distances` rows of the named displacements, and nothing else. */
function rewriteDistances(
  source: string,
  displacements: readonly Displacement[],
  wanted: ReadonlyMap<Displacement, Map<string, number>>,
): string {
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const splices: Splice[] = [];

  for (const [disp, changes] of wanted) {
    const block = findDispBlock(roots, disp);
    if (!block) continue;
    const distances = children(block, "distances")[0];
    if (!distances) continue;

    for (let y = 0; y < disp.size; y += 1) {
      const pair = distances.entries.find(
        (n): n is Extract<typeof n, { kind: "pair" }> => n.kind === "pair" && n.key === `row${y}`,
      );
      if (!pair) continue;
      const row: number[] = [];
      for (let x = 0; x < disp.size; x += 1) {
        const override = changes.get(`${x},${y}`);
        const current = disp.vertices[y * disp.size + x]!.distance;
        row.push(override ?? current);
      }
      const text = `"row${y}" "${row.map(fmt).join(" ")}"`;
      if (source.slice(pair.start, pair.end) !== text) {
        splices.push({ start: pair.start, end: pair.end, text });
      }
    }
  }

  return applySplices(source, splices);
}

/** The `dispinfo` block of a displacement the reader already found. */
function findDispBlock(roots: readonly KvBlock[], disp: Displacement): KvBlock | null {
  for (const root of roots) {
    for (const host of [root, ...children(root, "hidden")]) {
      for (const solid of children(host, "solid")) {
        if (get(solid, "id") !== String(disp.solidId)) continue;
        const sides = solid.entries.filter(
          (n): n is KvBlock => n.kind === "block" && n.name === "side",
        );
        const side = sides[disp.sideIndex];
        if (!side) continue;
        return children(side, "dispinfo")[0] ?? null;
      }
    }
  }
  return null;
}

export interface SculptResult extends SewResult {
  /** Extremes of the new relief, so a caller can see what it asked for. */
  minDistance: number;
  maxDistance: number;
}

export type SculptShape =
  | { kind: "flatten" }
  | { kind: "raise"; by: number }
  | { kind: "slope"; from: number; to: number; along: "x" | "y" }
  | { kind: "noise"; amplitude: number; seed: number };

/**
 * Reshapes selected displacements.
 *
 * Declarative shapes rather than a vertex table, and `noise` takes a seed rather than
 * reaching for a random number generator. A shape that cannot be stated twice cannot be
 * tested at all, and a terrain nobody can regenerate is a terrain nobody can review.
 */
export function sculptDisplacements(
  source: string,
  selector: { solidIds?: number[] },
  shape: SculptShape,
): SculptResult {
  const before = readDisplacements(source);
  const wanted = before.displacements.filter(
    (d) => !selector.solidIds || selector.solidIds.includes(d.solidId),
  );
  if (wanted.length === 0) {
    return {
      text: source,
      moved: 0,
      worstBefore: 0,
      worstAfter: 0,
      minDistance: 0,
      maxDistance: 0,
      warnings: ["no displacement matched the selector"],
      unchanged: true,
    };
  }

  const changes = new Map<Displacement, Map<string, number>>();
  let min = Infinity;
  let max = -Infinity;
  let moved = 0;

  for (const disp of wanted) {
    const per = new Map<string, number>();
    for (const v of disp.vertices) {
      const next = heightFor(shape, v, disp.size);
      if (next < min) min = next;
      if (next > max) max = next;
      if (Math.abs(next - v.distance) < 1e-6) continue;
      per.set(`${v.x},${v.y}`, next);
      moved += 1;
    }
    if (per.size > 0) changes.set(disp, per);
  }

  const text = rewriteDistances(source, before.displacements, changes);
  const after = readDisplacements(text);
  const warnings: string[] = [];
  if (after.seams.length > 0) {
    warnings.push(
      `${after.seams.length} seam(s) are open after this. Sculpting one displacement of a ` +
        `terrain moves the edge it shares with its neighbours; sew afterwards.`,
    );
  }

  return {
    text,
    moved,
    worstBefore: 0,
    worstAfter: after.seams.reduce((m, s) => Math.max(m, s.worstGap), 0),
    minDistance: Number.isFinite(min) ? min : 0,
    maxDistance: Number.isFinite(max) ? max : 0,
    warnings,
    unchanged: text === source,
  };
}

function heightFor(shape: SculptShape, v: DispVertex, size: number): number {
  switch (shape.kind) {
    case "flatten":
      return 0;
    case "raise":
      return v.distance + shape.by;
    case "slope": {
      const t = (shape.along === "x" ? v.x : v.y) / (size - 1);
      return shape.from + (shape.to - shape.from) * t;
    }
    case "noise":
      return v.distance + shape.amplitude * (hash(v.x, v.y, shape.seed) * 2 - 1);
  }
}

/**
 * A deterministic value in [0, 1) from a grid coordinate and a seed.
 *
 * Not `Math.random`: a terrain that cannot be regenerated from what produced it cannot be
 * reviewed, cannot be tested, and cannot be regenerated after a merge. The mix is the
 * usual integer hash -- its statistical quality does not matter here, only that it is the
 * same every time and does not band along either axis.
 */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface PaintResult extends SewResult {
  painted: number;
  minAlpha: number;
  maxAlpha: number;
}

export type AlphaRule =
  | { kind: "uniform"; alpha: number }
  | { kind: "byHeight"; low: number; high: number }
  | { kind: "bySlope"; degrees: number };

/**
 * Paints the blend channel of selected displacements.
 *
 * A blend material draws its second texture where alpha is 255 and its first where it is
 * zero, which is how a gravel path appears through grass. `byHeight` and `bySlope` are the
 * two rules a mapper actually reaches for: dirt above a line, rock on anything steep.
 */
export function paintDisplacements(
  source: string,
  selector: { solidIds?: number[] },
  rule: AlphaRule,
): PaintResult {
  const before = readDisplacements(source);
  const wanted = before.displacements.filter(
    (d) => !selector.solidIds || selector.solidIds.includes(d.solidId),
  );
  if (wanted.length === 0) {
    return {
      text: source,
      moved: 0,
      painted: 0,
      minAlpha: 0,
      maxAlpha: 0,
      worstBefore: 0,
      worstAfter: 0,
      warnings: ["no displacement matched the selector"],
      unchanged: true,
    };
  }

  const warnings: string[] = [];
  const unblended = wanted.filter((d) => !/blend|wvt/i.test(d.material));
  if (unblended.length > 0) {
    warnings.push(
      `${unblended.length} of these carry a material with no blend in its name ` +
        `(${unblended[0]!.material}). Alpha does nothing on a material that is not a blend ` +
        `shader, and vbsp does not say so.`,
    );
  }

  const splices: Splice[] = [];
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  let painted = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const disp of wanted) {
    const block = findDispBlock(roots, disp);
    if (!block) continue;
    const alphas = children(block, "alphas")[0];
    if (!alphas) continue;

    for (let y = 0; y < disp.size; y += 1) {
      const pair = alphas.entries.find(
        (n): n is Extract<typeof n, { kind: "pair" }> => n.kind === "pair" && n.key === `row${y}`,
      );
      if (!pair) continue;
      const row: number[] = [];
      for (let x = 0; x < disp.size; x += 1) {
        const v = disp.vertices[y * disp.size + x]!;
        const a = clampAlpha(alphaFor(rule, v, disp));
        if (a !== v.alpha) painted += 1;
        if (a < min) min = a;
        if (a > max) max = a;
        row.push(a);
      }
      const text = `"row${y}" "${row.map(fmt).join(" ")}"`;
      if (source.slice(pair.start, pair.end) !== text) {
        splices.push({ start: pair.start, end: pair.end, text });
      }
    }
  }

  const text = applySplices(source, splices);
  return {
    text,
    moved: 0,
    painted,
    minAlpha: Number.isFinite(min) ? min : 0,
    maxAlpha: Number.isFinite(max) ? max : 0,
    worstBefore: 0,
    worstAfter: 0,
    warnings,
    unchanged: text === source,
  };
}

const clampAlpha = (a: number): number => Math.max(0, Math.min(255, Math.round(a)));

/**
 * The normal of the terrain itself at one vertex, from where its neighbours ended up.
 *
 * Central differences inside the grid and one-sided at the edges, then a cross product.
 * This is the only thing that can answer "how steep is it here", because the grid's own
 * normals say where a vertex was pushed and not what shape resulted.
 */
function surfaceNormalAt(disp: Displacement, x: number, y: number): Vec3 | null {
  const at = (px: number, py: number): Vec3 | null => {
    if (px < 0 || py < 0 || px >= disp.size || py >= disp.size) return null;
    return disp.vertices[py * disp.size + px]!.position;
  };
  const along = (a: Vec3 | null, b: Vec3 | null): Vec3 | null =>
    a && b ? [a[0] - b[0], a[1] - b[1], a[2] - b[2]] : null;

  const dx = along(at(x + 1, y), at(x - 1, y)) ?? along(at(x + 1, y), at(x, y)) ?? along(at(x, y), at(x - 1, y));
  const dy = along(at(x, y + 1), at(x, y - 1)) ?? along(at(x, y + 1), at(x, y)) ?? along(at(x, y), at(x, y - 1));
  if (!dx || !dy) return null;

  const n: Vec3 = [
    dx[1] * dy[2] - dx[2] * dy[1],
    dx[2] * dy[0] - dx[0] * dy[2],
    dx[0] * dy[1] - dx[1] * dy[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len < 1e-9 ? null : [n[0] / len, n[1] / len, n[2] / len];
}

function alphaFor(rule: AlphaRule, v: DispVertex, disp: Displacement): number {
  switch (rule.kind) {
    case "uniform":
      return rule.alpha;
    case "byHeight": {
      // Linear between the two heights, so a shoreline fades rather than steps.
      if (rule.high === rule.low) return v.position[2] >= rule.high ? 255 : 0;
      const t = (v.position[2] - rule.low) / (rule.high - rule.low);
      return 255 * Math.max(0, Math.min(1, t));
    }
    case "bySlope": {
      // From the displaced surface, not from `v.normal`. That field is the direction the
      // vertex is pushed *along*, and every vertex of a displacement this toolkit creates
      // carries the base face's normal -- sculpting changes distances and never touches
      // it. So reading the slope from it made a hillside sculpted onto a floor compute as
      // 0 degrees and never paint, and a wall compute as 90 and always paint. The rule
      // could not fire, and nothing said so.
      const n = surfaceNormalAt(disp, v.x, v.y);
      if (!n) return 0;
      const up = Math.abs(n[2]);
      const angle = (Math.acos(Math.max(-1, Math.min(1, up))) * 180) / Math.PI;
      return angle >= rule.degrees ? 255 : 0;
    }
  }
}
