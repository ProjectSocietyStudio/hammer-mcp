import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import type { FaceInfo } from "../vmf/build.js";
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

export const optimiseTools = [writeHintBrushTool];
