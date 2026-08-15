import { readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { classify } from "../space/classify.js";
import { portalWidth } from "../space/measure.js";
import { buildScene } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { findRooms } from "../space/rooms.js";
import { voxelise } from "../space/voxel.js";
import type { VoxelGrid } from "../space/voxel.js";
import { readEntities } from "../vmf/edit.js";
import type { Vec3 } from "../vmf/solid.js";
import { resolveInput } from "./paths.js";

/** How far a spawn entity's origin is lifted to find the air above the floor it sits on. */
const SPAWN_LIFT = 16;

const cache = new Map<string, { source: string; scene: Scene }>();

function sceneFor(path: string): { scene: Scene; source: string } {
  const source = readFileSync(path, "utf8");
  const hit = cache.get(path);
  if (hit && hit.source === source) return { scene: hit.scene, source };
  const scene = buildScene(path, source);
  cache.set(path, { source, scene });
  return { scene, source };
}

/**
 * Where to start a flood.
 *
 * `info_player_start` is the one point a map's author has guaranteed is inside: a map that
 * spawns players in the void does not work at all, so this is not a guess. Falling back to
 * the middle of the map's own bounds is a guess, and it is reported as one.
 *
 * Exported because `render_vmf_tour` floods the same space to decide where to stand, and two
 * ways of finding a spawn are two ways of disagreeing about where a map begins.
 */
export function seedsFor(source: string, scene: Scene, given?: number[][]): { seeds: Vec3[]; note: string | null } {
  if (given && given.length > 0) {
    return { seeds: given.map((p) => [p[0]!, p[1]!, p[2]!] as Vec3), note: null };
  }
  const { entities } = readEntities(source);
  const spawns: Vec3[] = [];
  for (const e of entities) {
    if (!/^info_(player_start|player_teamspawn|player_deathmatch|teleport_destination)$/.test(e.classname)) {
      continue;
    }
    const pair = e.block.entries.find((n) => n.kind === "pair" && n.key === "origin");
    if (!pair || pair.kind !== "pair") continue;
    const parts = pair.value.trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      // Lifted clear of the floor the entity is usually sitting on.
      spawns.push([parts[0]!, parts[1]!, parts[2]! + SPAWN_LIFT]);
    }
  }
  if (spawns.length > 0) {
    // Said rather than done quietly. The lift is right -- a spawn sits on the floor and
    // the flood needs a point in the air above it -- but the output reported the moved
    // point as though it were the given one, so a reader comparing the two saw a number
    // they did not write and no reason for it. On a map with a low mezzanine that 16 units
    // is the difference between seeding the space you meant and the one above it
    // (issue #58).
    return {
      seeds: spawns,
      note:
        `Flooded from ${spawns.length} spawn entit${spawns.length === 1 ? "y" : "ies"}, each ` +
        `lifted ${SPAWN_LIFT} units above its origin: a spawn sits on the floor and the ` +
        `flood needs a point in the air. Pass 'seeds' to place them yourself.`,
    };
  }

  const middle: Vec3 = [
    (scene.mins[0] + scene.maxs[0]) / 2,
    (scene.mins[1] + scene.maxs[1]) / 2,
    (scene.mins[2] + scene.maxs[2]) / 2,
  ];
  return {
    seeds: [middle],
    note:
      `No spawn entity to start from, so the flood began at the middle of the map's own ` +
      `extents. If that point is outside the sealed part, everything below describes the ` +
      "void instead. Pass 'seeds' to say where inside is.",
  };
}

const commonInput = {
  path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
  seeds: z
    .array(z.array(z.number()).length(3))
    .optional()
    .describe("Points known to be inside. Default: every spawn entity in the map."),
  step: z
    .number()
    .int()
    .min(4)
    .max(128)
    .default(16)
    .describe(
      "Cell size in units. 16 is the coarsest that resolves a 32-unit doorway. Halving it " +
        "multiplies the cell count by eight.",
    ),
  maxCells: z.number().int().min(1000).max(64_000_000).default(4_000_000),
};

/**
 * Faces whose normal is not one of the six axes.
 *
 * The predicate behind #91's caveat. A map of boxes has none, and at a 16-unit grid it cannot
 * hide a gap from the flood; every curve, wedge and splay has some, and two of them meeting at
 * a shallow angle leave a sliver of any width you like.
 */
function countSkewFaces(scene: Scene): number {
  let skew = 0;
  for (const brush of scene.brushes) {
    for (const face of brush.faces) {
      const n = face.plane.normal;
      const axial =
        Math.abs(Math.abs(n[0]) - 1) < 1e-6 ||
        Math.abs(Math.abs(n[1]) - 1) < 1e-6 ||
        Math.abs(Math.abs(n[2]) - 1) < 1e-6;
      if (!axial) skew += 1;
    }
  }
  return skew;
}

