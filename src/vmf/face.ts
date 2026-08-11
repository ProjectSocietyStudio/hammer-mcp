/**
 * Editing the faces of brushes already in the file: material, texture alignment, smoothing.
 *
 * `set_lightmap_scale` was the only writer of a face, and it left a strange gap: the tool
 * could tell vrad how finely to light a wall but nothing could say what the wall was made
 * of. A brush's material was fixed at creation and there was no way to change it.
 *
 * The reconciliation in `resolveFaces` is the fiddly part, and it is worth stating once
 * rather than rediscovering. Two views of a face have to be lined up: the `side` block,
 * whose bytes get edited, and the `SolidSide` the reader measured, which is where the
 * normal, the corners and the area come from. They are matched by `id` first and by plane
 * distance second, because a `.vmf` written by something other than Hammer may carry no
 * side ids at all. `set_lightmap_scale` already did this; the logic moved here so there is
 * one copy for four tools rather than four copies.
 */
import { get, parse } from "../kv/parse.js";
import type { KvBlock, KvNode } from "../kv/parse.js";
import { eachSide, matchesFace } from "./select.js";
import type { FaceSelector } from "./select.js";
import { textureAxesFor } from "./build.js";
import { checkSolid, parsePlanePoints, planeFromPoints } from "./solid.js";
import type { SolidSide, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfFaceError";
  }
}

export interface ResolvedFace {
  solidId: number;
  owner: string;
  /** The block whose bytes change. */
  block: KvBlock;
  /** What the reader measured for it: normal, corners, area, texture axes. */
  side: SolidSide;
  hidden: boolean;
}

/** Every face the selector names, with both views of it lined up. */
export function resolveFaces(source: string, selector: FaceSelector): ResolvedFace[] {
  const nodes: KvNode[] = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const sides = eachSide(roots);

  const geometry = new Map<KvBlock, ReturnType<typeof checkSolid>>();
  for (const { solid, owner } of sides) {
    if (!geometry.has(solid)) geometry.set(solid, checkSolid(solid, owner, 0));
  }

  const wanted = selector.solidIds ? new Set(selector.solidIds) : null;
  const out: ResolvedFace[] = [];
  for (const { solid, side, owner, hidden } of sides) {
    const checked = geometry.get(solid)!;
    if (wanted && !wanted.has(checked.id ?? -1)) continue;

    const sideIdRaw = get(side, "id");
    const sideId = sideIdRaw !== undefined && /^\d+$/.test(sideIdRaw) ? Number(sideIdRaw) : null;
    const planeText = get(side, "plane");
    const parsed =
      checked.sides.find((s) => s.id !== null && s.id === sideId) ??
      checked.sides.find((s) => {
        const pts = planeText ? parsePlanePoints(planeText) : null;
        const p = pts ? planeFromPoints(...pts) : null;
        return p && s.plane && Math.abs(p.dist - s.plane.dist) < 0.01;
      });
    if (!parsed || !matchesFace(parsed, selector)) continue;
    out.push({ solidId: checked.id ?? -1, owner, block: side, side: parsed, hidden });
  }
  return out;
}

/** Replaces a pair inside a block, or inserts one where Hammer would put it. */
export function setSidePair(
  source: string,
  block: KvBlock,
  key: string,
  value: string,
  splices: Splice[],
): boolean {
  for (const node of block.entries) {
    if (node.kind === "pair" && node.key === key) {
      if (node.value === value) return false;
      splices.push({ start: node.start, end: node.end, text: `"${key}" "${value}"` });
      return true;
    }
  }
  // Copy the indentation of the pair above rather than assuming a tab depth: a side sits
  // three levels down in a world brush and four in one owned by a hidden block.
  const first = block.entries.find((n) => n.kind === "pair");
  const at = first ? first.start : block.bodyEnd;
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const indent = source.slice(lineStart, at).match(/^[\t ]*/)?.[0] ?? "\t\t\t";
  splices.push({ start: at, end: at, text: `"${key}" "${value}"\n${indent}` });
  return true;
}

