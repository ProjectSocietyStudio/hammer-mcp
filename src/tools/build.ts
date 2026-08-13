import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import { FACING_COSINE } from "../vmf/select.js";
import type { SolidSpec } from "../vmf/build.js";
import { expandShape } from "../vmf/shapes.js";
import type { CompoundSpec } from "../vmf/shapes.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

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
    innerRadius: z.number(),
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
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const beforeReport = checkVmfSolids(path, before);

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

    const result = insertSolids(before, flattened, {
      ...(args.entityId !== undefined ? { entityId: args.entityId } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
      // Same cut as `select.ts` and `classify.ts` use for `facing`, deliberately: a second
      // threshold for the same word is how two tools come to disagree about what a wall is.
      ...(args.materials !== undefined
        ? {
            materialForFace: (face: { normal: readonly number[] }) => {
              const z = face.normal[2]!;
              if (z > FACING_COSINE) return args.materials!.top;
              if (z < -FACING_COSINE) return args.materials!.bottom;
              return args.materials!.sides;
            },
          }
        : {}),
      ...(args.lightmapScale !== undefined ? { lightmapScale: args.lightmapScale } : {}),
      ...(args.textureScale !== undefined ? { textureScale: args.textureScale } : {}),
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
      dryRun: args.dryRun,
      backup: args.backup,
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
      notes,
    };
  },
});

export const buildTools = [writeVmfSolidTool];
