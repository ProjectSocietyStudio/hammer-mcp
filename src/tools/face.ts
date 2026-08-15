import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { alignFaces, setFaceMaterial, setSmoothingGroups } from "../vmf/face.js";
import type { AlignMode } from "../vmf/face.js";
import type { FaceSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput, resolveVmfInput } from "./paths.js";

const SELECTOR = {
  solidIds: z.array(z.number()).optional().describe("Only faces of these solids."),
  material: z
    .string()
    .optional()
    .describe("Only faces already carrying this. Substring, case-insensitive."),
  facing: z
    .enum(["up", "down", "side", "any"])
    .optional()
    .describe(
      "Only faces pointing this way. 'up' is a floor, 'down' a ceiling, 'side' a wall; " +
        "the cut is at 45 degrees, so a ramp counts as what it is closer to being.",
    ),
  minArea: z.number().optional().describe("Only faces at least this large, in square units."),
  all: z
    .boolean()
    .optional()
    .describe("Every face of the map. Required when no other criterion is given."),
};

const selectorFrom = (args: {
  solidIds?: number[];
  material?: string;
  facing?: "up" | "down" | "side" | "any";
  minArea?: number;
  all?: boolean;
}): FaceSelector => {
  // An empty material is not a criterion: matchesFace treats "" as falsy and matches
  // every face, while the presence of the key was enough to satisfy the all:true guard.
  // A default empty form value could therefore turn a scoped edit into a map-wide one.
  if (args.material !== undefined && args.material.trim().length === 0) {
    throw new Error(
      "material is empty, which matches every face rather than none. Give a name, or pass " +
        "all:true if a map-wide edit is what was meant.",
    );
  }
  const sel: FaceSelector = {
    ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
    ...(args.material !== undefined ? { material: args.material } : {}),
    ...(args.facing !== undefined ? { facing: args.facing } : {}),
    ...(args.minArea !== undefined ? { minArea: args.minArea } : {}),
  };
  if (Object.keys(sel).length === 0 && args.all !== true) {
    throw new Error(
      "this would touch every face in the map. Name solidIds, a material, a facing or a " +
        "minArea, or pass all:true to say you meant it.",
    );
  }
  return sel;
};

/** Refuses to write when a face edit moved any geometry, which it never should. */
function assertGeometryUntouched(path: string, before: string, after: string): void {
  const b = checkVmfSolids(path, before);
  const a = checkVmfSolids(path, after);
  if (a.solidCount !== b.solidCount) {
    throw new Error(
      `refusing to write: a face edit changed the number of solids from ${b.solidCount} ` +
        `to ${a.solidCount}. It never should.`,
    );
  }
  for (const x of b.solids) {
    if (x.id === null) continue;
    const y = a.solids.find((s) => s.id === x.id);
    if (!y || y.volume !== x.volume) {
      throw new Error(
        `refusing to write: solid ${x.id} changed shape during a face edit. It never should.`,
      );
    }
  }
}

export const setFaceMaterialTool = defineTool({
  name: "set_face_material",
  description:
    "Sets the material on selected faces of a .vmf. Until this existed a brush's material " +
    "was fixed at creation and nothing could change it, which made set_lightmap_scale the " +
    "odd position of being able to say how finely to light a wall but not what the wall " +
    "was made of. Selects by solid, material, facing or area. The name is normalised to " +
    "the form a .vmf stores -- uppercase, no materials/ prefix, no .vmt suffix -- because " +
    "vbsp resolves it literally and a wrong one is invisible until a player loads the map. " +
    "Whether the material exists is NOT checked here: use read_game_content for that.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    newMaterial: z.string().describe("Material to apply, in any of the usual forms."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        from: z.string(),
        to: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setFaceMaterial(before, selectorFrom(args), args.newMaterial);
    assertGeometryUntouched(path, before, result.text);

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      matched: result.matched,
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "Nothing here proved the material exists. Compile and run read_map_dependencies: a " +
        "name that resolves to nothing is a purple checkerboard for the player and silence " +
        "for everyone else.",
    };
  },
});

