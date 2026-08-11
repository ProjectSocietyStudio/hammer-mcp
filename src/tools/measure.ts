import { z } from "zod";
import { readEntityLump } from "../bsp/entities.js";
import { readGeometry } from "../bsp/geometry.js";
import { METRES_PER_UNIT, readModels, worldExtents } from "../bsp/models.js";
import {
  columnSurfaces,
  distance,
  isVisible,
  readTree,
} from "../bsp/trace.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

const VEC3 = z.array(z.number()).length(3);

export const readMapExtents = defineTool({
  name: "read_map_extents",
  description:
    "Real size of a compiled map, from the world model in lump 14. Returns the bounding " +
    "box in Hammer units and in metres, the longest horizontal span and the ground area. " +
    "Use this rather than entity origins: those say where things were placed, not how far " +
    "the world goes. One Hammer unit is one inch (0.0254 m). Instant on any map size.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    modelCount: z.number().describe("Model 0 is the world; the rest are brush entities."),
    mins: VEC3,
    maxs: VEC3,
    sizeUnits: VEC3,
    sizeMetres: VEC3,
    spanUnits: z.number(),
    spanMetres: z.number(),
    areaSquareMetres: z.number(),
    metresPerUnit: z.number(),
  },
  handler: (args, ctx) => {
    const lump = readModels(resolveInput(args.path, ctx.config));
    const e = worldExtents(lump);
    return {
      path: lump.header.path,
      modelCount: lump.models.length,
      mins: e.mins,
      maxs: e.maxs,
      sizeUnits: e.sizeUnits,
      sizeMetres: e.sizeMetres,
      spanUnits: e.spanUnits,
      spanMetres: e.spanMetres,
      areaSquareMetres: e.areaSquareMetres,
      metresPerUnit: METRES_PER_UNIT,
    };
  },
});

export const readMapGeometry = defineTool({
  name: "read_map_geometry",
  description:
    "What each lump of a compiled map holds, and how close that is to the compiler's " +
    "ceiling. Reads only the 1036-byte directory, so it is instant. Limits are vbsp's own, " +
    "from source-sdk-2013; a map that exceeds one is a map whose compilers raised it, not " +
    "a broken map. Use it to see what stops a map from growing before planning work on it.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    nearLimitOnly: z
      .boolean()
      .default(false)
      .describe("Return only the lumps at or above 80% of their ceiling."),
  },
  outputSchema: {
    path: z.string(),
    version: z.number(),
    mapRevision: z.number(),
    fileSize: z.number(),
    limitSource: z.string(),
    lumps: z.array(
      z.object({
        index: z.number(),
        name: z.string(),
        bytes: z.number(),
        megabytes: z.number(),
        count: z.number().nullable(),
        limit: z.number().optional(),
        limitName: z.string().optional(),
        usedFraction: z.number().optional(),
        note: z.string().optional(),
      }),
    ),
    nearLimitCount: z.number(),
  },
  handler: (args, ctx) => {
    const g = readGeometry(resolveInput(args.path, ctx.config));
    return {
      path: g.header.path,
      version: g.header.version,
      mapRevision: g.header.mapRevision,
      fileSize: g.header.fileSize,
      limitSource: "source-sdk-2013 src/public/bspfile.h, read 11/08/2026",
      lumps: args.nearLimitOnly ? g.nearLimit : g.lumps,
      nearLimitCount: g.nearLimit.length,
    };
  },
});

/**
 * Keys whose NON-EMPTY value means a prop has to stay dynamic.
 *
 * Presence alone proves nothing: Hammer writes every key of the class with its default,
 * so all 59 prop_dynamic entities of `rp_nycity_day` carry `parentname`, `defaultanim`
 * and `targetname` -- 29, 18 and 14 of them respectively with an actual value. A filter
 * keyed on presence returned zero candidates out of 59, which is how this was caught.
 */
const NAMING_KEYS = ["targetname", "parentname"];

/** Animation keys. `idle` is the resting default and does not require a dynamic prop. */
const ANIM_KEYS = ["defaultanim"];

/** Flags that only count when actually turned on. */
const TRUTHY_FLAGS = ["randomanimation", "holdanimation"];