export interface FaceEditResult {
  text: string;
  /** Faces the selector matched, whether or not they needed changing. */
  matched: number;
  changed: Array<{ solidId: number; sideId: number | null; from: string; to: string }>;
  warnings: string[];
  unchanged: boolean;
}

/**
 * Sets the material on every selected face.
 *
 * The material name is stored as Hammer writes it: uppercase, forward slashes, no
 * `materials/` prefix and no `.vmt` suffix. A caller who passes a path instead gets it
 * normalised rather than a map full of purple checkerboard, because vbsp resolves the name
 * literally and a wrong one is invisible until a player loads the map.
 *
 * Whether the material *exists* is not checked here: this file is pure text work and knows
 * nothing about where a game is installed. `read_game_content` answers that, and the tool
 * says so rather than implying it checked.
 */
export function setFaceMaterial(
  source: string,
  selector: FaceSelector,
  material: string,
): FaceEditResult {
  const clean = normaliseMaterial(material);
  if (clean.length === 0) throw new VmfFaceError("material name is empty");

  const faces = resolveFaces(source, selector);
  const splices: Splice[] = [];
  const changed: FaceEditResult["changed"] = [];
  const warnings: string[] = [];

  for (const face of faces) {
    if (face.side.material === clean) continue;
    if (face.side.hasDisplacement && !isTool(clean) && isTool(face.side.material)) {
      warnings.push(
        `solid ${face.solidId}: a face carrying a displacement had a tool texture and now ` +
          `has ${clean}. That is usually right, but check it was not the nodraw side.`,
      );
    }
    if (setSidePair(source, face.block, "material", clean, splices)) {
      changed.push({
        solidId: face.solidId,
        sideId: face.side.id,
        from: face.side.material,
        to: clean,
      });
    }
  }

  if (faces.length === 0) warnings.push("nothing matched the selector, so nothing changed");
  if (isTool(clean) && clean !== "TOOLS/TOOLSNODRAW") {
    warnings.push(
      `${clean} is a tool texture: vbsp gives it behaviour rather than an appearance. ` +
        `Check that is what was meant on ${changed.length} face(s).`,
    );
  }

  const text = applySplices(source, splices);
  return { text, matched: faces.length, changed, warnings, unchanged: text === source };
}

const isTool = (m: string): boolean => m.toUpperCase().startsWith("TOOLS/");

/**
 * Puts a material name into the form a `.vmf` stores.
 *
 * Hammer writes `BRICK/BRICKWALL001A`: uppercase, forward slashes, no leading `materials/`
 * and no `.vmt`. A caller holding a path from `read_map_dependencies` has all three of
 * those, and vbsp would resolve the result to nothing at all.
 */
export function normaliseMaterial(material: string): string {
  return material
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^materials\//i, "")
    .replace(/\.vmt$/i, "")
    .toUpperCase();
}


export type AlignMode = "world" | "face" | "fit";

export interface AlignOptions {
  mode: AlignMode;
  /** Multiply both texture scales by this afterwards. */
  scale?: number;
  /** Turn the axis pair in the face's own plane, in degrees. */
  rotate?: number;
  /** Add to the u and v offsets, in texels. */
  shift?: [number, number];
  /** For `fit`, how many times the texture repeats across the face. Default once. */
  repeat?: [number, number];
}

export interface AlignChange {
  solidId: number;
  sideId: number | null;
  material: string;
  uaxis: string;
  vaxis: string;
}

export interface AlignResult {
  text: string;
  matched: number;
  changed: AlignChange[];
  warnings: string[];
  unchanged: boolean;
}

/**
 * Realigns the texture on every selected face.
 *
 * Three modes, which are Hammer's three:
 *
 * **`world`** derives the axes from the face's dominant normal, using vbsp's own
 * `baseaxis` table -- the same `textureAxesFor` that `write_vmf_solid` uses, already
 * cross-checked against all six branches of a fixture that compiled and booted. This is
 * what a face gets when it is created, and what "Align to World" restores.
 *
 * **`face`** projects the world axes onto the face's own plane, so the texture runs along
 * the surface rather than being projected onto it from outside. On a slope that is the
 * difference between a brick wall and a brick wall seen through a squashing lens.
 *
 * **`fit`** stretches the texture to span the face exactly, which needs the face's extent
 * along each axis -- available because the reader already computed the corners.
 *
 * The offsets are always recomputed from a corner of the face, never carried over. An axis
 * pair without a matching offset puts the texture somewhere else entirely, and that is the
 * single most common way an alignment tool produces a map that compiles and looks wrong.
 */