function gridFor(path: string, args: { seeds?: number[][]; step: number; maxCells: number }): {
  scene: Scene;
  grid: VoxelGrid;
  seedNote: string | null;
} {
  const { scene, source } = sceneFor(path);
  const { seeds, note } = seedsFor(source, scene, args.seeds);
  const grid = voxelise(scene, seeds, { step: args.step, maxCells: args.maxCells });
  return { scene, grid, seedNote: note };
}

export const readVmfLeakTool = defineTool({
  name: "read_vmf_leak",
  description:
    "Whether a .vmf is sealed, WITHOUT compiling it. Today the only thing that can answer " +
    "is vbsp, which costs a toolchain and minutes, and which refuses to run vvis afterwards. " +
    "This floods the open space from a point inside -- a spawn entity, by default -- and " +
    "reports where the flood got out, with the path to follow, the same shape as the .lin " +
    "pointfile. A wall thinner than the cell size is not resolved, so this can miss a leak; " +
    "it does not invent one, because a cell counts as free only when its whole interior is.",
  realm: "map",
  inputSchema: commonInput,
  outputSchema: {
    path: z.string(),
    sealed: z.boolean(),
    leakPath: z.array(z.array(z.number())),
    escapedAt: z.array(z.number()).nullable(),
    step: z.number(),
    cells: z.array(z.number()),
    openCellCount: z.number(),
    openVolumeUnits: z.number(),
    seeds: z.array(z.array(z.number())),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene, grid, seedNote } = gridFor(path, args);
    const notes = [...grid.notes];
    if (seedNote) notes.unshift(seedNote);

    const sealed = !grid.leaked && grid.reachedCount > 0;

    // A sealed verdict is not equally strong on every map, and until #91 it read as though it
    // were. This method loses a gap narrower than a cell rather than inventing one -- the
    // right trade, and unchanged. But on an axis-aligned map at this grid a wall thinner than
    // a cell is close to impossible, while a curve meeting a flat surface produces one
    // immediately: `hmcp_rotunda` came back sealed and vbsp said leaked, at a lens a few units
    // wide where the rotunda's arc met the vestibule's wall. Nothing in the reply distinguished
    // the two situations, and the caller has no reason to suspect the second.
    if (sealed) {
      const skew = countSkewFaces(scene);
      if (skew > 0) {
        notes.push(
          `${skew} face(s) here are not axis-aligned. Two of them meeting at a shallow angle ` +
            `leave a gap narrower than one ${grid.step}-unit cell, which this flood loses ` +
            `rather than invents -- so a sealed verdict is weaker here than on a map of ` +
            `boxes. run_compile and read_leak are the second answer, by a different method.`,
        );
      }
    }

    return {
      path,
      sealed,
      leakPath: grid.leakPath.map((p) => [...p]),
      escapedAt: grid.leaked ? [...grid.leakPath[grid.leakPath.length - 1]!] : null,
      step: grid.step,
      cells: [...grid.dims],
      openCellCount: grid.reachedCount,
      openVolumeUnits: grid.reachedCount * grid.step ** 3,
      seeds: grid.seeds.map((p) => [...p]),
      notes,
    };
  },
});

