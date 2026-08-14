/**
 * A collision scene built from a `.vmf`, so an agent can measure the map it is editing.
 *
 * Everything spatial in this server used to go through `../bsp/trace.ts`, which reads a
 * **compiled** map. That is a good tracer -- it is the engine's own recursion -- and it
 * answers the wrong question: it can only speak about the map as it was when vbsp last ran.
 * An agent that has just moved a wall cannot ask whether the corridor is still wide enough
 * without a compile, and a compile takes minutes. So it does not ask, and it places by
 * feel.
 *
 * This file is the other half. A brush in a `.vmf` is already an intersection of
 * half-spaces -- `../vmf/solid.ts` reconstructs exactly that as its oracle -- so tracing
 * against it needs no compilation, no lump format and no toolchain. It needs a broadphase
 * and Quake's brush clip, which is what `bvh.ts` and `trace.ts` are.
 *
 * ## The rule that keeps the oracle honest
 *
 * **Nothing under `src/space/` may import `src/bsp/`.** The BSP tracer is this engine's
 * independent oracle: the same 5 000 rays go through both, one reading a `.vmf` and one
 * reading a `.bsp`, written from different sources by different code. The moment one calls
 * the other they stop being independent and the cross-check becomes decorative. There is a
 * test that walks the import graph and fails if the edge appears, because a rule nobody
 * enforces is a rule that lasts about six months.
 *
 * ## What a brush blocks, and why that is a convention rather than a law
 *
 * Source decides a brush's contents from `%compile*` flags in the material's `.vmt`, which
 * lives in the game's VPKs. Reading them is possible -- `read_game_content` does it -- but
 * it makes every spatial question depend on a mounted game, which the tests would then have
 * to skip. So the classification here is by **name**, using the tool-texture names Valve
 * ships, and the mask a brush ended up in is reported in every tool's output. A name-based
 * rule that says what it did is honest; one that stays quiet is a source of wrong numbers.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { readDisplacements } from "../vmf/displacement.js";
import { checkSolid, ON_EPSILON, orderedLoop } from "../vmf/solid.js";
import type { Plane, SolidCheck, Vec3 } from "../vmf/solid.js";
import { buildBvh } from "./bvh.js";
import type { Bvh } from "./bvh.js";

/** Blocks a bullet, a physics object and a footstep: the world as vbsp builds it. */
export const MASK_SOLID = 1;
/** Blocks a player walking. Adds the clip brushes, which are invisible and solid to people. */
export const MASK_PLAYER = 2;
/** Blocks a line of sight. Drops clip brushes, which you see straight through. */
export const MASK_SIGHT = 4;

export const MASK_NAMES: Record<number, string> = {
  [MASK_SOLID]: "solid",
  [MASK_PLAYER]: "player",
  [MASK_SIGHT]: "sight",
};

/** The player hull Source uses, as half-extents. `HalfWidth` is 16, standing height 72. */
export const HULL_STANDING: Vec3 = [16, 16, 36];
export const HULL_CROUCHING: Vec3 = [16, 16, 18];

/**
 * Tool textures that bound nothing at all: vbsp deletes their brushes from the world.
 *
 * A trigger volume is the one that catches people out. Its brush is a real brush in the
 * `.vmf`, sits in the middle of a doorway, and stops nobody -- so counting it as solid
 * would report a blocked corridor that every player walks straight through.
 */
const NON_SOLID_TOOLS = new Set([
  "TOOLSTRIGGER",
  "TOOLSSKIP",
  "TOOLSHINT",
  "TOOLSAREAPORTAL",
  "TOOLSOCCLUDER",
  "TOOLSBLOCKLIGHT",
  "TOOLSCLIPLIGHT",
  "TOOLSFOG",
  "TOOLSNODRAWPORTALABLE",
]);

/** Solid to people, invisible to eyes and bullets. */
const CLIP_TOOLS = new Set(["TOOLSCLIP", "TOOLSPLAYERCLIP", "TOOLSNPCCLIP", "TOOLSGRENADECLIP"]);

/** Blocks the eye and nothing else. */
const SIGHT_ONLY_TOOLS = new Set(["TOOLSBLOCK_LOS", "TOOLSBLOCKLOS"]);