export const alignFacesTool = defineTool({
  name: "align_faces",
  description:
    "Realigns the texture on selected faces: to the world axes, to the face's own plane, " +
    "or stretched to fit the face. Hammer's three alignment modes. 'world' derives the " +
    "axes from the face's dominant normal using vbsp's own base-axis table, which is what " +
    "a face gets at creation; 'face' projects them into the face's plane so the texture " +
    "runs along a slope instead of being squashed onto it; 'fit' spans the face exactly. " +
    "The offsets are always recomputed from a corner of the face rather than carried over " +
    "-- an axis pair with a stale offset puts the texture somewhere else entirely, which " +
    "is the most common way an alignment tool produces a map that compiles and looks wrong.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mode: z
      .enum(["world", "face", "fit", "arc"])
      .describe(
        "'arc' is 'face' plus continuity: facets that touch without turning a corner are one " +
          "run, and each carries its texture on from where the last one stopped. It is what a " +
          "curve needs and what neither of the others gives -- a ring aligned to 'face' " +
          "restarts the brick at every seam, which reads as flat plates however well the " +
          "smoothing groups are set.",
      ),
    scale: z
      .number()
      .optional()
      .describe("Multiply both texture scales by this afterwards. Zero is refused."),
    rotate: z.number().optional().describe("Turn the axis pair in the face's plane, degrees."),
    shift: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("Add to the u and v offsets, in texels."),
    repeat: z
      .tuple([z.number(), z.number()])
      .optional()
      .describe("For 'fit': how many times the texture repeats across the face. Default once."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        material: z.string(),
        uaxis: z.string(),
        vaxis: z.string(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    if (args.repeat && (args.repeat[0] <= 0 || args.repeat[1] <= 0)) {
      throw new Error(
        `fit needs a positive number of repeats on both axes, not ${args.repeat.join(" and ")}`,
      );
    }
    const result = alignFaces(before, selectorFrom(args), {
      mode: args.mode as AlignMode,
      ...(args.scale !== undefined ? { scale: args.scale } : {}),
      ...(args.rotate !== undefined ? { rotate: args.rotate } : {}),
      ...(args.shift !== undefined ? { shift: args.shift as [number, number] } : {}),
      ...(args.repeat !== undefined ? { repeat: args.repeat as [number, number] } : {}),
    });
    assertGeometryUntouched(path, before, result.text);

    // The algebra oracle, run before the file is touched: read_vmf_solids already refuses
    // a texture axis lying along the face normal, a zero scale and a degenerate pair. An
    // alignment that produced any of those would compile and look wrong, silently.
    const after = checkVmfSolids(path, result.text);
    const bad = after.solids.filter((s) =>
      s.findings.some(
        (f) =>
          f.severity === "error" &&
          (f.rule === "texture-axis-along-normal" ||
            f.rule === "zero-texture-scale" ||
            f.rule === "degenerate-texture-axis"),
      ),
    );
    if (bad.length > 0) {
      throw new Error(
        `refusing to write: this alignment produced texture axes the checker rejects on ` +
          `${bad.length} solid(s). ` +
          bad
            .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
            .join(" | "),
      );
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      matched: result.matched,
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "Alignment is one of the things no offline check can judge. The axes are legal and " +
        "the offsets start at the face's edge; whether it looks right is for the eye.",
    };
  },
});

export const setSmoothingGroupsTool = defineTool({
  name: "set_smoothing_groups",
  description:
    "Sets the smoothing groups on selected faces. Two faces sharing an edge and a group " +
    "are lit by vrad as one continuous surface; without it every facet of a curve is lit " +
    "separately and reads as the flat polygons it really is. Takes Hammer's own group " +
    "numbers, 1 to 32, and does the bit shifting -- the file stores a bitmask, so group 13 " +
    "is 4096 and getting that wrong is silent. Pass an empty list to clear them.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    groups: z
      .array(z.number().int().min(1).max(32))
      .describe("Hammer's group numbers, 1 to 32. Empty clears every group."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    facesChanged: z.number(),
    /** The bitmask as the file stores it, so the caller can check it against Hammer. */
    mask: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setSmoothingGroups(before, selectorFrom(args), args.groups);
    assertGeometryUntouched(path, before, result.text);

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      matched: result.matched,
      facesChanged: result.changed.length,
      mask: result.groups,
      warnings: result.warnings,
      nextStep:
        "Smoothing only shows after vrad. Compile with lighting and look: nothing in the " +
        "file, and no measurement here, distinguishes a curve that reads as smooth from " +
        "one that reads as facets.",
    };
  },
});

export const faceTools = [setFaceMaterialTool, alignFacesTool, setSmoothingGroupsTool];
