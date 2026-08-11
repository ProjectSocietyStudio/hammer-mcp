/**
 * Naming what to act on, without holding a selection.
 *
 * Hammer works from a selection: you click brushes, then you act. That model was
 * considered here and rejected. A selection is state living in the server, invisible to
 * the caller between two calls, and the tests would have to simulate it to say anything at
 * all. So every tool takes its own selector, and a call is a complete description of what
 * it did -- replayable, diffable, and readable a month later.
 *
 * `FaceSelector` and its `matches` were written for `set_lightmap_scale` and were already
 * generic: they read a side's material, area and normal, and nothing about lightmaps. They
 * are moved here because `set_face_material` and the alignment tools want exactly them,
 * and a second copy would drift.
 *
 * `SolidSelector` is new. What it deliberately does *not* have is a way to say "the brush
 * I made last call": the caller reads ids back from every writer, and an implicit "last"
 * would be the selection state this file exists to avoid.
 */
import { children, get } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import type { SolidCheck, SolidSide, Vec3 } from "./solid.js";

export interface FaceSelector {
  /** Only faces of these solids. */
  solidIds?: number[];
  /** Only faces whose material contains this, case-insensitively. */
  material?: string;
  /**
   * Only faces pointing this way.
   *
   * `up` is a floor, `down` a ceiling, `side` a wall. The threshold is a normal's Z
   * component past +/-0.7, which is 45 degrees -- a ramp counts as the thing it is closer
   * to being.
   */
  facing?: "up" | "down" | "side" | "any";
  /** Only faces at least this large, in square Hammer units. */
  minArea?: number;
}

export interface SolidSelector {
  /** Hammer ids, as `read_vmf_solids` reports them. */
  ids?: number[];
  /**
   * Only solids owned by this: `world`, or a brush entity's classname such as
   * `func_detail`. Absent means any owner, which includes both.
   */
  owner?: string;
  /**
   * Only solids whose bounding box lies entirely inside this one.
   *
   * Entirely, not partly: a half-caught brush is the classic way a box selection deletes
   * something the caller could not see it had touched.
   */
  within?: { mins: Vec3; maxs: Vec3 };
  /** Only solids carrying this material on at least one face, case-insensitively. */
  material?: string;
}

/** True when the selector names nothing at all, which every caller must refuse. */
export function isEmptySelector(sel: SolidSelector | FaceSelector): boolean {
  return Object.values(sel).every((v) => v === undefined);
}

export function matchesFace(side: SolidSide, sel: FaceSelector): boolean {
  if (sel.material && !side.material.toLowerCase().includes(sel.material.toLowerCase())) {
    return false;
  }
  if (sel.minArea !== undefined && side.area < sel.minArea) return false;
  if (sel.facing && sel.facing !== "any") {
    const z = side.plane?.normal[2] ?? 0;
    if (sel.facing === "up" && z <= 0.7) return false;
    if (sel.facing === "down" && z >= -0.7) return false;
    if (sel.facing === "side" && Math.abs(z) > 0.7) return false;
  }
  return true;
}

export function matchesSolid(solid: SolidCheck, sel: SolidSelector): boolean {
  if (sel.ids && (solid.id === null || !sel.ids.includes(solid.id))) return false;
  if (sel.owner && solid.owner !== sel.owner) return false;
  if (sel.material) {
    const want = sel.material.toLowerCase();
    if (!solid.sides.some((s) => s.material.toLowerCase().includes(want))) return false;
  }
  if (sel.within) {
    for (let axis = 0; axis < 3; axis++) {
      if (solid.mins[axis]! < sel.within.mins[axis]!) return false;
      if (solid.maxs[axis]! > sel.within.maxs[axis]!) return false;
    }
  }
  return true;
}

export interface FoundSolid {
  id: number;
  block: KvBlock;
  owner: string;
  /** The root block it currently sits in. */
  ownerBlock: KvBlock;
  /** True when it sits inside a `hidden` wrapper rather than directly in its owner. */
  hidden: boolean;
}

