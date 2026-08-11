/**
 * Areaportals and occluders: the two brush entities `read_map_geometry` has counted since
 * the beginning and nothing has ever placed.
 *
 * They are the other half of the visibility story. `func_detail` takes a brush out of the
 * tree and a hint tells vvis where to cut it; these two work at runtime instead, and that
 * difference is the whole reason to reach for one:
 *
 * **An areaportal seals a doorway and the engine opens and closes it as the player moves.**
 * vbsp splits the map into areas at the portal, and everything on the far side is culled
 * whole while it is shut. It is the strongest visibility tool Source has and the fussiest:
 * the brush must fill the opening exactly, wall to wall and floor to ceiling, and vbsp
 * refuses the map outright if it does not -- "areaportal brush doesn't touch two areas",
 * which is a compile that stops rather than a map that runs badly.
 *
 * **An occluder hides what is behind it, per frame, on the CPU.** It does not split
 * anything and never fails a compile; it simply costs time every frame whether or not it
 * saves any. Source's own advice is to use very few, and the reason is that each one is
 * tested against every prop.
 *
 * Neither can be checked offline for the thing that matters. Whether a portal seals is a
 * property of the room around it, and whether an occluder pays for itself is a property of
 * where players stand. What can be checked is the shape, and that is what these do.
 */
import { insertSolids } from "./build.js";
import type { SolidSpec } from "./build.js";
import { maxId } from "./edit.js";
import { parse } from "../kv/parse.js";
import type { KvBlock } from "../kv/parse.js";
import { lineRange } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";
import type { Vec3 } from "./solid.js";

export class VmfPortalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfPortalError";
  }
}

/** The material a face of one of these must carry, or the entity does nothing. */
export const PORTAL_MATERIAL = "TOOLS/TOOLSAREAPORTAL";
export const OCCLUDER_MATERIAL = "TOOLS/TOOLSOCCLUDER";

export interface PortalResult {
  text: string;
  entityId: number;
  solidId: number;
  classname: string;
  mins: Vec3;
  maxs: Vec3;
  thickness: number;
  warnings: string[];
}

const THIN = 16;

/**
 * Writes an areaportal or an occluder as a brush entity.
 *
 * The box is emitted through `insertSolids`, so the planes, the winding and the texture
 * axes are the ones already proven, and then the solid is moved into a fresh entity of the
 * right class. Doing it the other way round -- writing the entity and its brush by hand --
 * would be a second brush writer, and this repository has learned what a second
 * implementation of a subtlety costs.
 */
export function writePortal(
  source: string,
  classname: "func_areaportal" | "func_areaportalwindow" | "func_occluder",
  mins: Vec3,
  maxs: Vec3,
  options: { targetname?: string; keyvalues?: Record<string, string> } = {},
): PortalResult {
  for (const axis of [0, 1, 2] as const) {
    if (maxs[axis] <= mins[axis]) {
      throw new VmfPortalError(
        `mins must be below maxs on every axis; got ${mins[axis]} and ${maxs[axis]} on axis ${axis}`,
      );
    }
  }

  const size: Vec3 = [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]];
  const thinnest = Math.min(size[0], size[1], size[2]);
  const warnings: string[] = [];

  // Which axis the thing faces. An areaportal is a sheet across an opening; a box with no
  // thin axis is a mapper who has filled the room rather than the doorway with it.
  if (thinnest > THIN) {
    warnings.push(
      `every side of this is more than ${THIN} units thick. An areaportal is a sheet across ` +
        `an opening and an occluder is a sheet in front of something; a box this solid is ` +
        `usually a doorway that was measured as a room.`,
    );
  }

  const material = classname === "func_occluder" ? OCCLUDER_MATERIAL : PORTAL_MATERIAL;
  const inserted = insertSolids(source, [{ shape: "box", mins, maxs } as SolidSpec], {
    material,
  });
  const solidId = inserted.solidIds[0]!;

  // Now move it into an entity of the right class. Splicing rather than rebuilding, as
  // everything else here does.
  const nodes = parse(inserted.text);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const world = roots.find((b) => b.name === "world");
  if (!world) throw new VmfPortalError("this file has no world block");

  const solidBlock = world.entries.find(
    (n): n is KvBlock =>
      n.kind === "block" &&
      n.name === "solid" &&
      inserted.text.slice(n.bodyStart, n.bodyEnd).includes(`"id" "${solidId}"`),
  );
  if (!solidBlock) throw new VmfPortalError("the brush that was just written could not be found");

  const body = inserted.text.slice(solidBlock.start, solidBlock.end);
  const entityId = maxId(nodes) + 1;
  const extra = Object.entries({
    ...(options.targetname !== undefined ? { targetname: options.targetname } : {}),
    ...(options.keyvalues ?? {}),
  })
    .map(([k, v]) => `\t"${k}" "${v}"\n`)
    .join("");

  const entity =
    `entity\n{\n\t"id" "${entityId}"\n\t"classname" "${classname}"\n${extra}` +
    `${body.replace(/^\t/gm, "\t")}\n` +
    `\teditor\n\t{\n\t\t"color" "0 180 220"\n\t\t"visgroupshown" "1"\n` +
    `\t\t"visgroupautoshown" "1"\n\t}\n}\n`;

  // lineRange, not a hand-rolled line cut: the naive version takes whatever shares the
  // brush's line, which on a one-line .vmf is the world.
  const cut = lineRange(inserted.text, solidBlock);
  const withoutBrush = inserted.text.slice(0, cut.start) + inserted.text.slice(cut.end);
  const text = withoutBrush.endsWith("\n")
    ? `${withoutBrush}${entity}`
    : `${withoutBrush}\n${entity}`;

  if (classname === "func_occluder") {
    warnings.push(
      "an occluder costs CPU time every frame whether or not it hides anything, because it " +
        "is tested against every prop. Source's own advice is very few per map, and nothing " +
        "offline can say whether this one pays for itself.",
    );
  } else {
    warnings.push(
      "an areaportal must fill its opening exactly -- wall to wall, floor to ceiling. vbsp " +
        "refuses the whole map if it does not, with 'areaportal brush doesn't touch two " +
        "areas', so this is a compile that stops rather than a map that runs badly.",
    );
  }

  return {
    text,
    entityId,
    solidId,
    classname,
    mins,
    maxs,
    thickness: thinnest,
    warnings,
  };
}

