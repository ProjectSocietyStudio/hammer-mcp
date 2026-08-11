import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import type { SolidSpec } from "../vmf/build.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { CONFIRM, resolveInput } from "./paths.js";

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
]);

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
    lightmapScale: z.number().optional().describe("Luxels per unit on every face. Default 16."),
    textureScale: z.number().optional().describe("Texture scale on both axes. Default 0.25."),
    dryRun: z
      .boolean()
      .optional()
      .describe("Check and report without writing. The verification runs either way."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
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
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const beforeReport = checkVmfSolids(path, before);

    const result = insertSolids(before, args.solids as SolidSpec[], {
      ...(args.entityId !== undefined ? { entityId: args.entityId } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
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

    const write = args.dryRun !== true;
    if (write) writeFileSync(path, result.text, "utf8");

    return {
      path,
      written: write,
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
  },
});

export const buildTools = [writeVmfSolidTool];