/**
 * Every `solid` block that carries an id, with where it sits.
 *
 * The counterpart of `matchesSolid`: that one decides *whether* a solid is wanted from what
 * the reader measured, this one finds the block whose bytes have to change. A solid without
 * an id is skipped -- Hammer always writes one, and a tool cannot report having moved
 * something it cannot name afterwards.
 */
export function findSolids(roots: readonly KvBlock[]): FoundSolid[] {
  const out: FoundSolid[] = [];
  const take = (host: KvBlock, ownerBlock: KvBlock, owner: string, hidden: boolean): void => {
    for (const solid of children(host, "solid")) {
      const raw = get(solid, "id");
      if (raw === undefined || !/^\d+$/.test(raw)) continue;
      out.push({ id: Number(raw), block: solid, owner, ownerBlock, hidden });
    }
  };
  for (const root of roots) {
    if (root.name === "world") {
      take(root, root, "world", false);
      for (const h of children(root, "hidden")) take(h, root, "world", true);
    } else if (root.name === "entity") {
      const cls = get(root, "classname") ?? "entity";
      take(root, root, cls, false);
      for (const h of children(root, "hidden")) take(h, root, cls, true);
    }
  }
  return out;
}

/**
 * The span to cut when removing a block, so nothing else goes with it.
 *
 * A block Hammer wrote sits alone on its lines, and taking the whole line with it is what
 * keeps a blank indented line out of the result. A `.vmf` is not obliged to be written that
 * way, though, and the naive version -- from the previous newline to the next one -- was a
 * data-loss bug: given the legal one-line file
 *
 *     world { "id" "1" "classname" "worldspawn" solid { "id" "2" } }
 *
 * deleting the solid removed the whole line and left ` }`. The world, its keyvalues and
 * every entity on that line went with it, and the count check downstream still passed
 * because every solid really had been deleted.
 *
 * So the line is only taken where it belongs to the block: the leading whitespace when
 * nothing else precedes it on that line, and the trailing newline when nothing else
 * follows.
 */
export function lineRange(text: string, block: KvBlock): { start: number; end: number } {
  const lineStart = text.lastIndexOf("\n", block.start - 1) + 1;
  const alone = /^[\t ]*$/.test(text.slice(lineStart, block.start));
  const start = alone ? lineStart : block.start;

  let end = block.end;
  let i = block.end;
  while (i < text.length && (text[i] === "\t" || text[i] === " ")) i += 1;
  if (i < text.length && text[i] === "\n") end = i + 1;
  else if (i >= text.length) end = i;
  // Anything else after the block on its line stays where it is.
  if (end !== block.end && !alone) end = block.end;
  return { start, end };
}

/**
 * Every `side` block of the file, paired with the solid that owns it.
 *
 * `hidden` wrappers are walked too. A hidden brush is still in the file and still compiles
 * into the map -- Hammer's visgroups hide it from the editor, not from vbsp -- so a tool
 * that skipped them would report a count that does not match what ships.
 */
export function eachSide(
  roots: readonly KvBlock[],
): Array<{ solid: KvBlock; side: KvBlock; owner: string; hidden: boolean }> {
  const out: Array<{ solid: KvBlock; side: KvBlock; owner: string; hidden: boolean }> = [];
  const take = (host: KvBlock, owner: string, hidden: boolean): void => {
    for (const solid of children(host, "solid")) {
      for (const side of children(solid, "side")) out.push({ solid, side, owner, hidden });
    }
  };
  for (const root of roots) {
    if (root.name === "world") {
      take(root, "world", false);
      for (const h of children(root, "hidden")) take(h, "world", true);
    } else if (root.name === "entity") {
      const cls = get(root, "classname") ?? "entity";
      take(root, cls, false);
      for (const h of children(root, "hidden")) take(h, cls, true);
    }
  }
  return out;
}
