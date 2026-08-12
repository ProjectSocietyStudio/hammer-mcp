import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import {
  clearanceInFront,
  headroom,
  HULL_CROUCHING,
  HULL_STANDING,
  narrowestWidth,
  widthAcross,
} from "../space/measure.js";
import { findRooms } from "../space/rooms.js";
import { buildScene, MASK_PLAYER, MASK_SIGHT, MASK_SOLID } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { traceRay } from "../space/trace.js";
import { voxelise } from "../space/voxel.js";
import { readEntities } from "../vmf/edit.js";
import type { VmfEntity } from "../vmf/edit.js";
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

const HULLS = { standing: HULL_STANDING, crouching: HULL_CROUCHING } as const;

const hullArg = z
  .enum(["standing", "crouching"])
  .default("standing")
  .describe("Source's own player hulls: 32x32x72 standing, 32x32x36 crouching.");

const round = (n: number): number => Math.round(n * 1000) / 1000;
const metres = (n: number): number => Math.round(n * 0.0254 * 1000) / 1000;

function keyOf(e: VmfEntity, key: string): string | null {
  const pair = e.block.entries.find((n) => n.kind === "pair" && n.key === key);
  return pair && pair.kind === "pair" ? pair.value : null;
}

function originOf(e: VmfEntity): Vec3 | null {
  const raw = keyOf(e, "origin");
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0]!, parts[1]!, parts[2]!]
    : null;
}

function yawOf(e: VmfEntity): number {
  const raw = keyOf(e, "angles");
  if (!raw) return 0;
  const parts = raw.trim().split(/\s+/).map(Number);
  // Source writes pitch yaw roll.
  return parts.length === 3 && Number.isFinite(parts[1]) ? parts[1]! : 0;
}

export const measureVmfClearanceTool = defineTool({
  name: "measure_vmf_clearance",
  description:
    "How much room there actually is at a point in a .vmf: the free width across, the " +
    "headroom, and what stops each measurement. Measured with a swept player hull rather " +
    "than a ray, because that is the question -- a line passes a 24-unit gap that nobody " +
    "fits through, and reports it as clear. The narrowest direction is found rather than " +
    "assumed, since a corridor is wide one way and long the other, and a diagonal alley is " +
    "narrow diagonally. Every number names the brush that bounded it.",
  realm: "map",
  inputSchema: {
    path: z.string(),
    at: z.array(z.number()).length(3).describe("Where to measure, in Hammer units."),
    axis: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Measure across this direction only. Omit to search for the narrowest."),
    hull: hullArg,
    mask: z
      .enum(["solid", "player"])
      .default("player")
      .describe("`player` counts clip brushes, which are invisible and stop people."),
  },
  outputSchema: {
    path: z.string(),
    at: z.array(z.number()),
    widthUnits: z.number(),
    widthMetres: z.number(),
    narrowestAxis: z.array(z.number()),
    boundedBy: z.array(
      z.object({
        brushId: z.number().nullable(),
        material: z.string().nullable(),
        distanceUnits: z.number(),
        unbounded: z.boolean(),
      }),
    ),
    headroomUnits: z.number(),
    headroomMetres: z.number(),
    floorZ: z.number().nullable(),
    ceilingBrushId: z.number().nullable(),
    headroomUnbounded: z.boolean(),
    insideSolid: z.boolean(),
    hull: z.string(),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene } = sceneFor(path);
    const at = args.at as unknown as Vec3;
    const half = HULLS[args.hull];
    const mask = args.mask === "player" ? MASK_PLAYER : MASK_SOLID;

    const insideSolid = traceRay(scene, at, at, mask).startSolid;
    const width = args.axis
      ? widthAcross(scene, at, args.axis as unknown as Vec3, half, mask)
      : narrowestWidth(scene, at, half, mask);
    const head = headroom(scene, at, MASK_SOLID);

    const notes: string[] = [];
    if (insideSolid) {
      notes.push(
        "The point is inside a brush, so every width below is zero for a reason that has " +
          "nothing to do with the room. read_vmf_nearest_surface says how far the nearest " +
          "open space is.",
      );
    }
    if (width.sides.some((s) => s.unbounded)) {
      notes.push(
        "One side found nothing within reach: the width below is a lower bound, not a " +
          "measurement. That is the normal answer outdoors.",
      );
    }
    notes.push(
      `Measured with the ${args.hull} hull, ${half[0] * 2}x${half[1] * 2}x${half[2] * 2}. ` +
        `A ray would report more, and would be answering a different question.`,
    );

    return {
      path,
      at: [...at],
      widthUnits: round(width.widthUnits),
      widthMetres: metres(width.widthUnits),
      narrowestAxis: width.axis.map(round),
      boundedBy: width.sides.map((s) => ({
        brushId: s.brushId,
        material: s.material,
        distanceUnits: round(s.distance),
        unbounded: s.unbounded,
      })),
      headroomUnits: round(head.heightUnits),
      headroomMetres: metres(head.heightUnits),
      floorZ: head.floorZ === null ? null : round(head.floorZ),
      ceilingBrushId: head.ceilingBrushId,
      headroomUnbounded: head.unbounded,
      insideSolid,
      hull: args.hull,
      notes,
    };
  },
});