/**
 * Materials you see through and cannot walk through: the opposite of a clip brush.
 *
 * The mirror of `CLIP_TOOLS` and it was missing (#73). A glazed window is solid to a body
 * and transparent to an eye, and until this existed every pane in every map stopped every
 * sightline. On `hmcp_backyard` that made a rule reading "the garden is not visible from the
 * sofa" pass, through a window that looks straight at it -- a green asserting the opposite
 * of the truth, which is worse than no rule at all.
 *
 * Matched on the material's directory, not its basename, because unlike the tool textures
 * this is a whole family: Garry's Mod ships some fifty `glass/glasswindow*`, and naming them
 * one by one would go stale the first time a mod adds one.
 *
 * ⚠️ **This is the same name-based convention as the rest of this file, with the same
 * limits, and it does not reach the second case.** A chain-link fence or a foliage card is
 * transparent through its material's alpha, under `metal/` or `props_foliage/` with nothing
 * in the name to say so. Only the `.vmt`'s `$translucent` / `$alphatest` settles those, and
 * reading it would make every spatial question depend on a mounted game. The masks a brush
 * ended up in are in every tool's output; a rule that says what it did is honest.
 */
const SEE_THROUGH_DIRS = new Set(["GLASS"]);

/** The directory a material sits in: `GLASS/GLASSWINDOW002A` -> `GLASS`. */
const materialDir = (material: string): string => {
  const clean = material.replace(/\\/g, "/");
  const cut = clean.lastIndexOf("/");
  return cut < 0 ? "" : clean.slice(0, cut).toUpperCase();
};

/**
 * Brush entities whose geometry stops nothing, whatever it is textured with.
 *
 * `func_illusionary` is the reason this list exists: it is normally textured with a real
 * material -- a fence, a waterfall, a bush -- and walking through it is the entire point of
 * the entity.
 */
const NON_SOLID_CLASSES = new Set([
  "func_illusionary",
  "func_dustcloud",
  "func_smokevolume",
  "func_precipitation",
  "func_ladder",
  "func_occluder",
  "func_areaportal",
  "func_areaportalwindow",
  "func_viscluster",
  "func_instance_parms",
]);

export interface SceneFace {
  sideId: number | null;
  material: string;
  plane: Plane;
  /**
   * Hull corners lying on this plane, **ordered around it**, counter-clockwise seen from
   * outside.
   *
   * The ordering is done here, once, and it is not optional. `SolidCheck.sides[].vertices`
   * is a *filter* of the hull's corners -- the ones near this plane -- and comes out in hull
   * order, which around a face is arbitrary. `polygonArea` and `pointsFromPlane` both call
   * `orderedLoop` before using it, and anything that forgets gets a zigzag instead of a
   * polygon. That failure is quiet: the shape still has the right corners, still has the
   * right bounding box, and still fills about two thirds of its own area when rasterised.
   */
  loop: Vec3[];
  area: number;
}

export interface SceneBrush {
  /** Hammer's solid id, or the read index when the file omits one. */
  id: number;
  index: number;
  /** `world`, or the classname of the brush entity holding it. */
  owner: string;
  planes: Plane[];
  faces: SceneFace[];
  mins: Vec3;
  maxs: Vec3;
  /** Bitwise OR of the MASK_* this brush participates in. Zero means it stops nothing. */
  mask: number;
  /**
   * A side carries a `dispinfo`, so the flat plane is not the surface the game builds.
   *
   * Such brushes are left out of every mask by default. Tracing against the flat quad would
   * put the floor of a valley where its rim is, and be wrong by the whole height of the
   * terrain without saying anything.
   */
  hasDisplacement: boolean;
}

export interface Scene {
  path: string;
  brushes: SceneBrush[];
  bvh: Bvh;
  mins: Vec3;
  maxs: Vec3;
  /** Solids read but excluded from every mask, with why. Reported by every tool. */
  excluded: { displacement: number; nonSolid: number; invalid: number };
  /**
   * The terrain, as triangles in world space. Empty unless `withTerrain` was asked for.
   *
   * Not part of the tracing scene and deliberately kept out of `brushes`: a displacement is
   * not a convex hull and every mask here is about hulls. This exists for the renderers
   * (#79), which until it did could not draw a single piece of terrain and said so in a note
   * nobody was going to act on. `read_vmf_trace` is a separate problem and not solved here.
   */
  terrain: TerrainTriangle[];
}

