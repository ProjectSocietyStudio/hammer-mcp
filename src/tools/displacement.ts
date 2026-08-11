import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { readDisplacements } from "../vmf/displacement.js";
import { resolveInput } from "./paths.js";

const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const readDisplacementsTool = defineTool({
  name: "read_displacements",
  description:
    "Reads the displacements of a .vmf: the grids of vertices that replace a brush face " +
    "and make every piece of terrain in Source. Until now this toolkit could only detect " +
    "one -- read_vmf_solids has reported hasDisplacement since the beginning and nothing " +
    "has ever read what was in it. Reports each grid's power and size, where it starts, " +
    "how far the terrain moves, how much of it is painted, and the world position of every " +
    "vertex. Positions rather than raw arrays, because every question worth asking about a " +
    "displacement is a question about where its vertices are. Also finds seams: two " +
    "vertices that share an undisplaced point and no longer share a displaced one, which " +
    "is the crack a player falls through and which is invisible in the editor.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    includeVertices: z
      .boolean()
      .optional()
      .describe(
        "Return every vertex. Off by default: a power-4 displacement has 289 of them and " +
          "a hillside has dozens of displacements.",
      ),
  },
  outputSchema: {
    path: z.string(),
    count: z.number(),
    displacements: z.array(
      z.object({
        solidId: z.number(),
        owner: z.string(),
        sideIndex: z.number(),
        sideId: z.number().nullable(),
        material: z.string(),
        power: z.number(),
        /** 2^power + 1: the grid is this on a side. */
        size: z.number(),
        startPosition: Vec,
        elevation: z.number(),
        subdiv: z.boolean(),
        corners: z.array(Vec),
        minDistance: z.number(),
        maxDistance: z.number(),
        alphaPainted: z.number(),
        minAlpha: z.number(),
        maxAlpha: z.number(),
        vertices: z
          .array(z.object({ x: z.number(), y: z.number(), position: Vec, alpha: z.number() }))
          .optional(),
        findings: z.array(z.string()),
      }),
    ),
    /** Pairs that share a flat point and not a displaced one. */
    seams: z.array(
      z.object({
        between: z.array(z.number()),
        worstGap: z.number(),
        openPairs: z.number(),
      }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const r = readDisplacements(readFileSync(path, "utf8"));
    return {
      path,
      count: r.displacements.length,
      displacements: r.displacements.map((d) => ({
        solidId: d.solidId,
        owner: d.owner,
        sideIndex: d.sideIndex,
        sideId: d.sideId,
        material: d.material,
        power: d.power,
        size: d.size,
        startPosition: d.startPosition as unknown as [number, number, number],
        elevation: d.elevation,
        subdiv: d.subdiv,
        corners: d.corners as unknown as Array<[number, number, number]>,
        minDistance: d.minDistance,
        maxDistance: d.maxDistance,
        alphaPainted: d.alphaPainted,
        minAlpha: d.minAlpha,
        maxAlpha: d.maxAlpha,
        ...(args.includeVertices === true
          ? {
              vertices: d.vertices.map((v) => ({
                x: v.x,
                y: v.y,
                position: v.position as unknown as [number, number, number],
                alpha: v.alpha,
              })),
            }
          : {}),
        findings: d.findings,
      })),
      seams: r.seams.map((s) => ({
        between: s.between as unknown as number[],
        worstGap: s.worstGap,
        openPairs: s.openPairs,
      })),
      warnings: r.warnings,
      nextStep:
        "A seam is measured here and only the eye judges the terrain. Nothing offline says " +
        "whether a hillside looks like one.",
    };
  },
});

export const displacementTools = [readDisplacementsTool];
