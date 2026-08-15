import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { resolveInput, resolveVmfInput } from "./paths.js";

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

const Finding = z.object({
  severity: z.enum(["error", "warning", "info"]),
  rule: z.string(),
  message: z.string(),
  entityId: z.number().optional(),
});

export const readVmfSolidsTool = defineTool({
  name: "read_vmf_solids",
  description:
    "Rebuilds every brush of a .vmf from its planes and checks that it is a closed convex " +
    "volume. Reports each solid's corner count, bounding box and volume, plus what is " +
    "wrong with it: a side wound the wrong way (the planes then enclose nothing), three " +
    "collinear points that define no plane, a side that bounds no face, a corner outside " +
    "the world, a texture axis pointing along its own face normal so the texture stretches " +
    "without bound. It runs the opposite way round from anything that writes a brush -- " +
    "planes to volume rather than volume to planes -- which is what makes it usable as an " +
    "independent check rather than a restatement.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    include: z
      .enum(["invalid", "all"])
      .optional()
      .describe("Which solids to return. 'invalid' (default) returns only those with an error."),
    grid: z
      .number()
      .optional()
      .describe("Grid size corners are expected to land on. 1 (default) means integers; 0 disables."),
    vertices: z
      .boolean()
      .optional()
      .describe("Include every corner's coordinates. Off by default: it is a lot of numbers."),
    limit: z.number().optional().describe("Maximum solids to return. Default 50."),
  },
  outputSchema: {
    path: z.string(),
    solidCount: z.number(),
    validCount: z.number(),
    /** Counts by rule across the whole file, whatever `limit` returned. */
    findingCounts: z.record(z.string(), z.number()),
    gridHistogram: z
      .record(z.string(), z.number())
      .describe("Solids per grid size, coarsest first; key '0' means not on whole units."),
    returned: z.number(),
    truncated: z.boolean(),
    solids: z.array(
      z.object({
        id: z.number().nullable(),
        owner: z.string(),
        index: z.number(),
        sideCount: z.number(),
        vertexCount: z.number(),
        mins: Vec3,
        maxs: Vec3,
        volume: z.number(),
        grid: z.number(),
        valid: z.boolean(),
        displacementSides: z.number(),
        findings: z.array(Finding),
        vertices: z.array(Vec3).optional(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const report = checkVmfSolids(path, readFileSync(path, "utf8"), { grid: args.grid });

    const findingCounts: Record<string, number> = {};
    for (const f of report.findings) {
      findingCounts[f.rule] = (findingCounts[f.rule] ?? 0) + 1;
    }

    const wanted =
      (args.include ?? "invalid") === "all" ? report.solids : report.solids.filter((s) => !s.valid);
    const limit = args.limit ?? 50;
    const page = wanted.slice(0, limit);

    return {
      path: report.path,
      solidCount: report.solidCount,
      validCount: report.validCount,
      findingCounts,
      gridHistogram: report.gridHistogram,
      returned: page.length,
      truncated: page.length < wanted.length,
      solids: page.map((s) => ({
        id: s.id,
        owner: s.owner,
        index: s.index,
        sideCount: s.sides.length,
        vertexCount: s.vertices.length,
        mins: s.mins as unknown as [number, number, number],
        maxs: s.maxs as unknown as [number, number, number],
        volume: s.volume,
        grid: s.grid,
        valid: s.valid,
        displacementSides: s.sides.filter((side) => side.hasDisplacement).length,
        findings: s.findings,
        ...(args.vertices
          ? { vertices: s.vertices as unknown as Array<[number, number, number]> }
          : {}),
      })),
    };
  },
});

export const solidTools = [readVmfSolidsTool];