export const readPropSurvey = defineTool({
  name: "read_prop_survey",
  description:
    "Inventory of a compiled map's prop entities, by model and by class, plus the " +
    "prop_dynamic entities that carry no name, no parent, no animation and no output. " +
    "Those are dynamic for no reason: each is a real server entity that ticks and is " +
    "counted by anything walking ents.GetAll(), where a prop_static costs nothing. " +
    "The list is a starting point, not a verdict -- converting needs a recompile, and a " +
    "model without static support cannot be converted at all.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .default(100)
      .describe("Cap on the listed conversion candidates."),
  },
  outputSchema: {
    path: z.string(),
    totalEntities: z.number(),
    propTotal: z.number(),
    byClass: z.record(z.number()),
    byModel: z.array(z.object({ model: z.string(), count: z.number() })),
    staticCandidates: z.object({
      caveat: z.string(),
      total: z.number(),
      returned: z.number(),
      entities: z.array(
        z.object({
          index: z.number(),
          model: z.string().nullable(),
          origin: VEC3.nullable(),
        }),
      ),
    }),
  },
  handler: (args, ctx) => {
    const lump = readEntityLump(resolveInput(args.path, ctx.config));
    const props = lump.entities.filter((e) => e.classname.startsWith("prop_"));

    // keyvalues is an ordered pair list, duplicates included -- the shape the splice
    // write path needs. Indexing it here is cheaper than changing that.
    const keysOf = (e: (typeof props)[number]): Set<string> =>
      new Set(e.keyvalues.map(([k]) => k.toLowerCase()));
    const valueOf = (e: (typeof props)[number], key: string): string | undefined =>
      e.keyvalues.find(([k]) => k.toLowerCase() === key)?.[1];

    const byClass = new Map<string, number>();
    const byModel = new Map<string, number>();
    for (const p of props) {
      byClass.set(p.classname, (byClass.get(p.classname) ?? 0) + 1);
      const model = valueOf(p, "model");
      if (model) byModel.set(model, (byModel.get(model) ?? 0) + 1);
    }

    const candidates = props.filter((p) => {
      if (p.classname !== "prop_dynamic") return false;
      if (NAMING_KEYS.some((k) => (valueOf(p, k) ?? "") !== "")) return false;
      if (ANIM_KEYS.some((k) => {
        const v = (valueOf(p, k) ?? "").toLowerCase();
        return v !== "" && v !== "idle";
      })) return false;
      if (TRUTHY_FLAGS.some((k) => (valueOf(p, k) ?? "0") === "1")) return false;
      // An output with a target means something drives this prop.
      return !p.keyvalues.some(
        ([k, v]) => k.toLowerCase().startsWith("on") && v.trim() !== "",
      );
    });

    return {
      path: lump.header.path,
      totalEntities: lump.entities.length,
      propTotal: props.length,
      byClass: Object.fromEntries([...byClass].sort((a, b) => b[1] - a[1])),
      byModel: [...byModel]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([model, count]) => ({ model, count })),
      staticCandidates: {
        caveat:
          "Candidates only. Conversion needs a recompile, the model must support " +
          "static props, and Lua that finds a prop by anything other than targetname " +
          "would still lose it.",
        total: candidates.length,
        returned: Math.min(candidates.length, args.limit),
        entities: candidates.slice(0, args.limit).map((e) => ({
          index: e.index,
          model: valueOf(e, "model") ?? null,
          origin: e.origin ?? null,
        })),
      },
    };
  },
});

interface PakfileReply {
  path: string;
  fileCount: number;
  totalBytes: number;
  byExtension: Record<string, number>;
  cubemapTextures: number;
  returned: number;
  largest: Array<{ name: string; bytes: number; compressed: number }>;
}

export const readPakfile = defineTool({
  name: "read_pakfile",
  description:
    "What a compiled map actually ships inside it: lump 40 is a plain ZIP, and this lists " +
    "its contents by extension and by size. Use it to audit packing before release. Two " +
    "counts answer questions you would otherwise have to trust the compile settings for: " +
    "c-*.vtf files prove buildcubemaps was run, and .vhv files prove static prop lighting " +
    "was baked. Needs the Python sidecar; see health.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .default(50)
      .describe("How many of the largest entries to list."),
  },
  outputSchema: {
    path: z.string(),
    fileCount: z.number(),
    totalBytes: z.number(),
    megabytes: z.number(),
    byExtension: z.record(z.number()),
    cubemapTextures: z
      .number()
      .describe("c-*.vtf entries: machine-checkable proof buildcubemaps ran."),
    staticPropLighting: z
      .number()
      .describe(".vhv entries: per-vertex prop lighting, baked by vrad -StaticPropLighting."),
    returned: z.number(),
    largest: z.array(
      z.object({ name: z.string(), bytes: z.number(), compressed: z.number() }),
    ),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const r = await callSidecar<PakfileReply>(
      "pakfile",
      { path, limit: args.limit },
      ctx.config,
      300_000,
    );
    return {
      path: r.path,
      fileCount: r.fileCount,
      totalBytes: r.totalBytes,
      megabytes: Math.round((r.totalBytes / 1048576) * 10) / 10,
      byExtension: r.byExtension,
      cubemapTextures: r.cubemapTextures,
      staticPropLighting: r.byExtension["vhv"] ?? 0,
      returned: r.returned,
      largest: r.largest,
    };
  },
});



