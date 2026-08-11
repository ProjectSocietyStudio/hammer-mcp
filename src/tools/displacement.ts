import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { readDisplacements } from "../vmf/displacement.js";
import {
  paintDisplacements,
  sculptDisplacements,
  sewDisplacements,
  writeDisplacements,
} from "../vmf/dispwrite.js";
import type { FaceSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const faceSelectorFrom = (args: {
  solidIds?: number[];
  material?: string;
  facing?: "up" | "down" | "side" | "any";
  minArea?: number;
  all?: boolean;
}): FaceSelector => {
  // The same guard the face tools carry, and it was missing here -- on the one tool that
  // rewrites every eligible face of the map. An empty material is refused for the same
  // reason: the key being present satisfied the guard while matchesFace treated "" as
  // falsy and matched everything.
  if (args.material !== undefined && args.material.trim().length === 0) {
    throw new Error(
      "material is empty, which matches every face rather than none. Give a name, or pass " +
        "all:true if displacing the whole map is what was meant.",
    );
  }
  const sel: FaceSelector = {
    ...(args.solidIds !== undefined ? { solidIds: args.solidIds } : {}),
    ...(args.material !== undefined ? { material: args.material } : {}),
    ...(args.facing !== undefined ? { facing: args.facing } : {}),
    ...(args.minArea !== undefined ? { minArea: args.minArea } : {}),
  };
  if (Object.keys(sel).length === 0 && args.all !== true) {
    throw new Error(
      "this would put a displacement on every quadrilateral face in the map. Name solidIds, " +
        "a material, a facing or a minArea, or pass all:true to say you meant it.",
    );
  }
  return sel;
};

/** Refuses to write when a displacement edit moved a brush, which it never should. */
function assertGeometryUntouched(path: string, before: string, after: string): void {
  const b = checkVmfSolids(path, before);
  const a = checkVmfSolids(path, after);
  if (a.solidCount !== b.solidCount) {
    throw new Error(
      `refusing to write: a displacement edit changed the solid count from ${b.solidCount} ` +
        `to ${a.solidCount}. A displacement is drawn over a face; it does not move one.`,
    );
  }
  for (const x of b.solids) {
    if (x.id === null) continue;
    const y = a.solids.find((s) => s.id === x.id);
    if (!y || y.volume !== x.volume) {
      throw new Error(`refusing to write: solid ${x.id} changed shape. It never should.`);
    }
  }
}

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



const FACE_SELECTOR = {
  solidIds: z.array(z.number()).optional(),
  material: z.string().optional().describe("Faces carrying this. Substring, case-insensitive."),
  facing: z.enum(["up", "down", "side", "any"]).optional(),
  minArea: z.number().optional(),
};

export const writeDisplacementTool = defineTool({
  name: "write_displacement",
  description:
    "Creates displacements on selected faces: the vertex grids that make every piece of " +
    "terrain in Source. Power 2, 3 or 4, which are 5x5, 9x9 and 17x17 grids -- Source " +
    "accepts 0 and 1 and no terrain is built with them. Flat by default, which is what " +
    "Hammer's own create makes and what a mapper then sculpts. WARNING: a displacement " +
    "does not seal. vbsp builds the hull from the brush's own planes and draws the terrain " +
    "over it, so displacing a face of the map's shell leaks through a shape the terrain no " +
    "longer has, and the leak names a brush that looks solid in the editor. Refuses a face " +
    "that already carries one rather than discarding what was sculpted onto it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    power: z.number().int().min(2).max(4).describe("2, 3 or 4: a 5x5, 9x9 or 17x17 grid."),
    ...FACE_SELECTOR,
    all: z
      .boolean()
      .optional()
      .describe("Every quadrilateral face of the map. Required when nothing else narrows it."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    created: z.array(
      z.object({ solidId: z.number(), power: z.number(), vertices: z.number() }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = writeDisplacements(before, faceSelectorFrom(args), { power: args.power });
    assertGeometryUntouched(path, before, result.text);

    // The oracle: the reader has to find every grid this wrote, at the size it claims.
    const back = readDisplacements(result.text).displacements;
    for (const made of result.created) {
      const found = back.find((d) => d.solidId === made.solidId);
      if (!found || found.vertices.length !== made.vertices) {
        throw new Error(
          `refusing to write: the displacement on solid ${made.solidId} does not read back ` +
            `as the ${made.vertices}-vertex grid it was written as`,
        );
      }
      if (found.findings.length > 0) {
        throw new Error(`refusing to write: ${found.findings.join(" | ")}`);
      }
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      matched: result.matched,
      created: result.created.map((c) => ({
        solidId: c.solidId,
        power: c.power,
        vertices: c.vertices,
      })),
      warnings: result.warnings,
      nextStep:
        "Compile and read_leak if any of these brushes was part of the hull. A displaced " +
        "face does not seal, and the leak will name a brush that looks solid.",
    };
  },
});

export const sewDisplacementsTool = defineTool({
  name: "sew_displacements",
  description:
    "Pulls displacements back together along the edges they share. Two vertices belong " +
    "together when their undisplaced positions coincide -- the faces share that point " +
    "whatever either grid has since done to it -- and each group is moved to its average, " +
    "which is what Hammer's Sew does and what keeps a ridge from being dragged to one side " +
    "of the join. The check is exact: read_displacements must report no seam afterwards, " +
    "and it decides adjacency the same way, so it would find any pair this missed.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    tolerance: z
      .number()
      .positive()
      .optional()
      .describe(
        "How close two flat points must be to count as the same one. Default 0.1. Must be " +
          "positive: zero would group every vertex of the map into one.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verticesMoved: z.number(),
    worstGapBefore: z.number(),
    worstGapAfter: z.number(),
    seamsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = sewDisplacements(before, args.tolerance ?? 0.1);
    assertGeometryUntouched(path, before, result.text);

    const after = readDisplacements(result.text);
    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      verticesMoved: result.moved,
      worstGapBefore: result.worstBefore,
      worstGapAfter: result.worstAfter,
      seamsAfter: after.seams.length,
      warnings: result.warnings,
      nextStep:
        after.seams.length === 0
          ? "No seam is left. Whether the terrain looks right is still for the eye."
          : "Seams remain: two grids of different power, or normals that disagree. Neither " +
            "is something averaging can fix.",
    };
  },
});

export const sculptDisplacementTool = defineTool({
  name: "sculpt_displacement",
  description:
    "Reshapes displacements: flatten, raise, slope between two heights, or add noise. " +
    "Declarative shapes rather than a table of vertices, and noise takes a seed rather " +
    "than reaching for a random number generator -- a terrain that cannot be regenerated " +
    "from what produced it cannot be reviewed, cannot be tested and cannot survive a merge. " +
    "Sculpting one displacement of a terrain moves the edge it shares with its neighbours, " +
    "so the result says whether a seam opened and sew_displacements closes it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Displacements on these brushes."),
    shape: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("flatten") }),
      z.object({ kind: z.literal("raise"), by: z.number() }),
      z.object({
        kind: z.literal("slope"),
        from: z.number(),
        to: z.number(),
        along: z.enum(["x", "y"]),
      }),
      z.object({
        kind: z.literal("noise"),
        amplitude: z.number(),
        seed: z.number().int().describe("Same seed, same terrain, every time."),
      }),
    ]),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verticesMoved: z.number(),
    minDistance: z.number(),
    maxDistance: z.number(),
    seamsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = sculptDisplacements(
      before,
      args.solidIds ? { solidIds: args.solidIds } : {},
      args.shape as never,
    );
    assertGeometryUntouched(path, before, result.text);

    const after = readDisplacements(result.text);
    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      verticesMoved: result.moved,
      minDistance: result.minDistance,
      maxDistance: result.maxDistance,
      seamsAfter: after.seams.length,
      warnings: result.warnings,
      nextStep:
        after.seams.length > 0
          ? "Run sew_displacements: this opened the join with the neighbouring terrain."
          : "Nothing offline says whether a hillside looks like one. That part is the eye's.",
    };
  },
});

