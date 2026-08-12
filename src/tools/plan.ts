import { readFileSync } from "node:fs";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { paint } from "../render/paint.js";
import { buildPlan } from "../render/plan.js";
import { encodePng } from "../render/png.js";
import { toSvg } from "../render/svg.js";
import { buildScene } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { readEntities } from "../vmf/edit.js";
import type { Vec3 } from "../vmf/solid.js";
import { resolveInput } from "./paths.js";

const cache = new Map<string, { source: string; scene: Scene }>();

function sceneFor(path: string): { scene: Scene; source: string } {
  const source = readFileSync(path, "utf8");
  const hit = cache.get(path);
  if (hit && hit.source === source) return { scene: hit.scene, source };
  const scene = buildScene(path, source);
  cache.set(path, { source, scene });
  return { scene, source };
}

/** Spawn entities, which are the one point a map's author guaranteed is inside. */
function spawnsIn(source: string): Vec3[] {
  const { entities } = readEntities(source);
  const out: Vec3[] = [];
  for (const e of entities) {
    if (!/^info_(player_start|player_teamspawn|player_deathmatch|teleport_destination)$/.test(e.classname)) {
      continue;
    }
    const pair = e.block.entries.find((n) => n.kind === "pair" && n.key === "origin");
    if (!pair || pair.kind !== "pair") continue;
    const parts = pair.value.trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      out.push([parts[0]!, parts[1]!, parts[2]! + 16]);
    }
  }
  return out;
}

export const renderVmfPlanTool = defineTool({
  name: "render_vmf_plan",
  description:
    "A dimensioned floor plan of a .vmf: a horizontal cut taken above the floor, with room " +
    "outlines, floor areas, the width written on every doorway, a grid, a scale bar and a " +
    "north arrow. render_vmf_view says what a place looks like from somewhere; this says " +
    "WHERE things are, and it is the drawing you can measure with. Returns the picture to " +
    "look at and the SVG to keep, both from one description, so the two cannot disagree. " +
    "Anything entirely above or below the cut is not on the drawing -- a raised walkway, a " +
    "sunken pit -- so the cut height is always reported.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    cutZ: z
      .number()
      .optional()
      .describe("Height of the cut. Default: 48 units above the lowest floor a person can stand on."),
    width: z.number().int().min(120).max(2000).default(900),
    height: z.number().int().min(120).max(2000).default(900),
    grid: z.number().min(16).max(4096).default(512).describe("Grid spacing, and the scale bar's length."),
    rooms: z.boolean().default(true).describe("Outline rooms and dimension the doorways."),
    seeds: z.array(z.array(z.number()).length(3)).optional(),
    svg: z.boolean().default(false).describe("Also return the SVG text. It can be long."),
  },
  outputSchema: {
    path: z.string(),
    cutZ: z.number(),
    unitsPerPixel: z.number(),
    pageWidth: z.number(),
    pageHeight: z.number(),
    brushesCut: z.number(),
    sectionAreaUnits: z.number(),
    roomCount: z.number(),
    rooms: z.array(
      z.object({
        id: z.number(),
        floorAreaSquareMetres: z.number(),
        widestPoint: z.array(z.number()),
      }),
    ),
    portals: z.array(
      z.object({ between: z.array(z.number()), at: z.array(z.number()), approxWidthUnits: z.number() }),
    ),
    svg: z.string().nullable(),
    notes: z.array(z.string()),
    pngBytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene, source } = sceneFor(path);
    const seeds = (args.seeds as number[][] | undefined)?.map((p) => [p[0]!, p[1]!, p[2]!] as Vec3) ??
      spawnsIn(source);

    const notes: string[] = [];
    if (args.rooms && seeds.length === 0) {
      notes.push(
        "No spawn entity to flood from, so no rooms are outlined and no doorway is " +
          "dimensioned. Pass 'seeds' with a point inside the map to get them.",
      );
    }

    const plan = buildPlan(scene, seeds, {
      cutZ: args.cutZ,
      maxWidth: args.width,
      maxHeight: args.height,
      grid: args.grid,
      rooms: args.rooms,
    });

    const canvas = paint(plan.list);
    const png = encodePng(canvas.rgb, canvas.width, canvas.height);

    if (plan.brushesCut === 0) {
      notes.push(
        `Nothing was cut at z = ${Math.round(plan.cutZ)}: the plane passes through no brush ` +
          `at all. The map's own extents run from ${Math.round(scene.mins[2])} to ` +
          `${Math.round(scene.maxs[2])}; pass cutZ to choose a height.`,
      );
    }

    return {
      path,
      cutZ: plan.cutZ,
      unitsPerPixel: plan.list.page.unitsPerPixel,
      pageWidth: plan.list.page.width,
      pageHeight: plan.list.page.height,
      brushesCut: plan.brushesCut,
      sectionAreaUnits: Math.round(plan.sectionArea),
      roomCount: plan.rooms?.rooms.length ?? 0,
      rooms: (plan.rooms?.rooms ?? []).map((r) => ({
        id: r.id,
        floorAreaSquareMetres: r.floorAreaSquareMetres,
        widestPoint: [...r.centre],
      })),
      portals: (plan.rooms?.portals ?? []).map((p) => ({
        between: [...p.between],
        at: [...p.at],
        approxWidthUnits: p.approxWidthUnits,
      })),
      svg: args.svg ? toSvg(plan.list) : null,
      notes: [...notes, ...plan.notes, ...(plan.rooms?.notes ?? [])],
      pngBytes: png.length,
      [IMAGE_KEY]: { data: png.toString("base64"), mimeType: "image/png" },
    };
  },
});

export const planTools = [renderVmfPlanTool];
