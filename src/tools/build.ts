import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import type { ToolContext } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import { FACING_COSINE } from "../vmf/select.js";
import type { SolidSpec } from "../vmf/build.js";
import { expandFitting } from "../vmf/fittings/index.js";
import type { FittingSpec } from "../vmf/fittings/index.js";
import { expandShape } from "../vmf/shapes.js";
import type { CompoundSpec } from "../vmf/shapes.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveVmfInput } from "./paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const Spec = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("box"), mins: Vec3, maxs: Vec3 }),
  z.object({
    shape: z.literal("wedge"),
    mins: Vec3,
    maxs: Vec3,
    slopeAxis: z.enum(["x", "y"]),
    high: z.enum(["min", "max"]),
  }),
  z.object({
    shape: z.literal("cylinder"),
    mins: Vec3,
    maxs: Vec3,
    sides: z.number().int().min(3).max(64),
    axis: z.enum(["x", "y", "z"]).optional(),
  }),
  z.object({ shape: z.literal("convex"), faces: z.array(z.array(Vec3)) }),
  z.object({
    shape: z.literal("cone"),
    mins: Vec3,
    maxs: Vec3,
    sides: z.number().int().min(3).max(64),
    axis: z.enum(["x", "y", "z"]).optional(),
  }),
  z.object({
    shape: z.literal("stairs"),
    mins: Vec3,
    maxs: Vec3,
    steps: z.number().int().min(1).max(256),
    direction: z.enum(["+x", "-x", "+y", "-y"]).describe("Which way the flight climbs."),
  }),
  z.object({
    shape: z.literal("arch"),
    centre: Vec3.describe("Centre of the arc, at its base."),
    innerRadius: z
                  .number()
                  .describe(
                    "The radius the corners touch. A ring of `segments` wedges is a polygon " +
                      "INSCRIBED in it, so the flat of each facet sits at " +
                      "innerRadius * cos(180/segments) -- 98% of it at 16 segments, 92% at 8. " +
                      "A marker placed just inside the wall at the radius you asked for is " +
                      "inside the wall.",
                  ),
    outerRadius: z.number(),
    height: z.number(),
    arcDegrees: z.number().describe("180 is a doorway arch, 360 a full ring."),
    segments: z.number().int().min(1).max(256),
    startDegrees: z.number().optional(),
  }),
  z.object({
    shape: z.literal("sphere"),
    centre: Vec3,
    radius: z.number(),
    sides: z.number().int().min(3).max(64).describe("Faces around the equator."),
    stacks: z.number().int().min(2).max(32).describe("Bands from pole to pole; each is a brush."),
  }),
  z.object({
    shape: z.literal("torus"),
    centre: Vec3,
    majorRadius: z.number(),
    minorRadius: z.number(),
    majorSegments: z.number().int().min(3).max(64).describe("Each one is a brush."),
    minorSides: z.number().int().min(3).max(32),
  }),
]);

/** Shapes that are several brushes rather than one. */
const COMPOUND = new Set(["cone", "stairs", "arch", "sphere", "torus"]);

/**
 * What every writer of brushes does after it has decided what the brushes are.
 *
 * Lifted out when `write_vmf_fitting` arrived rather than copied: the oracle, the refusal
 * and the guarded write are the load-bearing half of `write_vmf_solid`, and a second copy of
 * them would be a second place for the refusal to stop matching the check. Both tools now
 * fail identically, because it is the same code failing.
 */
interface Placement {
  path: string;
  entityId?: number | undefined;
  material?: string | undefined;
  materials?:
    | { top?: string | undefined; bottom?: string | undefined; sides?: string | undefined }
    | undefined;
  lightmapScale?: number | undefined;
  textureScale?: number | undefined;
  dryRun?: boolean | undefined;
  backup?: boolean | undefined;
}

