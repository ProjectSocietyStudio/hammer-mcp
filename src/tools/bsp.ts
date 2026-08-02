import { z } from "zod";
import { readEntityLump } from "../bsp/entities.js";
import { readHeader } from "../bsp/header.js";
import { histogram, matchesFilter } from "../entity/model.js";
import type { EntityFilter, Vec3 } from "../entity/model.js";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

const VEC3 = z.array(z.number()).length(3);

const ENTITY_QUERY = {
  classname: z.string().optional().describe("Exact classname match."),
  classnameContains: z.string().optional().describe("Substring match on classname."),
  targetname: z.string().optional().describe("Exact targetname match."),
  near: VEC3.optional().describe("Centre of a radius search, as [x, y, z]."),
  radius: z.number().positive().optional().describe("Radius for `near` (default 512)."),
  limit: z.number().int().min(1).max(2000).default(200),
  offset: z.number().int().min(0).default(0),
};

function toFilter(a: Record<string, unknown>): EntityFilter {
  return {
    ...(a["classname"] ? { classname: a["classname"] as string } : {}),
    ...(a["classnameContains"]
      ? { classnameContains: a["classnameContains"] as string }
      : {}),
    ...(a["targetname"] ? { targetname: a["targetname"] as string } : {}),
    ...(a["near"] ? { near: a["near"] as Vec3 } : {}),
    ...(a["radius"] ? { radius: a["radius"] as number } : {}),
  };
}

export const readBspInfo = defineTool({
  name: "read_bsp_info",
  description:
    "Header of a compiled .bsp: ident, version, mapRevision and all 64 lumps with their " +
    "offset and size. Reads only the first 1036 bytes, so it is instant even on a 1 GB map. " +
    "Use the mapRevision it reports when building a .lmp entity patch for this map.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    /** Most lumps are empty; listing all 64 is noise unless you asked for it. */
    allLumps: z
      .boolean()
      .default(false)
      .describe("Include empty lumps (default: only lumps with content)."),
  },
  handler: (args, ctx) => {
    const header = readHeader(resolveInput(args.path, ctx.config));
    const lumps = args.allLumps ? header.lumps : header.lumps.filter((l) => l.length > 0);
    return {
      path: header.path,
      ident: header.ident,
      version: header.version,
      mapRevision: header.mapRevision,
      fileSize: header.fileSize,
      lumpCount: lumps.length,
      lumps: [...lumps]
        .sort((a, b) => b.length - a.length)
        .map((l) => ({
          index: l.index,
          name: l.name ?? null,
          offset: l.offset,
          length: l.length,
          megabytes: Math.round((l.length / 1048576) * 100) / 100,
          version: l.version,
        })),
    };
  },
});

export const readBspEntities = defineTool({
  name: "read_bsp_entities",
  description:
    "Entities of a compiled .bsp, read from lump 0. Returns a classname histogram plus a " +
    "filtered, paginated entity list. Seeks straight to the lump -- on a 1 GB map this reads " +
    "about 1.5 MB. Note that a compiled lump has no Hammer ids; entities are keyed by index.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    ...ENTITY_QUERY,
    histogramOnly: z
      .boolean()
      .default(false)
      .describe("Return only the classname histogram and counts."),
  },
  handler: (args, ctx) => {
    const lump = readEntityLump(resolveInput(args.path, ctx.config));
    const all = lump.entities;
    const filtered = all.filter((e) => matchesFilter(e, toFilter(args)));
    const page = filtered.slice(args.offset, args.offset + args.limit);

    return {
      path: lump.header.path,
      mapRevision: lump.header.mapRevision,
      lumpBytes: lump.text.length,
      nulTerminated: lump.nulTerminated,
      total: all.length,
      matched: filtered.length,
      histogram: Object.fromEntries(histogram(all)),
      ...(args.histogramOnly
        ? {}
        : {
            returned: page.length,
            truncated: args.offset + page.length < filtered.length,
            entities: page.map((e) => ({
              index: e.index,
              classname: e.classname,
              targetname: e.targetname ?? null,
              origin: e.origin ?? null,
              angles: e.angles ?? null,
              keyvalues: Object.fromEntries(e.keyvalues),
            })),
          }),
    };
  },
});

export const bspTools = [readBspInfo, readBspEntities];
