import { z } from "zod";
import { readLightmapBudget } from "../bsp/lightmap.js";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

/** Ceilings chosen to spread real-map luxel counts, not a formula: see `docs/measuring.md`. */
const BUCKETS: Array<{ label: string; max: number }> = [
  { label: "1-16", max: 16 },
  { label: "17-64", max: 64 },
  { label: "65-256", max: 256 },
  { label: "257-1024", max: 1024 },
  { label: "1025-4096", max: 4096 },
  { label: "4097+", max: Infinity },
];

export const readLightmapBudgetTool = defineTool({
  name: "read_lightmap_budget",
  description:
    "Where a compiled map's lightmap resolution went. Reads FACES and TEXINFO by offset: " +
    "the total luxel count, a histogram by face size, the costliest individual faces, and " +
    "luxels per unit of lit surface area when computable. Faces that could never carry a " +
    "lightmap -- sky, nodraw, SURF_NOLIGHT -- are excluded via TEXINFO's flags, so the total " +
    "is a budget, not a headcount padded with faces that cost nothing.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe("How many of the costliest faces to list."),
  },
  outputSchema: {
    path: z.string(),
    faceCount: z.number(),
    facesWithLightmap: z.number(),
    totalLuxels: z.number(),
    luxelsPerAreaUnit: z
      .number()
      .nullable()
      .describe("totalLuxels / summed face area, in Hammer units^2. Null when no lit face has area."),
    distribution: z.array(
      z.object({ bucket: z.string(), faceCount: z.number(), luxels: z.number() }),
    ),
    costliest: z.array(
      z.object({
        index: z.number(),
        texinfo: z.number(),
        luxels: z.number(),
        sizeLuxels: z.tuple([z.number(), z.number()]),
        area: z.number(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const r = readLightmapBudget(resolveInput(args.path, ctx.config));
    const lit = r.faces.filter((f) => f.hasLightmap);

    const distribution = BUCKETS.map(({ label, max }, i) => {
      const min = i === 0 ? 1 : BUCKETS[i - 1]!.max + 1;
      const inBucket = lit.filter((f) => f.luxels >= min && f.luxels <= max);
      return {
        bucket: label,
        faceCount: inBucket.length,
        luxels: inBucket.reduce((a, f) => a + f.luxels, 0),
      };
    });

    const costliest = [...lit]
      .sort((a, b) => b.luxels - a.luxels)
      .slice(0, args.limit)
      .map((f) => ({
        index: f.index,
        texinfo: f.texinfo,
        luxels: f.luxels,
        sizeLuxels: f.sizeLuxels,
        area: Math.round(f.area * 100) / 100,
      }));

    return {
      path: r.header.path,
      faceCount: r.faceCount,
      facesWithLightmap: r.facesWithLightmap,
      totalLuxels: r.totalLuxels,
      luxelsPerAreaUnit:
        r.litAreaUnits > 0 ? Math.round((r.totalLuxels / r.litAreaUnits) * 1000) / 1000 : null,
      distribution,
      costliest,
    };
  },
});

export const lightmapTools = [readLightmapBudgetTool];
