import { z } from "zod";
import { readEntityLump } from "../bsp/entities.js";
import { readGeometry } from "../bsp/geometry.js";
import { METRES_PER_UNIT, readModels, worldExtents } from "../bsp/models.js";
import { defineTool } from "../mcp/registry.js";
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

export const measureTools = [readMapExtents, readMapGeometry, readPropSurvey];