/** One triangle of a displacement grid, with the material of the face it came from. */
export interface TerrainTriangle {
  /** The solid the displaced side belongs to, so a pixel can still name a brush. */
  solidId: number;
  material: string;
  points: [Vec3, Vec3, Vec3];
  /** Unit normal, from the winding. Terrain is two-sided in the engine; this is for shading. */
  normal: Vec3;
}

export interface SceneOptions {
  /**
   * Only these owners. `["world", "func_detail"]` is what vbsp merges into the world model,
   * and therefore the only scene comparable with `../bsp/trace.ts`.
   */
  owners?: string[];
  /** Include brushes whose sides carry a displacement. Off, and off for a reason. */
  includeDisplacements?: boolean;
  /**
   * Also read every displacement grid into `terrain`, as triangles.
   *
   * Off by default because it costs a second parse of the file and nothing that traces wants
   * it. The renderers ask for it; `read_vmf_leak` and the room pass do not.
   */
  withTerrain?: boolean;
}

const toolName = (material: string): string => {
  const base = material.slice(material.lastIndexOf("/") + 1);
  return base.toUpperCase();
};

/**
 * Which masks a brush belongs to, from its owner's classname and its materials.
 *
 * A brush is classified by the first special material found on any of its sides, which is
 * how vbsp reads it too: one clip face makes the whole brush a clip brush.
 */
export function maskFor(owner: string, materials: readonly string[]): number {
  if (owner.startsWith("trigger_") || NON_SOLID_CLASSES.has(owner)) return 0;

  let sightOnly = false;
  let clip = false;
  // See-through is the one classification here that needs EVERY face to agree, where the
  // others need one. A single clip face makes the whole brush a clip brush, as vbsp reads
  // it; a single glazed face does not make a wall a window. A window frame with glass on
  // its reveal and brick everywhere else is a wall, and the reveal is the commonest way to
  // texture one. Nodraw abstains rather than voting: a pane built glass-front and
  // nodraw-edged is still a pane.
  let seeThrough = false;
  let opaqueFace = false;
  for (const m of materials) {
    const name = toolName(m);
    if (NON_SOLID_TOOLS.has(name)) return 0;
    if (SIGHT_ONLY_TOOLS.has(name)) sightOnly = true;
    if (CLIP_TOOLS.has(name)) clip = true;
    if (SEE_THROUGH_DIRS.has(materialDir(m))) seeThrough = true;
    else if (name !== "TOOLSNODRAW" && !CLIP_TOOLS.has(name)) opaqueFace = true;
  }
  if (sightOnly) return MASK_SIGHT;
  if (clip) return MASK_PLAYER;
  // Stops a body and a bullet, passes an eye. The mirror of a clip brush.
  if (seeThrough && !opaqueFace) return MASK_SOLID | MASK_PLAYER;
  return MASK_SOLID | MASK_PLAYER | MASK_SIGHT;
}

/** Every `solid` block of a file, with the owner it sits under. */
function collectSolids(source: string, owners?: string[]): SolidCheck[] {
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const out: SolidCheck[] = [];
  let index = 0;

  const take = (host: KvBlock, owner: string): void => {
    if (owners && !owners.includes(owner)) {
      // Still consumes indices from nothing: the index is per accepted solid, so it stays
      // the position in this scene rather than in the file, and nothing downstream reads it
      // as a file offset.
      return;
    }
    for (const solid of children(host, "solid")) out.push(checkSolid(solid, owner, index++));
    for (const hidden of children(host, "hidden")) {
      // A hidden brush still compiles into the map. Skipping it would measure a corridor as
      // clear when a visgroup-hidden pillar stands in it.
      for (const solid of children(hidden, "solid")) out.push(checkSolid(solid, owner, index++));
    }
  };

  for (const root of roots) {
    if (root.name === "world") take(root, "world");
    else if (root.name === "entity") take(root, get(root, "classname") ?? "entity");
  }
  return out;
}

/**
 * Builds the traceable scene of a `.vmf`.
 *
 * Solids that enclose no volume are dropped rather than repaired: `read_vmf_solids` is the
 * tool that explains why one is broken, and a tracer that silently invented a hull for it
 * would answer questions about a brush the map does not contain.
 */
