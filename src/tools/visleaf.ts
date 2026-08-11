import { z } from "zod";
import { readVisleafStats } from "../bsp/visleaf.js";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export const readVisleafStatsTool = defineTool({
  name: "read_visleaf_stats",
  description:
    "Quality of a compiled map's visibility split: LEAFS for the bounding volume and " +
    "cluster of every leaf, VISIBILITY for the map's real cluster count from its own " +
    "header. Reports leaf and cluster counts, the distribution of leaf volumes (median " +
    "and mean), and the fraction of leaves outside any cluster (-1) -- usually solid " +
    "leaves, which own no visible space. Handles both dleaf_t sizes (version 0 and 1); " +
    "any other LEAFS version is refused rather than guessed at.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    leafVersion: z.number(),
    leafBytes: z.number().describe("dleaf_t record size this map uses: 32 or 56 bytes."),
    leafCount: z.number(),
    clusterCount: z
      .number()
      .nullable()
      .describe("From VISIBILITY's own header. Null when the lump is empty (vis not run)."),
    visibilityBytes: z.number(),
    noClusterLeafCount: z.number(),
    noClusterFraction: z.number(),
    volume: z.object({
      minUnits3: z.number(),
      maxUnits3: z.number(),
      medianUnits3: z.number(),
      meanUnits3: z.number(),
      /** maxs below mins on some axis: a malformed leaf, clamped to 0 rather than negative. */
      degenerateLeafCount: z.number(),
    }),
  },
  handler: (args, ctx) => {
    const r = readVisleafStats(resolveInput(args.path, ctx.config));
    const volumes = r.leaves.map((l) => l.volume);
    const total = volumes.reduce((a, v) => a + v, 0);

    return {
      path: r.header.path,
      leafVersion: r.leafVersion,
      leafBytes: r.leafBytes,
      leafCount: r.leafCount,
      clusterCount: r.clusterCount,
      visibilityBytes: r.visibilityBytes,
      noClusterLeafCount: r.noClusterLeafCount,
      noClusterFraction:
        r.leafCount > 0 ? Math.round((r.noClusterLeafCount / r.leafCount) * 1000) / 1000 : 0,
      volume: {
        minUnits3: volumes.length ? Math.min(...volumes) : 0,
        maxUnits3: volumes.length ? Math.max(...volumes) : 0,
        medianUnits3: median(volumes),
        meanUnits3: volumes.length ? Math.round(total / volumes.length) : 0,
        degenerateLeafCount: r.leaves.filter((l) => l.volume === 0).length,
      },
    };
  },
});

export const visleafTools = [readVisleafStatsTool];