export const measureVmfApproachTool = defineTool({
  name: "measure_vmf_approach",
  description:
    "How much clear room a person has in front of the entities of a .vmf -- doors, buttons, " +
    "vending machines, anything with an origin and a yaw. The classic fault it finds is a " +
    "door that opens into a wall, or a button behind a crate, neither of which any compiler " +
    "mentions. It does NOT say whether a door can swing: a leaf's width lives in a model " +
    "this server cannot open offline, and the hull it assumed is reported rather than " +
    "quietly folded into the answer.",
  realm: "map",
  inputSchema: {
    path: z.string(),
    classname: z.string().optional().describe("Only entities whose classname contains this."),
    targetname: z.string().optional(),
    hull: hullArg,
    minClearUnits: z
      .number()
      .default(0)
      .describe("Report only entities with less than this in front. 0 reports all of them."),
    limit: z.number().int().min(1).max(500).default(50),
  },
  outputSchema: {
    path: z.string(),
    matched: z.number(),
    reported: z.number(),
    entities: z.array(
      z.object({
        id: z.number().nullable(),
        classname: z.string(),
        targetname: z.string().nullable(),
        origin: z.array(z.number()),
        yaw: z.number(),
        clearUnits: z.number(),
        clearMetres: z.number(),
        blockedByBrushId: z.number().nullable(),
        blockedByMaterial: z.string().nullable(),
      }),
    ),
    assumedHull: z.array(z.number()),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene, source } = sceneFor(path);
    const half = HULLS[args.hull];
    const { entities } = readEntities(source);

    const wanted = entities.filter((e) => {
      if (args.classname && !e.classname.toLowerCase().includes(args.classname.toLowerCase())) {
        return false;
      }
      if (
        args.targetname &&
        !(e.targetname ?? "").toLowerCase().includes(args.targetname.toLowerCase())
      ) {
        return false;
      }
      return originOf(e) !== null;
    });

    const rows = wanted
      .map((e) => {
        const origin = originOf(e)!;
        const yaw = yawOf(e);
        const a = clearanceInFront(scene, origin, yaw, half, MASK_PLAYER);
        return {
          id: e.id,
          classname: e.classname,
          targetname: e.targetname,
          origin: [...origin],
          yaw,
          clearUnits: round(a.clearUnits),
          clearMetres: metres(a.clearUnits),
          blockedByBrushId: a.blockedBy?.brushId ?? null,
          blockedByMaterial: a.blockedBy?.material ?? null,
        };
      })
      .filter((r) => args.minClearUnits === 0 || r.clearUnits < args.minClearUnits)
      .sort((a, b) => a.clearUnits - b.clearUnits);

    return {
      path,
      matched: wanted.length,
      reported: Math.min(rows.length, args.limit),
      entities: rows.slice(0, args.limit),
      assumedHull: [half[0] * 2, half[1] * 2, half[2] * 2],
      notes: [
        `Measured from each origin, lifted to standing height above the floor beneath it, ` +
          `then swept along its yaw. An entity with no angles is treated as facing +x.`,
        `This does not say whether a door can swing: a leaf's width is in a model, not in ` +
          `the .vmf. It says how much room a person has in front of the thing, which is the ` +
          `measurement that decides whether a doorway is usable.`,
      ],
    };
  },
});