export const paintDisplacementTool = defineTool({
  name: "paint_displacement",
  description:
    "Paints the blend channel of displacements: uniform, by height, or by slope. A blend " +
    "material draws its second texture where alpha is 255 and its first where it is zero, " +
    "which is how a gravel path appears through grass. By height fades between two " +
    "elevations rather than stepping, because a shoreline that changes in one vertex is " +
    "not what anyone wants. Says so when the material has no blend in its name: alpha does " +
    "nothing on a material that is not a blend shader, and vbsp does not mention it.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional(),
    rule: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("uniform"), alpha: z.number().min(0).max(255) }),
      z.object({
        kind: z.literal("byHeight"),
        low: z.number().describe("Fully the first texture at or below this z."),
        high: z.number().describe("Fully the second at or above it."),
      }),
      z.object({
        kind: z.literal("bySlope"),
        degrees: z.number().describe("Anything steeper than this takes the second texture."),
      }),
    ]),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    verticesPainted: z.number(),
    minAlpha: z.number(),
    maxAlpha: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = paintDisplacements(
      before,
      args.solidIds ? { solidIds: args.solidIds } : {},
      args.rule as never,
    );
    assertGeometryUntouched(path, before, result.text);

    // Painting must not move anything: the shape and the blend are different channels.
    const was = readDisplacements(before).displacements;
    for (const d of readDisplacements(result.text).displacements) {
      const old = was.find((x) => x.solidId === d.solidId && x.sideIndex === d.sideIndex);
      if (old && (old.minDistance !== d.minDistance || old.maxDistance !== d.maxDistance)) {
        throw new Error(
          `refusing to write: painting solid ${d.solidId} changed its shape. It never should.`,
        );
      }
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      verticesPainted: result.painted,
      minAlpha: result.minAlpha,
      maxAlpha: result.maxAlpha,
      warnings: result.warnings,
      nextStep:
        "Compile with lighting and look. A blend is one of the things no offline check can " +
        "judge: the numbers are right or wrong, the boundary is beautiful or it is not.",
    };
  },
});

export const displacementTools = [
  readDisplacementsTool,
  writeDisplacementTool,
  sewDisplacementsTool,
  sculptDisplacementTool,
  paintDisplacementTool,
];
