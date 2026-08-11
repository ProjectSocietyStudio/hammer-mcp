import { z } from "zod";
import { readMaterials } from "../bsp/materials.js";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

export const readMaterialsTool = defineTool({
  name: "read_materials",
  description:
    "Material table of a compiled map: every texture referenced by a TEXINFO, and how many " +
    "TEXINFO entries reuse it -- the only accurate reuse count in the file. Reads TEXDATA, " +
    "TEXDATA_STRING_TABLE, TEXDATA_STRING_DATA and TEXINFO by offset, never the whole map. " +
    "Answers which materials a map actually employs, and which carry the bulk of its surfaces.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    limit: z.number().int().min(1).max(2000).default(200),
    sortBy: z
      .enum(["usage", "name"])
      .default("usage")
      .describe("usage: most-referenced material first. name: alphabetical."),
    nameContains: z
      .string()
      .optional()
      .describe("Case-insensitive substring filter on the material path."),
  },
  outputSchema: {
    path: z.string(),
    texdataCount: z.number(),
    texinfoCount: z.number(),
    unattributedTexinfo: z
      .number()
      .describe("TEXINFO entries whose texdata index is out of range -- normally zero."),
    materialCount: z.number().describe("Distinct material names, after filtering."),
    returned: z.number(),
    materials: z.array(
      z.object({
        name: z.string(),
        usageCount: z.number(),
        width: z.number(),
        height: z.number(),
      }),
    ),
  },
  handler: (args, ctx) => {
    const r = readMaterials(resolveInput(args.path, ctx.config));
    const needle = args.nameContains?.toLowerCase();
    let materials = needle
      ? r.materials.filter((m) => m.name.toLowerCase().includes(needle))
      : r.materials;

    materials = [...materials].sort((a, b) =>
      args.sortBy === "name" ? a.name.localeCompare(b.name) : b.usageCount - a.usageCount,
    );

    return {
      path: r.header.path,
      texdataCount: r.texdataCount,
      texinfoCount: r.texinfoCount,
      unattributedTexinfo: r.unattributedTexinfo,
      materialCount: materials.length,
      returned: Math.min(materials.length, args.limit),
      materials: materials.slice(0, args.limit).map((m) => ({
        name: m.name,
        usageCount: m.usageCount,
        width: m.width,
        height: m.height,
      })),
    };
  },
});

export const materialsTools = [readMaterialsTool];