export interface MapProperties {
  skyname?: string;
  detailmaterial?: string;
  detailvbsp?: string;
  maxpropscreenwidth?: string;
  fogenable?: string;
  fogstart?: string;
  fogend?: string;
  fogcolor?: string;
}

export interface PropertiesResult {
  text: string;
  changed: Record<string, { from: string | null; to: string }>;
  warnings: string[];
  unchanged: boolean;
}

/**
 * Sets keyvalues on `worldspawn`.
 *
 * The map's own properties: its sky, its detail sprites, its fog. They are ordinary
 * keyvalues on an ordinary entity, so this is `edit_vmf` with a shorter name -- except for
 * one thing worth having in a tool of its own. `detailvbsp` and `detailmaterial` come as a
 * pair, and setting one without the other gives a map whose grass either has no sprites or
 * has sprites with no material, and vbsp says nothing about either.
 */
export function setMapProperties(source: string, props: MapProperties): PropertiesResult {
  const entries = Object.entries(props).filter(([, v]) => v !== undefined) as Array<
    [string, string]
  >;
  if (entries.length === 0) {
    throw new VmfPortalError("no properties were given");
  }

  const warnings: string[] = [];
  const names = new Set(entries.map(([k]) => k));
  if (names.has("detailvbsp") !== names.has("detailmaterial")) {
    warnings.push(
      "detailvbsp and detailmaterial come as a pair: one names the file that says which " +
        "sprites go on which material, the other names the sprite sheet. Setting one alone " +
        "gives grass with no sprites, or sprites with no material, and vbsp mentions neither.",
    );
  }

  return { ...applyToWorld(source, entries), warnings };
}

/** Splices the pairs into `worldspawn`, reporting what each one was. */
function applyToWorld(
  source: string,
  entries: ReadonlyArray<[string, string]>,
): { text: string; changed: Record<string, { from: string | null; to: string }>; unchanged: boolean } {
  const roots = parse(source).filter((n): n is KvBlock => n.kind === "block");
  const world = roots.find((b) => b.name === "world");
  if (!world) throw new VmfPortalError("this file has no world block");

  const changed: Record<string, { from: string | null; to: string }> = {};
  const splices: Splice[] = [];

  for (const [key, value] of entries) {
    const existing = world.entries.find(
      (n): n is Extract<typeof n, { kind: "pair" }> => n.kind === "pair" && n.key === key,
    );
    if (existing) {
      if (existing.value === value) continue;
      changed[key] = { from: existing.value, to: value };
      splices.push({ start: existing.start, end: existing.end, text: `"${key}" "${value}"` });
      continue;
    }
    changed[key] = { from: null, to: value };
    // After the last top-level pair, which is where Hammer puts a new one.
    let at = world.bodyStart;
    for (const node of world.entries) {
      if (node.kind === "block") break;
      at = node.end;
    }
    splices.push({ start: at, end: at, text: `\n\t"${key}" "${value}"` });
  }

  // applySplices, not a fifth copy of the last-first loop. This file had one for about ten
  // minutes, which is how long it takes to write the thing bloc 0 existed to delete.
  const text = applySplices(source, splices);
  return { text, changed, unchanged: text === source };
}

export { checkVmfSolids };
