/**
 * A dimensioned floor plan of a `.vmf`.
 *
 * The perspective view says what a place looks like from somewhere. A plan says where things
 * are, and it is the drawing you can measure with. Both are wanted, and neither replaces the
 * other: an agent that has only the perspective is back to judging by eye, which is what the
 * whole stack exists to stop.
 *
 * ## The section, and why there is no second hull routine
 *
 * A plan is a horizontal cut, drawn at eye-of-a-crouching-person height so that doorways read
 * as gaps and desks read as obstacles. A brush's section at `z = k` is the intersection of its
 * half-spaces with two more: `z <= k` and `z >= k`. So the section is just `hullFromPlanes`
 * again, with two planes added -- the same routine `read_vmf_solids` is checked by, rather
 * than a polygon clipper written for this file and wrong in some other way.
 *
 * ## What a plan has to carry to be a plan
 *
 * A scale, a grid, a north arrow, and **numbers on the openings**. A drawing without a scale
 * is a picture: you can see that a doorway is narrower than a corridor and you cannot say by
 * how much, which is exactly the question. So every portal gets its width written on it.
 */
import { classify } from "../space/classify.js";
import { portalWidth } from "../space/measure.js";
import { findRooms } from "../space/rooms.js";
import type { RoomsResult } from "../space/rooms.js";
import type { Scene } from "../space/scene.js";
import { voxelise } from "../space/voxel.js";
import type { VoxelGrid } from "../space/voxel.js";
import { hullFromPlanes, orderedLoop } from "../vmf/solid.js";
import type { Plane, Vec3 } from "../vmf/solid.js";
import { fitPage, labelBox, boxesOverlap } from "./display.js";
import type { DisplayList, Item, Label, Polygon, Rgb } from "./display.js";
import { colourFor } from "./raster.js";

/** Height above the lowest standable floor at which the cut is taken. */
export const DEFAULT_CUT_HEIGHT = 48;

const INK: Rgb = [24, 28, 36];
const PAPER: Rgb = [248, 247, 244];
const GRID: Rgb = [222, 220, 214];
const ROOM_INK: Rgb = [64, 96, 148];
const PORTAL_INK: Rgb = [176, 72, 48];

/** Materials whose brushes are drawn hatched rather than filled: you can see through them. */
const SEE_THROUGH = /glass|window|grate|fence|lattice/i;

export interface PlanOptions {
  cutZ?: number;
  maxWidth?: number;
  maxHeight?: number;
  margin?: number;
  /** Draw room outlines, areas and portal widths. Needs the voxel pass. */
  rooms?: boolean;
  grid?: number;
}

export interface PlanResult {
  list: DisplayList;
  cutZ: number;
  brushesCut: number;
  /** Sum of the section areas, in square world units: the invariant the tests use. */
  sectionArea: number;
  rooms: RoomsResult | null;
  notes: string[];
}

/**
 * The polygon a horizontal plane cuts out of a brush, in world coordinates.
 *
 * Null when the plane misses the brush or grazes it: a section of zero area is not a shape,
 * and drawing one puts a stray line across the plan at the height of every floor.
 */
export function sectionOf(planes: readonly Plane[], z: number): Vec3[] | null {
  const cut: Plane[] = [
    ...planes,
    { normal: [0, 0, 1], dist: z },
    { normal: [0, 0, -1], dist: -z },
  ];
  const hull = hullFromPlanes(cut);
  if (hull.length < 3) return null;
  const loop = orderedLoop(hull, [0, 0, 1]);
  return loop.length >= 3 ? loop : null;
}

/** Area of a closed loop in the xy plane, positive whichever way it is wound. */
export function areaOf(loop: readonly Vec3[]): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

/**
 * Where to cut.
 *
 * Above the floor by enough that a doorway is a gap rather than a threshold, and below the
 * top of a desk so furniture reads as an obstacle. Taken from the lowest standable cell the
 * flood found, rather than from the map's own minimum -- the map's minimum is usually the
 * bottom of the floor slab, and a cut there passes through solid everywhere.
 */
