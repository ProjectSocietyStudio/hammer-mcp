import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import type { FaceInfo } from "../vmf/build.js";
import { MAX_BRUSH_LUXELS_PER_AXIS, setLightmapScale } from "../vmf/lightmap.js";
import { reclassSolids } from "../vmf/reclass.js";
import type { ReclassTarget } from "../vmf/reclass.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const HINT = "TOOLS/TOOLSHINT";
const SKIP = "TOOLS/TOOLSSKIP";

export const writeHintBrushTool = defineTool({
  name: "write_hint_brush",
  description:
    "Creates a hint brush: a slab carrying TOOLS/TOOLSHINT on the plane vvis should cut " +
    "along and TOOLS/TOOLSSKIP everywhere else. This is the one lever that shapes a map's " +
    "visibility tree directly, and nothing in a compiled .bsp records it -- vvis consumes " +
    "hints and they are gone from the file, so this can only be done on the source. " +
    "rotateZ makes the cut diagonal, which is what a mapper does when a city's streets do " +
    "not run along the axes. Verify by compiling before and after and comparing " +
    "read_visleaf_stats: a hint that moves no leaf count did nothing.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mins: Vec3.describe("Lower corner of the slab, before any rotation."),
    maxs: Vec3.describe("Upper corner of the slab, before any rotation."),
    rotateZ: z
      .number()
      .optional()
      .describe(
        "Degrees to turn the slab about its own centre. 45 gives a diagonal cut. " +
          "Corners are rounded to whole units, so the faces stay exactly planar.",
      ),
    hintFaces: z
      .enum(["largest", "all"])
      .optional()
      .describe(
        "Which faces carry the hint. 'largest' (default) hints the two biggest opposing " +
          "faces, which for a thin slab is the plane you meant. 'all' hints every face.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    solidId: z.number(),
    hintFaceCount: z.number(),
    skipFaceCount: z.number(),
    mins: Vec3,
    maxs: Vec3,
    volume: z.number(),
    grid: z.number(),
    valid: z.boolean(),
    warnings: z.array(z.string()),
    /** What to measure to find out whether this hint earned its place. */
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");

    let hintCount = 0;
    let skipCount = 0;
    const materialForFace = (face: FaceInfo): string => {
      // 'largest' hints ranks 0 and 1: on a slab those are the two big opposing faces, and
      // hinting only one of them is a common way to get no split at all.
      const wanted = args.hintFaces === "all" || face.areaRank <= 1;
      if (wanted) hintCount++;
      else skipCount++;
      return wanted ? HINT : SKIP;
    };

    const result = insertSolids(
      before,
      [
        {
          shape: "box",
          mins: args.mins as [number, number, number],
          maxs: args.maxs as [number, number, number],
          ...(args.rotateZ !== undefined ? { rotateZ: args.rotateZ } : {}),
        },
      ],
      { material: SKIP, materialForFace },
    );

    const report = checkVmfSolids(path, result.text);
    const solid = report.solids.find((s) => s.id === result.solidIds[0]);
    if (!solid) {
      throw new Error("refusing to write: the solid this built could not be read back");
    }
    if (!solid.valid) {
      throw new Error(
        `refusing to write: this hint brush does not close a volume. ` +
          solid.findings
            .filter((f) => f.severity === "error")
            .map((f) => f.message)
            .join(" | "),
      );
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
    });

    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      solidId: result.solidIds[0]!,
      hintFaceCount: hintCount,
      skipFaceCount: skipCount,
      mins: solid.mins as unknown as [number, number, number],
      maxs: solid.maxs as unknown as [number, number, number],
      volume: solid.volume,
      grid: solid.grid,
      valid: solid.valid,
      warnings: solid.findings.filter((f) => f.severity !== "error").map((f) => f.message),
      nextStep:
        "Compile with vvis and compare read_visleaf_stats against the run before this. A " +
        "hint that changes neither the leaf count nor the cluster count did nothing, and a " +
        "hint that does nothing still costs a plane in the tree.",
    };
  },
});