function placeSolids(req: Placement, specs: SolidSpec[], ctx: ToolContext) {
  const path = resolveVmfInput(req.path, ctx.config);
  const before = readFileSync(path, "utf8");
  const beforeReport = checkVmfSolids(path, before);

  const result = insertSolids(before, specs, {
    ...(req.entityId !== undefined ? { entityId: req.entityId } : {}),
    ...(req.material !== undefined ? { material: req.material } : {}),
    // Same cut as `select.ts` and `classify.ts` use for `facing`, deliberately: a second
    // threshold for the same word is how two tools come to disagree about what a wall is.
    ...(req.materials !== undefined
      ? {
          materialForFace: (face: { normal: readonly number[] }) => {
            const z = face.normal[2]!;
            if (z > FACING_COSINE) return req.materials!.top;
            if (z < -FACING_COSINE) return req.materials!.bottom;
            return req.materials!.sides;
          },
        }
      : {}),
    ...(req.lightmapScale !== undefined ? { lightmapScale: req.lightmapScale } : {}),
    ...(req.textureScale !== undefined ? { textureScale: req.textureScale } : {}),
  });

  // The oracle, run before the file is touched rather than after. A brush that compiles
  // and is wrong is the failure mode this whole path exists to avoid, so a writer that
  // reported success and left the caller to check would be missing the point.
  const afterReport = checkVmfSolids(path, result.text);
  const created = afterReport.solids.filter((s) => result.solidIds.includes(s.id ?? -1));
  const bad = created.filter((s) => !s.valid);

  if (bad.length > 0) {
    throw new Error(
      `refusing to write: ${bad.length} of the ${created.length} solids this would create ` +
        `do not close a volume. ` +
        bad
          .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
          .join(" | "),
    );
  }
  if (created.length !== result.solidIds.length) {
    throw new Error(
      `refusing to write: ${result.solidIds.length} solids were built but only ` +
        `${created.length} could be read back. The file this produced does not parse the ` +
        `way it was written.`,
    );
  }

  const warnings = created.flatMap((s) =>
    s.findings.filter((f) => f.severity !== "error").map((f) => f.message),
  );

  const write = writeGuarded(path, result.text, ctx.config, {
    dryRun: req.dryRun,
    backup: req.backup,
  });

  return {
    path,
    written: write.written,
    backupPath: write.backupPath,
    target: result.target,
    solidIds: result.solidIds,
    solidsBefore: beforeReport.solidCount,
    solidsAfter: afterReport.solidCount,
    bytesAdded: Buffer.byteLength(result.text) - Buffer.byteLength(before),
    verified: created.map((s) => ({
      id: s.id,
      sideCount: s.sides.length,
      vertexCount: s.vertices.length,
      volume: s.volume,
      grid: s.grid,
      mins: s.mins as unknown as [number, number, number],
      maxs: s.maxs as unknown as [number, number, number],
      valid: s.valid,
    })),
    warnings,
  };
}

export const writeVmfSolidTool = defineTool({
  name: "write_vmf_solid",
  description:
    "Creates brushes in a .vmf from a shape description: box, wedge (a ramp), cylinder (an " +
    "n-sided prism), or convex for a hull given face by face. Chooses the planes, winds " +
    "every face outward and derives the texture axes with vbsp's own base-axis table, so " +
    "the texture does not come out stretched or rotated. Inserts by splicing at the end of " +
    "the target block: nothing already in the file moves, comments and formatting included. " +
    "Every solid it writes is passed straight back through read_vmf_solids before the file " +
    "is touched, and the write is refused if any of them fails -- the writer goes volume to " +
    "planes, the checker goes planes to volume, so neither can hide the other's sign error.",
  realm: "map",
  guarded: true,
  /**
   * A mapper's source file is usually the only copy of days of work, and this tool adds to
   * it rather than replacing it -- which makes a mistake quieter, not louder. `guarded`
   * refuses the call without `confirm:true`, but that gate is ours and an agent satisfies
   * it by itself; this asks the client for a human as well.
   */
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solids: z.array(Spec).min(1).describe("Shapes to create, in order."),
    entityId: z
      .number()
      .optional()
      .describe("Hammer id of a brush entity to add them to. Omit to add them to the world."),
    material: z
      .string()
      .optional()
      .describe("Material for every face. Default TOOLS/TOOLSNODRAW, which draws nothing."),
    materials: z
      .object({
        top: z.string().optional().describe("Faces pointing up: the floor of a slab."),
        bottom: z.string().optional().describe("Faces pointing down."),
        sides: z.string().optional().describe("Faces pointing neither up nor down: the walls."),
      })
      .optional()
      .describe(
        "Material per role, for the common case a single string cannot express -- a floor " +
          "whose top is tile and whose sides are nodraw. Roles are the same ones " +
          "set_face_material's `facing` selects, cut at the same 45 degrees, so a ramp " +
          "counts as what it is closer to being. Any role left out falls back to " +
          "`material`.",
      ),
    lightmapScale: z.number().optional().describe("Luxels per unit on every face. Default 16."),
    textureScale: z.number().optional().describe("Texture scale on both axes. Default 0.25."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    target: z.string(),
    solidIds: z.array(z.number()),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    bytesAdded: z.number(),
    /** Every new solid, as the independent checker sees it. */
    verified: z.array(
      z.object({
        id: z.number().nullable(),
        sideCount: z.number(),
        vertexCount: z.number(),
        volume: z.number(),
        grid: z.number(),
        mins: Vec3,
        maxs: Vec3,
        valid: z.boolean(),
      }),
    ),
    warnings: z.array(z.string()),
    /** What a compound shape costs, in its own words. Empty for a plain brush. */
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    // Format before arguments: someone who passed a compiled map should hear about
    // that, not about the shape of a solid this tool will never get to read.
    resolveVmfInput(args.path, ctx.config);
    // Compound shapes expand into the convex brushes that make them up, so the writer
    // below sees nothing it did not see before. The count is reported back because a
    // caller who asks for one sphere and gets eight brushes has spent a budget it did not
    // know it was spending.
    const notes: string[] = [];
    const flattened: SolidSpec[] = [];
    for (const spec of args.solids) {
      if (COMPOUND.has(spec.shape)) {
        const expansion = expandShape(spec as unknown as CompoundSpec);
        flattened.push(...expansion.specs);
        notes.push(...expansion.notes);
      } else {
        flattened.push(spec as SolidSpec);
      }
    }

    return { ...placeSolids(args, flattened, ctx), notes };
  },
});