/** Median of a numeric list. Empty gives 0, which callers treat as "no signal". */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export const readSightlines = defineTool({
  name: "read_sightlines",
  description:
    "Longest unobstructed lines of sight across a compiled map, traced against the same " +
    "world tree the engine walks for a TraceLine. Samples standable ground on a grid at " +
    "the elevation where the map's content sits, then measures every pair. Answers " +
    "'how far can someone actually see here', which is what sets engagement range. " +
    "It does NOT know what a street is, and it ignores static props and brush entities " +
    "(a door counts as open) -- see the `excludes` field it returns.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    spacing: z
      .number()
      .int()
      .min(64)
      .max(8192)
      .default(512)
      .describe("Grid step in Hammer units. Smaller is finer and quadratically slower."),
    eyeHeight: z
      .number()
      .min(0)
      .max(256)
      .default(64)
      .describe("Height above ground for the sample point. 64 is a standing player's eye."),
    elevation: z
      .number()
      .optional()
      .describe("Ground elevation to sample. Defaults to the median entity origin z."),
    elevationTolerance: z
      .number()
      .min(0)
      .default(512)
      .describe("How far a surface may sit from `elevation` and still be sampled."),
    requireNearbyContent: z
      .boolean()
      .default(true)
      .describe("Keep only points with a map entity nearby, as a proxy for built-up area."),
    limit: z.number().int().min(1).max(50).default(5),
  },
  outputSchema: {
    path: z.string(),
    elevation: z.number(),
    spacing: z.number(),
    samplePoints: z.number(),
    pairsTested: z.number(),
    excludes: z.array(z.string()),
    longest: z.array(
      z.object({
        units: z.number(),
        metres: z.number(),
        from: VEC3,
        to: VEC3,
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const tree = readTree(path);
    const extents = worldExtents(readModels(path));
    const entities = readEntityLump(path).entities.filter((e) => e.origin);

    const elevation =
      args.elevation ?? median(entities.map((e) => e.origin![2]));

    const near = args.spacing;
    const points: Array<[number, number, number]> = [];
    const half = args.spacing / 2;
    for (let x = extents.mins[0] + half; x < extents.maxs[0]; x += args.spacing) {
      for (let y = extents.mins[1] + half; y < extents.maxs[1]; y += args.spacing) {
        const levels = columnSurfaces(
          tree,
          x,
          y,
          extents.maxs[2] - 16,
          extents.mins[2] + 1,
          args.eyeHeight,
        );
        let best: (typeof levels)[number] | undefined;
        let bestDelta = Infinity;
        for (const l of levels) {
          const d = Math.abs(l.groundZ - elevation);
          if (d < bestDelta) {
            bestDelta = d;
            best = l;
          }
        }
        if (!best || bestDelta > args.elevationTolerance) continue;
        if (args.requireNearbyContent) {
          const g = best;
          const hasContent = entities.some(
            (e) =>
              Math.abs(e.origin![0] - x) < near &&
              Math.abs(e.origin![1] - y) < near &&
              Math.abs(e.origin![2] - g.groundZ) < near,
          );
          if (!hasContent) continue;
        }
        points.push(best.eye);
      }
    }

    const longest: Array<{ d: number; a: [number, number, number]; b: [number, number, number] }> =
      [];
    let pairs = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        pairs++;
        const d = distance(points[i]!, points[j]!);
        // Once the shortlist is full, anything shorter than its tail cannot enter it,
        // and the trace is the expensive part.
        if (longest.length >= args.limit && d <= longest[longest.length - 1]!.d) continue;
        if (!isVisible(tree, points[i]!, points[j]!)) continue;
        longest.push({ d, a: points[i]!, b: points[j]! });
        longest.sort((p, q) => q.d - p.d);
        longest.length = Math.min(longest.length, args.limit);
      }
    }

    return {
      path,
      elevation,
      spacing: args.spacing,
      samplePoints: points.length,
      pairsTested: pairs,
      excludes: [
        "static props: 'prop_static' geometry is not in the world tree",
        "brush entities: a func_door or func_brush is not in the world tree, so a closed door reads as open",
        "displacements are in the tree, but no notion of 'street' exists in a .bsp -- an open line may cross terrain rather than a road",
      ],
      longest: longest.map((l) => ({
        units: Math.round(l.d),
        metres: Math.round(l.d * METRES_PER_UNIT * 10) / 10,
        from: l.a.map((n) => Math.round(n)) as [number, number, number],
        to: l.b.map((n) => Math.round(n)) as [number, number, number],
      })),
    };
  },
});