function cutHeightFor(grid: VoxelGrid | null, scene: Scene): number {
  if (grid) {
    let lowest = Infinity;
    for (let i = 0; i < grid.standable.length; i++) {
      if (grid.standable[i] !== 1) continue;
      const z = grid.origin[2] + Math.floor(i / (grid.dims[0] * grid.dims[1])) * grid.step;
      if (z < lowest) lowest = z;
    }
    if (Number.isFinite(lowest)) return lowest + DEFAULT_CUT_HEIGHT;
  }
  return scene.mins[2] + DEFAULT_CUT_HEIGHT;
}

export function buildPlan(scene: Scene, seeds: readonly Vec3[], options: PlanOptions = {}): PlanResult {
  const notes: string[] = [];
  const maxWidth = options.maxWidth ?? 1000;
  const maxHeight = options.maxHeight ?? 1000;
  const margin = options.margin ?? 28;

  let grid: VoxelGrid | null = null;
  let rooms: RoomsResult | null = null;
  if (options.rooms !== false && seeds.length > 0) {
    grid = voxelise(scene, seeds);
    rooms = findRooms(grid);
  }

  const cutZ = options.cutZ ?? cutHeightFor(grid, scene);

  const world = {
    minX: scene.mins[0],
    minY: scene.mins[1],
    maxX: scene.maxs[0],
    maxY: scene.maxs[1],
  };
  const { project, page } = fitPage(world, maxWidth, maxHeight, margin);
  const items: Item[] = [];

  // Paper first, so the SVG and the raster start from the same ground rather than one of
  // them relying on a background the other does not paint.
  items.push({
    kind: "polygon",
    points: [
      [0, 0],
      [page.width, 0],
      [page.width, page.height],
      [0, page.height],
    ],
    fill: PAPER,
    stroke: null,
    strokeWidth: 0,
    role: "paper",
  });

  const gridStep = options.grid ?? 512;
  for (let x = Math.ceil(world.minX / gridStep) * gridStep; x <= world.maxX; x += gridStep) {
    const [px] = project(x, world.minY);
    items.push({
      kind: "polyline",
      points: [
        [px, margin],
        [px, page.height - margin],
      ],
      stroke: GRID,
      strokeWidth: 1,
      role: "grid",
    });
  }
  for (let y = Math.ceil(world.minY / gridStep) * gridStep; y <= world.maxY; y += gridStep) {
    const [, py] = project(world.minX, y);
    items.push({
      kind: "polyline",
      points: [
        [margin, py],
        [page.width - margin, py],
      ],
      stroke: GRID,
      strokeWidth: 1,
      role: "grid",
    });
  }

  let sectionArea = 0;
  let brushesCut = 0;
  for (const brush of scene.brushes) {
    if (cutZ < brush.mins[2] || cutZ > brush.maxs[2]) continue;
    const loop = sectionOf(brush.planes, cutZ);
    if (!loop) continue;
    brushesCut += 1;
    sectionArea += areaOf(loop);

    const material = brush.faces[0]?.material ?? "";
    const tint = colourFor(material);
    items.push({
      kind: "polygon",
      points: loop.map((p) => project(p[0], p[1])),
      fill: [
        Math.round(tint[0] * 0.55),
        Math.round(tint[1] * 0.55),
        Math.round(tint[2] * 0.55),
      ],
      stroke: INK,
      strokeWidth: 1,
      role: `brush:${brush.id}`,
      hatch: SEE_THROUGH.test(material),
    } satisfies Polygon);
  }

  if (rooms) {
    for (const room of rooms.rooms) {
      const [cx, cy] = project(room.centre[0], room.centre[1]);
      const outline: Array<[number, number]> = [
        project(room.mins[0], room.mins[1]),
        project(room.maxs[0], room.mins[1]),
        project(room.maxs[0], room.maxs[1]),
        project(room.mins[0], room.maxs[1]),
      ];
      items.push({
        kind: "polygon",
        points: outline,
        fill: null,
        stroke: ROOM_INK,
        strokeWidth: 1,
        role: `room:${room.id}`,
      });
      items.push({
        kind: "label",
        at: [cx, cy],
        text: `${room.id}: ${room.floorAreaSquareMetres} m2`,
        size: 9,
        colour: ROOM_INK,
        anchor: "middle",
        role: `room-label:${room.id}`,
      });
    }

    for (const portal of rooms.portals) {
      const [px, py] = project(portal.at[0], portal.at[1]);
      const r = 4;
      items.push({
        kind: "polyline",
        points: [
          [px - r, py - r],
          [px + r, py + r],
        ],
        stroke: PORTAL_INK,
        strokeWidth: 2,
        role: `portal:${portal.between.join("-")}`,
      });
      // The measured width, not the cell count, because this label is what a reader takes
      // a decision from: a doorway built 80 wide is labelled 64 by the estimate (issue
      // #61). Falls back to the estimate only where no body fits at the col.
      const exact = portalWidth(scene, portal.at);
      items.push({
        kind: "label",
        at: [px, py - r - 2],
        text: `${exact ?? portal.approxWidthUnits}u`,
        size: 8,
        colour: PORTAL_INK,
        anchor: "middle",
        role: `portal-label:${portal.between.join("-")}`,
      });
    }
  }

  // North arrow. Hammer's +y is north, and the page's +y is down, so this is also the one
  // visible check that the flip in `fitPage` happened.
  const nx = page.width - margin / 2;
  const ny = margin;
  items.push({
    kind: "polyline",
    points: [
      [nx, ny + 16],
      [nx, ny],
      [nx - 4, ny + 5],
      [nx, ny],
      [nx + 4, ny + 5],
    ],
    stroke: INK,
    strokeWidth: 1,
    role: "north",
  });
  items.push({
    kind: "label",
    at: [nx, ny + 26],
    text: "N",
    size: 8,
    colour: INK,
    anchor: "middle",
    role: "north-label",
  });

  // Scale bar: a round number of units, drawn at its true length.
  const barUnits = gridStep;
  const barPixels = barUnits / page.unitsPerPixel;
  const bx = margin;
  const by = page.height - margin / 2;
  items.push({
    kind: "polyline",
    points: [
      [bx, by],
      [bx + barPixels, by],
    ],
    stroke: INK,
    strokeWidth: 2,
    role: "scale-bar",
  });
  items.push({
    kind: "label",
    at: [bx, by - 4],
    text: `${barUnits}u (${Math.round(barUnits * 0.0254 * 10) / 10} m)`,
    size: 8,
    colour: INK,
    anchor: "start",
    role: "scale-label",
  });

  // Legibility, checked rather than hoped for: a label a reader cannot separate from its
  // neighbour is not information. Overlapping ones are dropped, smallest room first, and the
  // drop is reported so the caller can ask for a bigger page instead.
  const labels = items.filter((i): i is Label => i.kind === "label");
  const kept: Label[] = [];
  const dropped: Label[] = [];
  for (const label of labels) {
    const box = labelBox(label);
    if (kept.some((other) => boxesOverlap(box, labelBox(other)))) dropped.push(label);
    else kept.push(label);
  }
  if (dropped.length > 0) {
    for (const label of dropped) items.splice(items.indexOf(label), 1);
    notes.push(
      `${dropped.length} label(s) were dropped because they overlapped another. Ask for a ` +
        `larger page, or a cut through fewer rooms, to see them all.`,
    );
  }

  notes.push(
    `Cut at z = ${Math.round(cutZ)}, which is ${DEFAULT_CUT_HEIGHT} units above the lowest ` +
      `floor a person can stand on. A doorway reads as a gap and a waist-high obstacle reads ` +
      `as solid; anything entirely above or below the cut is not on this drawing at all.`,
  );

  return {
    list: { page, items, world },
    cutZ,
    brushesCut,
    sectionArea,
    rooms,
    notes,
  };
}
