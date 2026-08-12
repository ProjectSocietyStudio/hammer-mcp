/**
 * Filling the map's open space with cells, and finding out whether it is sealed.
 *
 * Two things come out of one flood fill, and the second is worth the whole file: **a leak
 * check that needs no compiler**. Today the only way to learn that a map is not sealed is to
 * run vbsp and read `**** leaked ****`, which costs minutes and a toolchain. A flood from a
 * point inside the map either stays inside or it does not, and if it does not, the cell it
 * escaped through is the leak.
 *
 * ## Why 16 units, and 6-connected
 *
 * 16 is the coarsest grid that still resolves a 32-unit doorway, and it is a Hammer grid
 * size, so nothing lands between cells for reasons of arithmetic.
 *
 * The connectivity is 6 -- faces only, never edges or corners. A 26-connected flood walks
 * diagonally through the join between two brushes that merely touch, which is every corner
 * of every room, so it escapes any sealed map and reports a leak in all of them.
 *
 * ## A cell is free when its interior is free
 *
 * A cell is tested as a box slightly smaller than itself: half a unit in on each side. The
 * alternative, testing the closed cell, marks every cell resting exactly on a floor as solid
 * and loses the first sixteen units of every room -- including all the standing room in a
 * corridor whose ceiling is low.
 *
 * Testing the box rather than the centre point is the other half of it, and it is the
 * conservative direction on purpose: a wall thinner than the grid falls between two centres
 * and the flood walks straight through a sealed map. Over-blocking loses a little space and
 * can hide a real leak; under-blocking invents leaks in maps that are fine. Both are wrong,
 * and only one of them cries wolf, so the tool reports the resolution it used and says that
 * a wall thinner than the grid is not resolved.
 */
import { MASK_SOLID } from "./scene.js";
import type { Scene } from "./scene.js";
import { boxInSolid } from "./trace.js";
import type { Vec3 } from "../vmf/solid.js";

export const DEFAULT_STEP = 16;

/** 72 units of standing room, in cells, rounded up. */
const STANDING_CELLS = (step: number): number => Math.ceil(72 / step);

export interface VoxelOptions {
  step?: number;
  /** Refuse rather than truncate past this many cells. 4M is 4 MB of Uint8Array. */
  maxCells?: number;
  mask?: number;
}

export const FREE = 0;
export const SOLID = 1;
export const REACHED = 2;

export interface VoxelGrid {
  step: number;
  /** World position of the centre of cell (0, 0, 0). */
  origin: Vec3;
  dims: [number, number, number];
  /** FREE, SOLID or REACHED per cell. */
  cells: Uint8Array;
  /** Cells the flood reached: the map's connected open space. */
  reachedCount: number;
  /** Reached cells a person could stand in. */
  standable: Uint8Array;
  standableCount: number;
  leaked: boolean;
  /**
   * From the seed to the cell where the flood left the map, in world units.
   *
   * The same shape as the `.lin` pointfile vbsp writes, and for the same purpose: something
   * to follow to find the hole.
   */
  leakPath: Vec3[];
  seeds: Vec3[];
  notes: string[];
}

export class VoxelBudgetError extends Error {}

export const cellIndex = (g: { dims: [number, number, number] }, x: number, y: number, z: number): number =>
  (z * g.dims[1] + y) * g.dims[0] + x;

export const cellCentre = (g: VoxelGrid, x: number, y: number, z: number): Vec3 => [
  g.origin[0] + x * g.step,
  g.origin[1] + y * g.step,
  g.origin[2] + z * g.step,
];

/**
 * Floods the open space of a map from the given seeds.
 *
 * A seed outside the map floods the void instead, which is reported as a leak because that
 * is exactly what it looks like from inside the algorithm. So seeds come from
 * `info_player_start` where there is one -- the one point a map author has guaranteed is
 * inside.
 */