export const readBrushVolumes = defineTool({
  name: "read_brush_volumes",
  description:
    "Footprint and volume of every brush entity in a compiled map, grouped by classname. " +
    "Each func_* entity owns a brush model (*N in lump 14) whose bounding box this reads. " +
    "Use it to size the built environment -- shop fronts, rooms behind a func_door, " +
    "areaportal openings -- when a spec needs a floor area rather than a guess. It reports " +
    "bounding boxes, not true volumes: an L-shaped room measures as its enclosing box.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    classname: z.string().optional().describe("Restrict to one classname, e.g. func_door."),
    limit: z.number().int().min(1).max(1000).default(50),
  },
  outputSchema: {
    path: z.string(),
    brushModels: z.number(),
    attributed: z.number().describe("Models an entity claims through its `model` key."),
    byClass: z.array(
      z.object({
        classname: z.string(),
        count: z.number(),
        medianFloorSquareMetres: z.number(),
        totalFloorSquareMetres: z.number(),
      }),
    ),
    largest: z.array(
      z.object({
        model: z.string(),
        classname: z.string(),
        targetname: z.string().nullable(),
        floorSquareMetres: z.number(),
        heightMetres: z.number(),
        origin: VEC3,
      }),
    ),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const lump = readModels(path);
    const entities = readEntityLump(path).entities;

    // Model 0 is the world; brush entities claim models 1..n through "model" "*N".
    const owner = new Map<number, { classname: string; targetname?: string }>();
    for (const e of entities) {
      const raw = e.keyvalues.find(([k]) => k.toLowerCase() === "model")?.[1];
      if (!raw || !raw.startsWith("*")) continue;
      const n = Number(raw.slice(1));
      if (Number.isInteger(n)) {
        owner.set(n, { classname: e.classname, ...(e.targetname ? { targetname: e.targetname } : {}) });
      }
    }

    const rows = lump.models
      .filter((m) => m.index > 0)
      .map((m) => {
        const o = owner.get(m.index);
        const w = (m.maxs[0] - m.mins[0]) * METRES_PER_UNIT;
        const d = (m.maxs[1] - m.mins[1]) * METRES_PER_UNIT;
        const h = (m.maxs[2] - m.mins[2]) * METRES_PER_UNIT;
        return {
          model: `*${m.index}`,
          classname: o?.classname ?? "(unclaimed)",
          targetname: o?.targetname ?? null,
          floorSquareMetres: Math.round(w * d * 100) / 100,
          heightMetres: Math.round(h * 100) / 100,
          origin: m.origin.map((n) => Math.round(n)) as [number, number, number],
        };
      })
      .filter((r) => !args.classname || r.classname === args.classname);

    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const g = groups.get(r.classname) ?? [];
      g.push(r.floorSquareMetres);
      groups.set(r.classname, g);
    }

    return {
      path,
      brushModels: lump.models.length - 1,
      attributed: rows.filter((r) => r.classname !== "(unclaimed)").length,
      byClass: [...groups]
        .map(([classname, areas]) => ({
          classname,
          count: areas.length,
          medianFloorSquareMetres: Math.round(median(areas) * 100) / 100,
          totalFloorSquareMetres: Math.round(areas.reduce((a, b) => a + b, 0) * 100) / 100,
        }))
        .sort((a, b) => b.count - a.count),
      largest: [...rows]
        .sort((a, b) => b.floorSquareMetres - a.floorSquareMetres)
        .slice(0, args.limit),
    };
  },
});

export const measureTools = [
  readMapExtents,
  readMapGeometry,
  readPropSurvey,
  readPakfile,
  readSightlines,
  readBrushVolumes,
];