const FACING = z
  .enum(["+x", "-x", "+y", "-y"])
  .describe("A direction in plan, as an axis and a sign.");

const Fitting = z.discriminatedUnion("fitting", [
  z.object({
    fitting: z.literal("door_frame"),
    mins: Vec3.describe("The low corner of the hole already cut in the wall."),
    maxs: Vec3.describe("Its high corner. Thin through the wall, wide across it."),
    sides: z
      .enum(["both", "near", "far"])
      .optional()
      .describe("Which wall faces get a casing. Both unless the far side is never seen."),
    threshold: z.boolean().optional().describe("Lay a raised strip across the foot."),
  }),
  z.object({
    fitting: z.literal("counter"),
    mins: Vec3,
    maxs: Vec3,
    facing: FACING.describe("The side people stand at: where the top oversails and the kick sets back."),
  }),
  z.object({
    fitting: z.literal("skirting"),
    mins: Vec3.describe("Low corner of the room's inner volume."),
    maxs: Vec3.describe("High corner. For a cornice this z is the ceiling."),
    omit: z
      .array(FACING)
      .optional()
      .describe("Walls to leave bare, because a doorway or a run of casework is against them."),
    at: z.enum(["floor", "ceiling"]).optional().describe("Skirting, or a cornice. Floor by default."),
  }),
]);

export const writeVmfFittingTool = defineTool({
  name: "write_vmf_fitting",
  description:
    "Builds the things a room is finished with -- a door casing, a counter, skirting or a " +
    "cornice -- as the several brushes each of them actually is. write_vmf_solid makes one " +
    "convex shape per call, so an agent that thinks 'counter' writes a box: three rounds of " +
    "building maps with these tools produced counters, shelving and doorways that were each " +
    "a single slab, with a door texture painted flat on a wall where a frame should be. " +
    "The trade here is that you own the envelope and this owns the articulation -- give it " +
    "the same mins/maxs you would have given a box and get a worktop with a nosing over a " +
    "body over a recessed kick. Every internal dimension comes from a table measured off " +
    "models Valve ships (read_model_info, 13/08/2026), which also found that Source's world " +
    "is built a third taller than its own player: a door leaf is 108 units, a shop counter " +
    "56, with the eye at 64. Refuses any assembly whose parts share an interior or fail to " +
    "join up, which is a class of error per-brush validation cannot see.",
  realm: "map",
  guarded: true,
  /** Same reasoning as `write_vmf_solid`: this adds to a file that is usually the only copy. */
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    fittings: z.array(Fitting).min(1).describe("What to build, in order."),
    entityId: z
      .number()
      .optional()
      .describe("Hammer id of a brush entity to add them to. Omit to add them to the world."),
    material: z.string().optional().describe("Material for every face. Default TOOLS/TOOLSNODRAW."),
    materials: z
      .object({
        top: z.string().optional(),
        bottom: z.string().optional(),
        sides: z.string().optional(),
      })
      .optional()
      .describe("Material per role, as write_vmf_solid takes it and at the same threshold."),
    lightmapScale: z.number().optional().describe("Luxels per unit on every face. Default 16."),
    textureScale: z.number().optional().describe("Texture scale on both axes. Default 0.25."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    target: z.string(),
    solidIds: z.array(z.number()),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    bytesAdded: z.number(),
    verified: z.array(
      z.object({
        id: z.number().nullable(),
        sideCount: z.number(),
        vertexCount: z.number(),
        volume: z.number(),
        grid: z.number(),
        mins: Vec3,
        maxs: Vec3,
        valid: z.boolean(),
      }),
    ),
    /** One entry per fitting asked for, in the order they were asked for. */
    built: z.array(
      z.object({
        fitting: z.string(),
        /** What the parts are called, which is how a note or a later edit names one. */
        parts: z.array(z.string()),
        brushes: z.number(),
        /**
         * How deep the fitting stands. Reported because furniture past about 32 units deep
         * has been measured to collapse the room segmentation from 200 units away, and
         * nothing else in the chain says which brush did it.
         */
        depth: z.number(),
      }),
    ),
    warnings: z.array(z.string()),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    // Format before arguments: someone who passed a compiled map should hear about
    // that, not about the shape of a solid this tool will never get to read.
    resolveVmfInput(args.path, ctx.config);
    const notes: string[] = [];
    const specs: SolidSpec[] = [];
    const built: { fitting: string; parts: string[]; brushes: number; depth: number }[] = [];

    // Expanded and checked before anything is written, so a fitting that does not come out
    // whole refuses the whole call rather than leaving half an assembly in the file.
    for (const spec of args.fittings) {
      const expansion = expandFitting(spec as FittingSpec);
      specs.push(...expansion.specs);
      notes.push(...expansion.notes);
      built.push({
        fitting: spec.fitting,
        parts: expansion.parts.map((p) => p.name),
        brushes: expansion.specs.length,
        depth: expansion.depth,
      });
    }

    return { ...placeSolids(args, specs, ctx), built, notes };
  },
});

export const buildTools = [writeVmfSolidTool, writeVmfFittingTool];