export function alignFaces(
  source: string,
  selector: FaceSelector,
  options: AlignOptions,
): AlignResult {
  const faces = resolveFaces(source, selector);
  const splices: Splice[] = [];
  const changed: AlignChange[] = [];
  const warnings: string[] = [];

  for (const face of faces) {
    const side = face.side;
    if (!side.plane || side.vertices.length < 3) {
      warnings.push(`solid ${face.solidId}: a face bounds nothing, so it was left alone`);
      continue;
    }
    if (side.hasDisplacement) {
      warnings.push(
        `solid ${face.solidId}: skipped a face carrying a displacement. Its texture axes ` +
          `are shared by the whole displacement surface, and realigning one face of it ` +
          `moves the blend with the neighbours it is sewn to.`,
      );
      continue;
    }

    const base = textureAxesFor(side.plane.normal);
    let u: Vec3 = base.u;
    let v: Vec3 = base.v;

    if (options.mode === "face") {
      // Project each world axis into the plane and renormalise. On an axis-aligned face
      // this changes nothing, which is why the world-mode oracle still covers it there.
      const p = (a: Vec3): Vec3 => {
        const n = side.plane!.normal;
        const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
        const out: Vec3 = [a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2]];
        const l = Math.hypot(out[0], out[1], out[2]);
        return l < 1e-9 ? a : [out[0] / l, out[1] / l, out[2] / l];
      };
      u = p(u);
      v = p(v);
    }

    if (options.rotate) {
      const rad = (options.rotate * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      const ru: Vec3 = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
      const rv: Vec3 = [v[0] * c - u[0] * s, v[1] * c - u[1] * s, v[2] * c - u[2] * s];
      u = ru;
      v = rv;
    }

    // Extent of the face along each axis, from the corners the reader recovered.
    const span = (a: Vec3): { lo: number; hi: number } => {
      const p = side.vertices.map((w) => w[0] * a[0] + w[1] * a[1] + w[2] * a[2]);
      return { lo: Math.min(...p), hi: Math.max(...p) };
    };
    const su = span(u);
    const sv = span(v);

    let uScale = options.mode === "fit" ? 1 : (side.uaxis?.scale ?? 0.25);
    let vScale = options.mode === "fit" ? 1 : (side.vaxis?.scale ?? 0.25);
    if (options.mode === "fit") {
      // A texture is 512 texels at most and its real size is unknown offline, so `fit` is
      // expressed in texels per unit and the caller is told so rather than being given a
      // number that silently assumes 512.
      const [ru, rv] = options.repeat ?? [1, 1];
      uScale = (su.hi - su.lo) / (TEXELS_ASSUMED * ru);
      vScale = (sv.hi - sv.lo) / (TEXELS_ASSUMED * rv);
    }
    if (options.scale !== undefined) {
      // Tested explicitly against undefined rather than for truthiness: zero is falsy, so
      // `if (options.scale)` silently ignored the one value that must be refused.
      if (options.scale === 0) {
        throw new VmfFaceError("a texture scale of zero is one vbsp refuses outright");
      }
      uScale *= options.scale;
      vScale *= options.scale;
    }

    // Anchor at the low corner so the texture starts at the face's edge, then apply the
    // caller's shift. Carrying the old offset over is what makes a realigned face slide.
    let uOff = -su.lo / uScale;
    let vOff = -sv.lo / vScale;
    if (options.shift) {
      uOff += options.shift[0];
      vOff += options.shift[1];
    }

    const uText = `[${fmtVec(u)} ${fmtNum(uOff)}] ${fmtNum(uScale)}`;
    const vText = `[${fmtVec(v)} ${fmtNum(vOff)}] ${fmtNum(vScale)}`;
    const a = setSidePair(source, face.block, "uaxis", uText, splices);
    const b = setSidePair(source, face.block, "vaxis", vText, splices);
    if (a || b) {
      changed.push({
        solidId: face.solidId,
        sideId: side.id,
        material: side.material,
        uaxis: uText,
        vaxis: vText,
      });
    }
  }

  if (faces.length === 0) warnings.push("nothing matched the selector, so nothing changed");
  if (options.mode === "fit") {
    warnings.push(
      `fit assumes a ${TEXELS_ASSUMED}-texel texture, because the .vmt is not read here. ` +
        `Check the result against the real size with read_game_content if it matters.`,
    );
  }

  const text = applySplices(source, splices);
  return { text, matched: faces.length, changed, warnings, unchanged: text === source };
}