export const readVmfRoomsTool = defineTool({
  name: "read_vmf_rooms",
  description:
    "The rooms of a .vmf, the openings between them, and how they connect -- from the " +
    "geometry alone, with no compilation and no annotation in the file. Rooms come from a " +
    "watershed on the clearance field, NOT from connected components: a sealed map has " +
    "exactly one of those. This is a heuristic and it says so, with the parameters that " +
    "produced it; it can split a hall with a pillar in it and swallow an alcove. Widths are " +
    "voxel estimates to within a cell. Use it to ask what a place IS -- how many rooms, how " +
    "wide the doors, what connects to what -- rather than what is at a coordinate.",
  realm: "map",
  inputSchema: {
    ...commonInput,
    mergeLimit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(20)
      .describe("How many merges to report, newest first-hit last. mergeCount stays exact."),
    minRoomArea: z
      .number()
      .min(0)
      .default(4096)
      .describe("Below this floor area, in square units, a region is merged into its largest neighbour."),
  },
  outputSchema: {
    path: z.string(),
    sealed: z.boolean(),
    roomCount: z.number(),
    rooms: z.array(
      z.object({
        id: z.number(),
        floorAreaUnits: z.number(),
        floorAreaSquareMetres: z.number(),
        widestPoint: z.array(z.number()),
        halfWidthUnits: z.number(),
        mins: z.array(z.number()),
        maxs: z.array(z.number()),
        connectsTo: z.array(z.number()),
      }),
    ),
    /**
     * Standable regions no walk reaches from a spawn: a counter top, a ledge, a roof.
     *
     * Apart from `rooms` rather than dropped, because they are real space -- but a rule
     * about headroom or floor area is about a place a person can be, and a counter top
     * fails every such rule by construction rather than by fault.
     */
    unreachable: z.array(
      z.object({
        id: z.number(),
        floorAreaUnits: z.number(),
        floorAreaSquareMetres: z.number(),
        widestPoint: z.array(z.number()),
        halfWidthUnits: z.number(),
        mins: z.array(z.number()),
        maxs: z.array(z.number()),
      }),
    ),
    portals: z.array(
      z.object({
        between: z.array(z.number()),
        at: z.array(z.number()),
        approxWidthUnits: z.number(),
        approxHeightUnits: z.number(),
        /**
         * The doorway's width, measured -- not estimated.
         *
         * `approxWidthUnits` counts cells, so it can only ever be a multiple of `step`, and
         * it rounds **down**: a cell is free only when its whole interior is. A doorway built
         * 80 wide reports 64 at step 16, and a builder that widened a door to 80 to satisfy a
         * rule asking for 64 was following the tool rather than the brief (issue #61).
         *
         * This is the swept player hull at the same col, which is exact. Null when no body
         * fits there at all -- the same answer `measure_vmf_clearance` gives, for the same
         * reason: a number would be read as a measurement.
         */
        widthUnits: z.number().nullable(),
      }),
    ),
    /**
     * Every merge the pass made, newest last, and why.
     *
     * Rooms are what is left after merging, so a room count that surprises you is a merge
     * you cannot see. Before this, working out why two obvious rooms read as one meant
     * reading `src/space/rooms.ts` -- which an ordinary caller of this server cannot do.
     */
    merges: z.array(
      z.object({
        /** Internal: the region is gone, so no reported room carries this id. */
        absorbed: z.number(),
        /** A `rooms` or `unreachable` id, always. */
        into: z.number(),
        reason: z.string(),
        at: z.array(z.number()).nullable(),
        measured: z.number(),
        bar: z.number(),
        /**
         * The doorway this merge stopped reporting, if it closed one.
         *
         * The question a caller actually asks after a room count changes -- and the one
         * nothing answered until now, which cost a builder five `step` calls and four
         * delete-and-recheck cycles on a shelf 200 units from the doorway it killed.
         */
        closed: z
          .object({ at: z.array(z.number()), approxWidthUnits: z.number() })
          .nullable(),
        why: z.string(),
      }),
    ),
    mergeCount: z.number(),
    method: z.string(),
    parameters: z.record(z.string(), z.number()),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene, grid, seedNote } = gridFor(path, args);
    const result = findRooms(grid, { minRoomArea: args.minRoomArea });

    // The voxel localises, the swept hull measures -- the rule the whole of
    // `src/space/measure.ts` is built on, and the half a portal was missing. The scene is
    // here already; `findRooms` never sees it, which is why this is done at the wrapper
    // rather than inside the pass.
    const portalWidths = result.portals.map((p) => portalWidth(scene, p.at));

    const notes = [...grid.notes, ...result.notes];
    if (seedNote) notes.unshift(seedNote);
    if (grid.leaked) {
      notes.unshift(
        `This map is not sealed, so the flood also filled the outside and the rooms below ` +
          `may include it. read_vmf_leak has the path out.`,
      );
    }

    return {
      path,
      sealed: !grid.leaked && grid.reachedCount > 0,
      roomCount: result.rooms.length,
      rooms: result.rooms.map((r) => ({
        id: r.id,
        floorAreaUnits: r.floorArea,
        floorAreaSquareMetres: r.floorAreaSquareMetres,
        widestPoint: [...r.centre],
        halfWidthUnits: r.maxClearance,
        mins: [...r.mins],
        maxs: [...r.maxs],
        connectsTo: r.neighbours,
      })),
      unreachable: result.unreachable.map((r) => ({
        id: r.id,
        floorAreaUnits: r.floorArea,
        floorAreaSquareMetres: r.floorAreaSquareMetres,
        widestPoint: [...r.centre],
        halfWidthUnits: r.maxClearance,
        mins: [...r.mins],
        maxs: [...r.maxs],
      })),
      portals: result.portals.map((p, i) => ({
        between: [...p.between],
        at: [...p.at],
        approxWidthUnits: p.approxWidthUnits,
        approxHeightUnits: p.approxHeightUnits,
        widthUnits:
          portalWidths[i] === null || portalWidths[i] === undefined
            ? null
            : Math.round(portalWidths[i]! * 1000) / 1000,
      })),
      // Newest last, and capped: a large map merges hundreds of offcuts and the tail of
      // that list is noise. `mergeCount` stays exact so a truncated list never reads as a
      // short one.
      merges: result.merges.slice(-args.mergeLimit).map((m) => ({
        absorbed: m.absorbed,
        into: m.into,
        reason: m.reason,
        at: m.at ? [...m.at] : null,
        measured: m.measured,
        bar: m.bar,
        closed: m.closed
          ? { at: [...m.closed.at], approxWidthUnits: m.closed.approxWidthUnits }
          : null,
        why:
          m.reason === "not-a-constriction"
            ? `region ${m.absorbed} was merged into room ${m.into}: the opening between them ` +
              `is ${m.measured} units where the narrower of the two spaces is ${m.bar}, so it ` +
              `narrows nothing and they are one space.` +
              (m.closed
                ? ` A doorway about ${m.closed.approxWidthUnits} units wide at ` +
                  `[${m.closed.at.map((n) => Math.round(n)).join(", ")}] is what stopped ` +
                  `being reported because of it.`
                : ``)
            : `region ${m.absorbed} was merged into room ${m.into}: ${m.measured} square units is ` +
              `below the ${m.bar} an offcut has to clear to count as a room. Raise ` +
              `minRoomArea to keep it, or lower it to ${m.measured} to see it separately.`,
      })),
      mergeCount: result.merges.length,
      method: result.method,
      parameters: result.parameters,
      notes,
    };
  },
});