export const readVmfSightlinesTool = defineTool({
  name: "read_vmf_sightlines",
  description:
    "The longest clear lines of sight in an UNCOMPILED .vmf, sampled from the places a " +
    "person can actually stand. read_sightlines answers the same question on a compiled " +
    "map by sampling ground in a column, which picks up roofs and the spawn room under the " +
    "map; this samples the standable cells the room pass found, which is a stronger " +
    "constraint and needs no vbsp. Long sight lines are what a mapper trades away for " +
    "framerate, so the number is a design decision rather than a fault.",
  realm: "map",
  inputSchema: {
    path: z.string(),
    seeds: z.array(z.array(z.number()).length(3)).optional(),
    step: z.number().int().min(8).max(128).default(16),
    eyeHeight: z.number().min(0).max(256).default(64),
    spacing: z
      .number()
      .int()
      .min(1)
      .max(64)
      .default(8)
      .describe("Take one sample cell in this many, per axis. Pairs cost the square of this."),
    limit: z.number().int().min(1).max(50).default(5),
    maxCells: z.number().int().min(1000).max(64_000_000).default(4_000_000),
  },
  outputSchema: {
    path: z.string(),
    samplePoints: z.number(),
    pairsTested: z.number(),
    longest: z.array(
      z.object({
        units: z.number(),
        metres: z.number(),
        from: z.array(z.number()),
        to: z.array(z.number()),
      }),
    ),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene, source } = sceneFor(path);

    let seeds = (args.seeds as number[][] | undefined)?.map((p) => [p[0]!, p[1]!, p[2]!] as Vec3);
    if (!seeds || seeds.length === 0) {
      const { entities } = readEntities(source);
      seeds = entities
        .filter((e) => /^info_player_(start|teamspawn|deathmatch)$/.test(e.classname))
        .map(originOf)
        .filter((p): p is Vec3 => p !== null)
        .map((p) => [p[0], p[1], p[2] + 16] as Vec3);
    }
    const notes: string[] = [];
    if (seeds.length === 0) {
      return {
        path,
        samplePoints: 0,
        pairsTested: 0,
        longest: [],
        notes: [
          "No spawn entity to flood from, so there are no standable cells to sample. Pass " +
            "'seeds' with a point inside the map.",
        ],
      };
    }

    const grid = voxelise(scene, seeds, { step: args.step, maxCells: args.maxCells });
    const rooms = findRooms(grid);

    // Every nth standable cell, so the pair count stays quadratic in something small. The
    // sampling is declared, because a longest line found among 200 points is not the same
    // claim as one found among 20000.
    const points: Vec3[] = [];
    let index = 0;
    for (let z = 0; z < grid.dims[2]; z++) {
      for (let y = 0; y < grid.dims[1]; y++) {
        for (let x = 0; x < grid.dims[0]; x++) {
          const at = (z * grid.dims[1] + y) * grid.dims[0] + x;
          if (grid.standable[at] !== 1) continue;
          if (index++ % args.spacing !== 0) continue;
          points.push([
            grid.origin[0] + x * grid.step,
            grid.origin[1] + y * grid.step,
            grid.origin[2] + z * grid.step + args.eyeHeight,
          ]);
        }
      }
    }

    const found: Array<{ units: number; from: Vec3; to: Vec3 }> = [];
    let pairs = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i]!;
        const b = points[j]!;
        const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        // Cheap rejection first: a pair nearer than the shortest kept line cannot win.
        if (found.length >= args.limit && d <= found[found.length - 1]!.units) continue;
        pairs += 1;
        if (traceRay(scene, a, b, MASK_SIGHT).hit) continue;
        found.push({ units: d, from: a, to: b });
        found.sort((p, q) => q.units - p.units);
        if (found.length > args.limit) found.length = args.limit;
      }
    }

    if (grid.leaked) {
      notes.push(
        "This map is not sealed, so the flood also filled the outside and some sample " +
          "points are out there. read_vmf_leak has the path out.",
      );
    }
    notes.push(
      `${points.length} sample points, one standable cell in ${args.spacing}. A longest ` +
        `line found among this many is a different claim from one found among all of them; ` +
        `lower 'spacing' to widen the search.`,
      `Brush entities are included and props are not: a closed door blocks, a parked car ` +
        `does not. ${rooms.rooms.length} room(s) were found on the way.`,
    );

    return {
      path,
      samplePoints: points.length,
      pairsTested: pairs,
      longest: found.map((f) => ({
        units: round(f.units),
        metres: metres(f.units),
        from: [...f.from],
        to: [...f.to],
      })),
      notes,
    };
  },
});

export const measureTools2 = [
  measureVmfClearanceTool,
  measureVmfApproachTool,
  readVmfSightlinesTool,
];