/**
 * The texture size `fit` assumes when it cannot read one.
 *
 * 512 is the most common size in Source's own content and in Garry's Mod's, but it is an
 * assumption and the tool says so in a warning rather than presenting the result as a
 * measurement. Reading the real height needs the `.vmt`, then the `.vtf` header, then the
 * game's filesystem -- which is `read_game_content`'s job, not this file's.
 */
export const TEXELS_ASSUMED = 512;

/**
 * Six decimals, not the four the geometry writers use.
 *
 * A texture scale is a small number that divides: fitting a 576-unit face with four
 * repeats of a 512-texel texture gives 0.28125, and rounding that to four decimals moves
 * the far edge of the face by a fifth of a texel. Plane points are large numbers that do
 * not divide, so four is plenty for them.
 */
const fmtNum = (n: number): string =>
  Number.isInteger(n) ? String(n) : Number(n.toFixed(6)).toString();
const fmtVec = (v: Vec3): string => `${fmtNum(v[0])} ${fmtNum(v[1])} ${fmtNum(v[2])}`;

export interface SmoothingResult extends AlignResult {
  groups: number;
}

/**
 * Sets the smoothing groups on every selected face.
 *
 * A bitmask of 32 groups. Two faces sharing an edge and a group are lit as one continuous
 * surface by vrad; without it every facet of a curve is lit separately and reads as the
 * flat polygons it really is. It is stored as a decimal integer, and Hammer's dialog
 * numbers the groups 1 to 32 while the file counts bits from zero -- so this takes group
 * numbers and does the shifting, rather than making the caller compute 4096 and hope.
 *
 * Group 33 in Hammer's dialog does not exist: what looks like a 33rd button is the
 * "unset all" control.
 */
export function setSmoothingGroups(
  source: string,
  selector: FaceSelector,
  groups: readonly number[],
): SmoothingResult {
  let mask = 0;
  for (const g of groups) {
    if (!Number.isInteger(g) || g < 1 || g > 32) {
      throw new VmfFaceError(
        `smoothing group ${g} does not exist: Hammer numbers them 1 to 32, and the file ` +
          `stores that as a bitmask`,
      );
    }
    mask |= 1 << (g - 1);
  }

  const faces = resolveFaces(source, selector);
  const splices: Splice[] = [];
  const changed: AlignChange[] = [];
  const warnings: string[] = [];
  for (const face of faces) {
    if (setSidePair(source, face.block, "smoothing_groups", String(mask >>> 0), splices)) {
      changed.push({
        solidId: face.solidId,
        sideId: face.side.id,
        material: face.side.material,
        uaxis: "",
        vaxis: "",
      });
    }
  }
  if (faces.length === 0) warnings.push("nothing matched the selector, so nothing changed");
  if (mask !== 0 && faces.length === 1) {
    warnings.push(
      "one face was given a smoothing group. Smoothing is a property of a pair of faces " +
        "sharing an edge, so a group of one changes nothing vrad can see.",
    );
  }

  const text = applySplices(source, splices);
  return {
    text,
    matched: faces.length,
    changed,
    groups: mask >>> 0,
    warnings,
    unchanged: text === source,
  };
}