export const setSolidClassTool = defineTool({
  name: "set_solid_class",
  description:
    "Moves brushes between the world and a brush entity -- in practice, into or out of " +
    "func_detail. This is the largest single lever on a Source map's performance and it is " +
    "invisible in a compiled .bsp, because vbsp folds func_detail into the world: a shipped " +
    "map cannot tell you which brushes were structural. A structural brush splits the BSP " +
    "tree and spawns visleaves, so trim, pillars and window frames cost a slower compile and " +
    "a worse PVS for nothing. WARNING: a func_detail brush does not seal the map. Move a wall " +
    "into one and the next compile leaks, and no check here can rule that out -- sealing is a " +
    "property of the whole hull. Compile afterwards and read the leak.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z
      .array(z.number())
      .min(1)
      .describe("Hammer ids of the solids to move. read_vmf_solids lists them."),
    to: z
      .string()
      .describe(
        "'world' to make them structural again, or a brush entity classname such as " +
          "func_detail, func_illusionary, func_brush.",
      ),
    entityId: z
      .number()
      .optional()
      .describe(
        "Existing entity of that class to add to. Omit to create one. Grouping is taste, " +
          "not performance: vbsp dissolves every func_detail into the world regardless.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    moved: z.array(z.object({ id: z.number(), from: z.string(), to: z.string() })),
    createdEntityId: z.number().nullable(),
    /** Solids still owned by the world after the move. Zero means nothing seals the map. */
    worldSolidsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");

    const target: ReclassTarget =
      args.to === "world"
        ? { to: "world" }
        : {
            to: "entity",
            classname: args.to,
            ...(args.entityId !== undefined ? { entityId: args.entityId } : {}),
          };

    const result = reclassSolids(before, args.solidIds, target);

    // The geometry must survive the move untouched: this is a change of ownership, not an
    // edit of any brush. Checking it costs nothing and catches a splice that took one line
    // too many -- which would otherwise show up as a leak much later, blamed on the move
    // rather than on the cut.
    const was = checkVmfSolids(path, before);
    const now = checkVmfSolids(path, result.text);
    if (now.solidCount !== was.solidCount) {
      throw new Error(
        `refusing to write: ${was.solidCount} solids before, ${now.solidCount} after. ` +
          `A move must not create or destroy geometry.`,
      );
    }
    const lost = was.solids.filter(
      (s) => !now.solids.some((t) => t.id === s.id && t.volume === s.volume),
    );
    if (lost.length > 0) {
      throw new Error(
        `refusing to write: solid ${lost.map((s) => s.id).join(", ")} changed shape during a ` +
          `move that should only have changed its owner.`,
      );
    }

    const worldSolidsAfter = now.solids.filter((s) => s.owner === "world").length;
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
      moved: result.moved,
      createdEntityId: result.createdEntityId,
      worldSolidsAfter,
      warnings: result.warnings,
      nextStep:
        args.to === "world"
          ? "Compile and compare read_visleaf_stats: making a brush structural again should " +
            "raise the leaf count. If it does not, the brush was not shaping the tree and " +
            "belonged in a func_detail."
          : "Compile vbsp and read_leak before anything else. func_detail does not seal, so " +
            "the risk here is a leak, not a slower map. Then compare read_visleaf_stats " +
            "against the run before: fewer leaves for the same space is the point. Read that " +
            "comparison narrowly -- it says vvis no longer sees the brush, not that the brush " +
            "is free. It is still drawn, still counts in FACES, and still costs its lightmap. " +
            "read_map_report against a budget is what answers the wider question.",
    };
  },
});


export const setLightmapScaleTool = defineTool({
  name: "set_lightmap_scale",
  description:
    "Sets lightmapscale on selected faces of a .vmf. The value is units per luxel, so it " +
    "runs backwards from intuition: smaller is finer and more expensive, and the cost is an " +
    "area -- halving the scale quadruples the luxels on that face. Select by solid, by " +
    "material, by which way a face points, by minimum area, or a combination. Reports the " +
    "luxel count before and after, per face and in total, before writing. Warns when a face " +
    "would cross MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER (32 luxels per texture axis, read " +
    "from bspfile.h): vbsp does not refuse that, it splits the face until each piece fits, " +
    "so the bill includes extra faces and not only extra luxels. Verify with " +
    "read_lightmap_budget on the recompiled map.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    scale: z
      .number()
      .positive()
      .describe("Units per luxel. Hammer's default is 16; powers of two are the convention."),
    solidIds: z.array(z.number()).optional().describe("Only faces of these solids."),
    material: z.string().optional().describe("Only faces whose material contains this text."),
    facing: z
      .enum(["up", "down", "side", "any"])
      .optional()
      .describe("Only faces pointing this way: up is a floor, down a ceiling, side a wall."),
    minArea: z.number().optional().describe("Only faces of at least this many square units."),
    all: z
      .boolean()
      .optional()
      .describe("Required to act on every face of the map when no other selector is given."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    facesChanged: z.number(),
    alreadyAtScale: z.number(),
    luxelsBefore: z.number(),
    luxelsAfter: z.number(),
    /** Faces that will be split by vbsp because they cross the per-axis cap. */
    facesOverCap: z.number(),
    changed: z.array(
      z.object({
        solidId: z.number(),
        sideId: z.number().nullable(),
        material: z.string(),
        areaUnits: z.number(),
        from: z.number(),
        to: z.number(),
        luxelsBefore: z.number(),
        luxelsAfter: z.number(),
        worstAxisAfter: z.number(),
      }),
    ),
    truncated: z.boolean(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const selector = {
      ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
      ...(args.facing !== undefined ? { facing: args.facing } : {}),
      ...(args.minArea !== undefined ? { minArea: args.minArea } : {}),
    };
    if (Object.keys(selector).length === 0 && args.all !== true) {
      // Rescaling a whole map is legitimate and is never what someone meant by accident.
      throw new Error(
        "no selector given. Pass solidIds, material, facing or minArea -- or all:true to " +
          "rescale every face in the file, which is a different intention and should look " +
          "like one.",
      );
    }

    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setLightmapScale(before, args.scale, selector);

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });

    const LIMIT = 50;
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      facesChanged: result.changed.length,
      alreadyAtScale: result.alreadyAtScale,
      luxelsBefore: result.luxelsBefore,
      luxelsAfter: result.luxelsAfter,
      facesOverCap: result.changed.filter((c) => c.worstAxisAfter > MAX_BRUSH_LUXELS_PER_AXIS)
        .length,
      changed: result.changed.slice(0, LIMIT),
      truncated: result.changed.length > LIMIT,
      warnings: result.warnings,
      nextStep:
        "Compile with vrad and compare read_lightmap_budget and the LIGHTING lump size " +
        "against the run before. The projection here counts luxels from the face extents; " +
        "what vrad actually allocates is the number that fills MAX_MAP_LIGHTING, and the " +
        "two part company as soon as vbsp splits a face.",
    };
  },
});

export const optimiseTools = [writeHintBrushTool, setSolidClassTool, setLightmapScaleTool];
