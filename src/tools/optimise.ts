import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import type { FaceInfo } from "../vmf/build.js";
import { reclassSolids } from "../vmf/reclass.js";
import type { ReclassTarget } from "../vmf/reclass.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { CONFIRM, resolveInput } from "./paths.js";

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
    dryRun: z.boolean().optional().describe("Report without writing. The checks run either way."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
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

    const write = args.dryRun !== true;
    if (write) writeFileSync(path, result.text, "utf8");

    return {
      path,
      written: write,
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
    dryRun: z.boolean().optional().describe("Report without writing. The checks run either way."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
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
    const write = args.dryRun !== true && !result.unchanged;
    if (write) writeFileSync(path, result.text, "utf8");

    return {
      path,
      written: write,
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
            "against the run before: fewer leaves for the same space is the point.",
    };
  },
});

export const optimiseTools = [writeHintBrushTool, setSolidClassTool];