export function voxelise(scene: Scene, seeds: readonly Vec3[], options: VoxelOptions = {}): VoxelGrid {
  const step = options.step ?? DEFAULT_STEP;
  const maxCells = options.maxCells ?? 4_000_000;
  const mask = options.mask ?? MASK_SOLID;
  const notes: string[] = [];

  // One cell of margin all round, so the boundary of the array is always outside the map
  // and "the flood touched the edge" means "it got out" rather than "the array ran out".
  const lo: Vec3 = [
    scene.mins[0] - step * 2,
    scene.mins[1] - step * 2,
    scene.mins[2] - step * 2,
  ];
  const dims: [number, number, number] = [
    Math.ceil((scene.maxs[0] - lo[0]) / step) + 3,
    Math.ceil((scene.maxs[1] - lo[1]) / step) + 3,
    Math.ceil((scene.maxs[2] - lo[2]) / step) + 3,
  ];
  const total = dims[0] * dims[1] * dims[2];
  if (total > maxCells) {
    throw new VoxelBudgetError(
      `this map needs ${total.toLocaleString()} cells at ${step} units ` +
        `(${dims.join("x")}), over the ${maxCells.toLocaleString()} budget. Raise maxCells, ` +
        `or coarsen step -- 32 quarters the count and still resolves a doorway, 8 multiplies ` +
        `it by eight and resolves a kerb. Truncating would report a sealed map with a hole ` +
        `in the part that was not looked at.`,
    );
  }

  const grid: VoxelGrid = {
    step,
    origin: lo,
    dims,
    cells: new Uint8Array(total),
    reachedCount: 0,
    standable: new Uint8Array(total),
    standableCount: 0,
    leaked: false,
    leakPath: [],
    seeds: [...seeds],
    notes,
  };

  // Half a unit inside the cell: see the header. A closed cell test loses the first layer
  // above every surface, which is where people stand.
  const half: Vec3 = [step / 2 - 0.5, step / 2 - 0.5, step / 2 - 0.5];
  const solidity = new Int8Array(total).fill(-1); // -1 unknown, 0 free, 1 solid
  const isSolid = (x: number, y: number, z: number): boolean => {
    const at = cellIndex(grid, x, y, z);
    const known = solidity[at]!;
    if (known >= 0) return known === 1;
    const solid = boxInSolid(scene, cellCentre(grid, x, y, z), half, mask) !== null;
    solidity[at] = solid ? 1 : 0;
    return solid;
  };

  const queue: number[] = [];
  const parent = new Int32Array(total).fill(-1);

  for (const seed of seeds) {
    const sx = Math.round((seed[0] - lo[0]) / step);
    const sy = Math.round((seed[1] - lo[1]) / step);
    const sz = Math.round((seed[2] - lo[2]) / step);
    if (sx < 0 || sy < 0 || sz < 0 || sx >= dims[0] || sy >= dims[1] || sz >= dims[2]) {
      notes.push(`seed ${seed.join(" ")} is outside the map's extents and was ignored.`);
      continue;
    }
    if (isSolid(sx, sy, sz)) {
      notes.push(
        `seed ${seed.join(" ")} is inside a brush and was ignored. An entity origin buried ` +
          `in geometry is common and harmless in game; it just cannot start a flood.`,
      );
      continue;
    }
    const at = cellIndex(grid, sx, sy, sz);
    if (grid.cells[at] === REACHED) continue;
    grid.cells[at] = REACHED;
    queue.push(at);
  }

  if (queue.length === 0) {
    notes.push(`no usable seed: nothing was flooded, so nothing here says whether the map seals.`);
    return grid;
  }

  const NEIGHBOURS: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  let escaped = -1;
  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % dims[0];
    const y = Math.floor(at / dims[0]) % dims[1];
    const z = Math.floor(at / (dims[0] * dims[1]));

    // The margin makes this "the flood got out", not "the array ended".
    if (x === 0 || y === 0 || z === 0 || x === dims[0] - 1 || y === dims[1] - 1 || z === dims[2] - 1) {
      escaped = at;
      break;
    }

    for (const [dx, dy, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const nat = cellIndex(grid, nx, ny, nz);
      if (grid.cells[nat] !== FREE) continue;
      if (isSolid(nx, ny, nz)) {
        grid.cells[nat] = SOLID;
        continue;
      }
      grid.cells[nat] = REACHED;
      parent[nat] = at;
      queue.push(nat);
    }
  }

  if (escaped >= 0) {
    grid.leaked = true;
    const path: Vec3[] = [];
    for (let at = escaped; at >= 0; at = parent[at]!) {
      const x = at % dims[0];
      const y = Math.floor(at / dims[0]) % dims[1];
      const z = Math.floor(at / (dims[0] * dims[1]));
      path.push(cellCentre(grid, x, y, z));
      if (parent[at] === -1) break;
    }
    grid.leakPath = path.reverse();
    notes.push(
      `the flood reached the outside, so the map is not sealed. The path runs from the seed ` +
        `to where it got out; the hole is at the far end. vbsp would say "**** leaked ****" ` +
        `and refuse to run vvis.`,
    );
  }

  for (let i = 0; i < total; i++) if (grid.cells[i] === REACHED) grid.reachedCount += 1;

  // Standable: a reached cell with something solid directly under it and enough room above
  // for a person. Both halves are needed -- without the ceiling test a ventilation duct is
  // a room, and without the floor test the air above a courtyard is.
  const need = STANDING_CELLS(step);
  for (let z = 1; z < dims[2] - 1; z++) {
    for (let y = 1; y < dims[1] - 1; y++) {
      for (let x = 1; x < dims[0] - 1; x++) {
        const at = cellIndex(grid, x, y, z);
        if (grid.cells[at] !== REACHED) continue;
        if (!isSolid(x, y, z - 1)) continue;
        let room = 0;
        while (room < need && z + room < dims[2] - 1 && !isSolid(x, y, z + room)) room += 1;
        if (room < need) continue;
        grid.standable[at] = 1;
        grid.standableCount += 1;
      }
    }
  }

  notes.push(
    `${step}-unit cells: a wall thinner than that is not resolved, and a cell is free only ` +
      `when its whole interior is. Space is lost against surfaces rather than gained through ` +
      `them, because inventing a leak is worse than missing one.`,
  );

  return grid;
}