export const readVmfSurfacesTool = defineTool({
  name: "read_vmf_surfaces",
  description:
    "Every face of a .vmf sorted into floor, wall, ceiling and slope, with how much of each " +
    "a person could actually touch -- and which brush touches which. A map is boxes pushed " +
    "against each other, so most of what a .vmf contains is buried: the underside of every " +
    "slab, the back of every wall. Counting those doubles a building's floor area in a " +
    "number that reads perfectly ordinary. Exposure is measured by probing along each face's " +
    "own normal. Note that 'exposed' means open space in front, which includes the outside " +
    "of the map: a ceiling slab's upper face is the roof.",
  realm: "map",
  inputSchema: {
    path: z.string(),
    kind: z.enum(["floor", "ceiling", "wall", "slope", "any"]).default("any"),
    material: z.string().optional().describe("Only faces whose material contains this."),
    exposedOnly: z.boolean().default(true),
    limit: z.number().int().min(1).max(500).default(50),
  },
  outputSchema: {
    path: z.string(),
    faceCount: z.number(),
    buriedCount: z.number(),
    exposedAreaByKind: z.record(z.string(), z.number()),
    exposedAreaSquareMetresByKind: z.record(z.string(), z.number()),
    matched: z.number(),
    faces: z.array(
      z.object({
        brushId: z.number(),
        sideId: z.number().nullable(),
        kind: z.string(),
        material: z.string(),
        areaUnits: z.number(),
        exposure: z.number(),
        centre: z.array(z.number()),
      }),
    ),
    touchingBrushes: z.record(z.string(), z.array(z.number())),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const { scene } = sceneFor(path);
    const c = classify(scene);

    const wanted = c.faces.filter((f) => {
      if (args.exposedOnly && !f.exposed) return false;
      if (args.kind !== "any" && f.kind !== args.kind) return false;
      if (args.material && !f.material.toLowerCase().includes(args.material.toLowerCase())) {
        return false;
      }
      return true;
    });

    const bySquareMetres: Record<string, number> = {};
    for (const [kind, area] of Object.entries(c.areaByKind)) {
      bySquareMetres[kind] = Math.round(area * 0.0254 * 0.0254 * 100) / 100;
    }

    const touching: Record<string, number[]> = {};
    for (const [id, set] of c.adjacency) touching[String(id)] = [...set].sort((a, b) => a - b);

    return {
      path,
      faceCount: c.faces.length,
      buriedCount: c.buriedCount,
      exposedAreaByKind: c.areaByKind,
      exposedAreaSquareMetresByKind: bySquareMetres,
      matched: wanted.length,
      faces: wanted
        .sort((a, b) => b.area - a.area)
        .slice(0, args.limit)
        .map((f) => ({
          brushId: f.brushId,
          sideId: f.sideId,
          kind: f.kind,
          material: f.material,
          areaUnits: Math.round(f.area * 100) / 100,
          exposure: f.exposure,
          centre: [...f.centre],
        })),
      touchingBrushes: touching,
      notes: [
        `"Exposed" means open space in front of the face, which includes the outside of the ` +
          `map: a ceiling slab's upper face is an exposed floor, because it is the roof. ` +
          `read_vmf_rooms is what decides which surfaces are inside the playable space.`,
      ],
    };
  },
});

export const sceneTools = [readVmfLeakTool, readVmfRoomsTool, readVmfSurfacesTool];