export function buildScene(path: string, source: string, options: SceneOptions = {}): Scene {
  const checks = collectSolids(source, options.owners);
  const brushes: SceneBrush[] = [];
  const excluded = { displacement: 0, nonSolid: 0, invalid: 0 };

  for (const c of checks) {
    const planes = c.sides.map((s) => s.plane).filter((p): p is Plane => p !== null);
    if (planes.length < 4 || c.volume <= ON_EPSILON || c.vertices.length < 4) {
      excluded.invalid += 1;
      continue;
    }
    const hasDisplacement = c.sides.some((s) => s.hasDisplacement);
    if (hasDisplacement && !options.includeDisplacements) {
      excluded.displacement += 1;
      continue;
    }
    const mask = maskFor(
      c.owner,
      c.sides.map((s) => s.material),
    );
    if (mask === 0) {
      excluded.nonSolid += 1;
      continue;
    }

    brushes.push({
      id: c.id ?? c.index,
      index: brushes.length,
      owner: c.owner,
      planes,
      faces: c.sides
        .filter((s) => s.plane !== null && s.vertices.length >= 3)
        .map((s) => ({
          sideId: s.id,
          material: s.material,
          plane: s.plane!,
          loop: orderedLoop(s.vertices, s.plane!.normal),
          area: s.area,
        })),
      mins: c.mins,
      maxs: c.maxs,
      mask,
      hasDisplacement,
    });
  }

  const mins: [number, number, number] = [Infinity, Infinity, Infinity];
  const maxs: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of brushes) {
    for (let a = 0; a < 3; a++) {
      if (b.mins[a]! < mins[a]!) mins[a] = b.mins[a]!;
      if (b.maxs[a]! > maxs[a]!) maxs[a] = b.maxs[a]!;
    }
  }
  if (brushes.length === 0) {
    mins[0] = mins[1] = mins[2] = 0;
    maxs[0] = maxs[1] = maxs[2] = 0;
  }

  const terrain = options.withTerrain ? terrainOf(source) : [];
  return { path, brushes, bvh: buildBvh(brushes), mins, maxs, excluded, terrain };
}

/**
 * Every displacement grid of a file, triangulated in world space.
 *
 * A displacement of power *n* is a regular (2^n+1)^2 lattice whose vertices already carry
 * their world positions -- `readDisplacements` computes them, and `sculpt_displacement` and
 * `sew_displacements` agree with it to a thirty-second of a unit. So there is nothing to
 * derive here: walk the lattice and emit two triangles per cell.
 *
 * Power 4, the largest Source accepts, is 512 triangles. A hillside of thirty of them is
 * fifteen thousand, which is nothing beside the face count of a real map.
 */
function terrainOf(source: string): TerrainTriangle[] {
  const out: TerrainTriangle[] = [];
  let displacements;
  try {
    ({ displacements } = readDisplacements(source));
  } catch {
    // A file this parser cannot read is one the renderers draw without its terrain, exactly
    // as before. Failing the whole scene over the picture would be the wrong trade.
    return out;
  }

  for (const disp of displacements) {
    const n = disp.size;
    const at = new Map<number, Vec3>();
    for (const v of disp.vertices) at.set(v.y * n + v.x, v.position);

    for (let y = 0; y < n - 1; y += 1) {
      for (let x = 0; x < n - 1; x += 1) {
        const a = at.get(y * n + x);
        const b = at.get(y * n + x + 1);
        const c = at.get((y + 1) * n + x + 1);
        const d = at.get((y + 1) * n + x);
        if (!a || !b || !c || !d) continue;
        for (const tri of [
          [a, b, c],
          [a, c, d],
        ] as Array<[Vec3, Vec3, Vec3]>) {
          const normal = triangleNormal(tri);
          if (normal === null) continue;
          out.push({ solidId: disp.solidId, material: disp.material, points: tri, normal });
        }
      }
    }
  }
  return out;
}

/** Unit normal of a triangle, or null when it is degenerate. */
function triangleNormal([a, b, c]: [Vec3, Vec3, Vec3]): Vec3 | null {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < ON_EPSILON) return null;
  return [n[0] / len, n[1] / len, n[2] / len];
}
