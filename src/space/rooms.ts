/**
 * Finding rooms, and the openings between them.
 *
 * ## Connected components do not work, and it is worth saying why
 *
 * The obvious method is to take connected components of the open space. In a sealed map
 * that returns **one** component: the whole interior is connected, which is what sealed
 * means. Every corridor, every room and every stairwell is one region, and the answer is
 * both correct and useless.
 *
 * ## Watershed on the clearance field
 *
 * So the split has to come from shape rather than from connectivity. `clearance(c)` is the
 * distance from a standable cell to the nearest place a person cannot stand -- a wall, a
 * drop, a low ceiling. A room is somewhere **locally wide**: the clearance field has a local
 * maximum in the middle of a room and a saddle in a doorway.
 *
 * Growing regions outward from the local maxima in order of decreasing clearance is a
 * watershed, and it puts the boundaries exactly at the narrow places. That is the whole
 * trick: **the region borders are the doorways**, so the openings are not looked for
 * separately, they are what is left over.
 *
 * This is a **heuristic** and the tool says so in its output, with the parameters that
 * produced it. It can split a hall with a pillar in the middle, and it can swallow an alcove.
 * The oracle is a recomputation by an entirely different method -- mutual visibility on the
 * compiled map -- and where the two disagree the honest answer is to show the plan and let a
 * person look.
 *
 * ## Steps of one cell are walkable
 *
 * Neighbours are the four in-plane cells at the same height and at one cell up or down. At
 * the default 16-unit grid that is a 16-unit step, and Source lets a player climb 18 without
 * jumping. So a staircase is one region rather than a row of tiny ones, and a 32-unit ledge
 * is correctly two.
 */
import { cellCentre, cellIndex } from "./voxel.js";
import type { VoxelGrid } from "./voxel.js";
import type { Vec3 } from "../vmf/solid.js";

/** Below this floor area a region is an offcut and is merged away. 4096 u2 is 64x64. */
export const DEFAULT_MIN_ROOM_AREA = 4096;

export interface Room {
  id: number;
  cellCount: number;
  /** Floor area in square Hammer units: cells times the cell's own footprint. */
  floorArea: number;
  floorAreaSquareMetres: number;
  mins: Vec3;
  maxs: Vec3;
  /** The widest standable point, which is the middle of the room in any useful sense. */
  centre: Vec3;
  /** Half the width of the room at its widest, in units. */
  maxClearance: number;
  /** Ids of the rooms this one connects to. */
  neighbours: number[];
}

export interface Portal {
  between: [number, number];
  /** The narrow point the two regions meet at. */
  at: Vec3;
  /**
   * Width in units, from the clearance at the col.
   *
   * A voxel estimate, and it is stated as one: the grid localises the narrow place to within
   * a cell, and a swept player hull is what measures it exactly. Reporting this number as if
   * it were the measurement is the mistake this comment exists to prevent.
   */
  approxWidthUnits: number;
  approxHeightUnits: number;
}

/**
 * One merge the room pass made, and the reason it made it.
 *
 * Rooms are the *result* of merging, so a room count that surprises you is a merge you
 * cannot see -- and every dead end hit while building `hmcp_bodega` was exactly that: a
 * merge at a coordinate nobody would have guessed, decided by a rule nothing printed.
 * The algorithm has all of this in hand at the moment it decides; it simply never said it.
 */
export interface Merge {
  /** The region that stopped existing. */
  absorbed: number;
  /** The region it became part of. */
  into: number;
  /** Why: a constriction that did not constrict, or a region too small to be a room. */
  reason: "not-a-constriction" | "offcut";
  /** Where, in world units. The point to look at. */
  at: Vec3 | null;
  /**
   * The comparison that decided it, in units.
   *
   * `not-a-constriction`: the opening between the two, against the narrower of their two
   * widest points. `offcut`: the region's floor area, against the threshold.
   */
  measured: number;
  bar: number;
}

export interface RoomsResult {
  rooms: Room[];
  portals: Portal[];
  /** Every merge, in the order it happened. What turns a surprising count into a reason. */
  merges: Merge[];
  /** Region id per cell, or -1. */
  regionOf: Int32Array;
  method: string;
  parameters: Record<string, number>;
  notes: string[];
}

/** The four ways to walk. Height is not a direction; it is something a step absorbs. */
const DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The eight in-plane directions, for grouping a ridge and for nothing else.
 *
 * The clearance field is a BFS distance over the four walking directions, which makes it a
 * Manhattan distance -- and the ridge of a Manhattan field runs **diagonally**. Grouping
 * plateau cells with the four directions therefore breaks a room's ridge into a line of
 * isolated cells, one seed each, and a 512-unit room comes back as eight rooms. The flood
 * itself stays 4-connected: a diagonal is not a way to walk, it is only a way for two cells
 * of a ridge to be the same ridge.
 */
const PLATEAU_DIRECTIONS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** How many cells up or down a walk may step. One cell of 16 is under Source's 18. */
const STEP_CELLS = 1;

/**
 * Where a walk in one direction lands, or -1 if it cannot go that way.
 *
 * Same level first, then up a step, then down one. Trying the level ahead before the step is
 * not an optimisation: on a staircase both are standable, and preferring the step would make
 * a flat landing read as a slope.
 *
 * The shape of this function is the fix for a fault that made the whole field useless.
 * Written as a flat list of twelve offsets -- four level, four up, four down -- a cell was
 * called a boundary cell when *any* of the twelve was not standable. A flat floor has no
 * standable neighbour one cell up, so every cell in every room was a boundary, the clearance
 * field was 1 everywhere, and the watershed had no maxima to find. It still returned rooms,
 * and their sizes were even roughly right, which is how it went unnoticed until a fixture
 * with a stated width reported a 512-wide room as 16 wide.
 */
function walkTo(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
): number {
  const nx = x + dx;
  const ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= grid.dims[0] || ny >= grid.dims[1]) return -1;
  for (const dz of [0, STEP_CELLS, -STEP_CELLS]) {
    const nz = z + dz;
    if (nz < 0 || nz >= grid.dims[2]) continue;
    const at = cellIndex(grid, nx, ny, nz);
    if (grid.standable[at] === 1) return at;
  }
  return -1;
}

/**
 * Distance, in cells, from each standable cell to the nearest cell that is not standable.
 *
 * Multi-source BFS from the boundary of the walkable set. Not Euclidean -- a BFS over this
 * neighbourhood measures along the ways a person can actually walk, which is the distance a
 * corridor's width is about.
 */
export function clearanceField(grid: VoxelGrid): Int32Array {
  const total = grid.dims[0] * grid.dims[1] * grid.dims[2];
  const clearance = new Int32Array(total).fill(-1);
  const queue: number[] = [];

  for (let z = 0; z < grid.dims[2]; z++) {
    for (let y = 0; y < grid.dims[1]; y++) {
      for (let x = 0; x < grid.dims[0]; x++) {
        const at = cellIndex(grid, x, y, z);
        if (grid.standable[at] !== 1) continue;
        let edge = false;
        for (const [dx, dy] of DIRECTIONS) {
          if (walkTo(grid, x, y, z, dx, dy) < 0) {
            edge = true;
            break;
          }
        }
        if (edge) {
          clearance[at] = 1;
          queue.push(at);
        }
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const at = queue[head]!;
    const x = at % grid.dims[0];
    const y = Math.floor(at / grid.dims[0]) % grid.dims[1];
    const z = Math.floor(at / (grid.dims[0] * grid.dims[1]));
    for (const [dx, dy] of DIRECTIONS) {
      const nat = walkTo(grid, x, y, z, dx, dy);
      if (nat < 0 || clearance[nat] !== -1) continue;
      clearance[nat] = clearance[at]! + 1;
      queue.push(nat);
    }
  }

  return clearance;
}

export interface RoomOptions {
  minRoomArea?: number;
}

export function findRooms(grid: VoxelGrid, options: RoomOptions = {}): RoomsResult {
  const minArea = options.minRoomArea ?? DEFAULT_MIN_ROOM_AREA;
  const clearance = clearanceField(grid);
  const total = grid.dims[0] * grid.dims[1] * grid.dims[2];
  const regionOf = new Int32Array(total).fill(-1);
  const notes: string[] = [];

  const cells: number[] = [];
  for (let i = 0; i < total; i++) if (clearance[i]! > 0) cells.push(i);
  if (cells.length === 0) {
    notes.push(
      `no standable space was found, so there are no rooms to report. A map with no floor a ` +
        `person can stand on is usually a map whose seed was wrong, not a map with no rooms.`,
    );
    return { rooms: [], portals: [], merges: [], regionOf, method: "watershed-clearance", parameters: { minRoomArea: minArea, step: grid.step }, notes };
  }

  const at3 = (at: number): [number, number, number] => [
    at % grid.dims[0],
    Math.floor(at / grid.dims[0]) % grid.dims[1],
    Math.floor(at / (grid.dims[0] * grid.dims[1])),
  ];
  const neighboursVia = (at: number, dirs: Array<[number, number]>): number[] => {
    const [x, y, z] = at3(at);
    const out: number[] = [];
    for (const [dx, dy] of dirs) {
      const nat = walkTo(grid, x, y, z, dx, dy);
      if (nat >= 0) out.push(nat);
    }
    return out;
  };
  const walkNeighbours = (at: number): number[] => neighboursVia(at, DIRECTIONS);
  const ridgeNeighbours = (at: number): number[] => neighboursVia(at, PLATEAU_DIRECTIONS);

  // ## Seeds: the plateaus, not the cells
  //
  // A local maximum is a cell no neighbour beats. In a room those form a *plateau* -- the
  // room's medial axis, dozens of cells wide -- and treating each of them as its own seed is
  // the classic watershed over-segmentation. The first version here did exactly that, by
  // calling a cell a maximum when none of its neighbours had been assigned yet: a 512-unit
  // room came back as eight rooms marching diagonally across it, each a few square metres,
  // and the room count was a fact about the iteration order. Connected plateaus of maxima are
  // one seed.
  let nextRegion = 0;
  let maxClearance = 0;
  for (const at of cells) if (clearance[at]! > maxClearance) maxClearance = clearance[at]!;

  for (const at of cells) {
    if (regionOf[at]! >= 0) continue;
    const c = clearance[at]!;
    if (ridgeNeighbours(at).some((n) => clearance[n]! > c)) continue;

    // A plateau of equal-clearance maxima, taken whole.
    const region = nextRegion++;
    const stack = [at];
    regionOf[at] = region;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const n of ridgeNeighbours(cur)) {
        if (regionOf[n]! >= 0 || clearance[n] !== c) continue;
        if (ridgeNeighbours(n).some((m) => clearance[m]! > c)) continue;
        regionOf[n] = region;
        stack.push(n);
      }
    }
  }

  // ## Priority flood
  //
  // Grow every region outward, always from the widest unclaimed frontier cell. Because a
  // narrow place is reached last from both sides, the boundary between two regions lands in
  // it -- so the doorways are not searched for, they are what is left over.
  //
  // A bucket per clearance value stands in for a heap: the values are small integers, and
  // pushing a neighbour into `min(its own, the current)` bucket means no bucket is ever
  // refilled after it has been passed.
  const buckets: number[][] = Array.from({ length: maxClearance + 1 }, () => []);
  for (const at of cells) if (regionOf[at]! >= 0) buckets[clearance[at]!]!.push(at);

  for (let c = maxClearance; c >= 1; c--) {
    const bucket = buckets[c]!;
    for (let head = 0; head < bucket.length; head++) {
      const at = bucket[head]!;
      const region = regionOf[at]!;
      for (const n of walkNeighbours(at)) {
        if (regionOf[n]! >= 0) continue;
        regionOf[n] = region;
        const cn = clearance[n]!;
        buckets[cn < c ? cn : c]!.push(n);
      }
    }
  }

  const areaOfCell = grid.step * grid.step;

  /** Region -> region -> the boundary cell with the most room, which is the col. */
  const collectPortals = (): Map<string, { a: number; b: number; at: number }> => {
    const found = new Map<string, { a: number; b: number; at: number }>();
    for (const at of cells) {
      const [x, y, z] = at3(at);
      const mine = regionOf[at]!;
      for (const [dx, dy] of DIRECTIONS) {
        const nat = walkTo(grid, x, y, z, dx, dy);
        if (nat < 0) continue;
        const theirs = regionOf[nat]!;
        if (theirs < 0 || theirs === mine) continue;
        const key = mine < theirs ? `${mine}:${theirs}` : `${theirs}:${mine}`;
        const prev = found.get(key);
        if (!prev || clearance[at]! > clearance[prev.at]!) {
          found.set(key, { a: Math.min(mine, theirs), b: Math.max(mine, theirs), at });
        }
      }
    }
    return found;
  };

  // ## A portal that narrows nothing is not a doorway
  //
  // A watershed splits wherever the field has a saddle, and a field has saddles for reasons
  // that are not architecture: each doorway mouth raises the corridor's clearance by a cell,
  // which makes a little peak, which splits the corridor there. The fixture's 2048-unit
  // corridor came back as five rooms joined by portals 256 units wide -- exactly the
  // corridor's own width.
  //
  // That last part is the test. A doorway is a *constriction*; if the opening between two
  // regions is as wide as the narrower of the two, nothing narrows and they are one space.
  // Merging on that rule collapses the corridor and leaves both 96-unit doorways standing,
  // and it is a statement about the map rather than a threshold tuned until the fixture
  // passed.
  const parent = new Int32Array(nextRegion);
  for (let i = 0; i < nextRegion; i++) parent[i] = i;
  const find = (a: number): number => {
    let r = a;
    while (parent[r] !== r) r = parent[r]!;
    while (parent[a] !== r) {
      const next = parent[a]!;
      parent[a] = r;
      a = next;
    }
    return r;
  };

  const merged: Merge[] = [];
  for (let pass = 0; pass < 8; pass++) {
    const peak = new Int32Array(nextRegion);
    for (const at of cells) {
      const r = find(regionOf[at]!);
      if (clearance[at]! > peak[r]!) peak[r] = clearance[at]!;
    }
    let joined = 0;
    for (const at of cells) {
      const mine = find(regionOf[at]!);
      for (const n of walkNeighbours(at)) {
        const theirs = find(regionOf[n]!);
        if (theirs === mine) continue;
        const narrower = Math.min(peak[mine]!, peak[theirs]!);
        // The opening is measured at the widest cell either side of the boundary: a col one
        // cell wide reads as clearance 1 from whichever side you stand on.
        const through = Math.max(clearance[at]!, clearance[n]!);
        if (through < narrower) continue;
        merged.push({
          absorbed: Math.max(mine, theirs),
          into: Math.min(mine, theirs),
          reason: "not-a-constriction",
          at: cellCentre(grid, ...at3(at)),
          measured: through * grid.step,
          bar: narrower * grid.step,
        });
        parent[Math.max(mine, theirs)] = Math.min(mine, theirs);
        joined += 1;
      }
    }
    if (joined === 0) break;
  }
  for (const at of cells) regionOf[at] = find(regionOf[at]!);

  // Offcuts. A watershed on a real map produces dozens of one- and two-cell regions in
  // corners and doorways; without this, "how many rooms" is a number about the algorithm
  // rather than about the map.
  let merges = 0;
  for (let pass = 0; pass < 8; pass++) {
    const count = new Int32Array(nextRegion);
    for (const at of cells) count[regionOf[at]!]! += 1;

    const portals = collectPortals();
    const neighboursOf = new Map<number, Set<number>>();
    for (const { a, b } of portals.values()) {
      (neighboursOf.get(a) ?? neighboursOf.set(a, new Set()).get(a)!).add(b);
      (neighboursOf.get(b) ?? neighboursOf.set(b, new Set()).get(b)!).add(a);
    }

    let changed = false;
    for (let r = 0; r < nextRegion; r++) {
      if (count[r] === 0) continue;
      if (count[r]! * areaOfCell >= minArea) continue;
      const options = [...(neighboursOf.get(r) ?? [])].filter((n) => count[n]! > 0);
      if (options.length === 0) continue;
      // The biggest neighbour: an offcut belongs to the space it opens onto.
      let into = options[0]!;
      for (const n of options) if (count[n]! > count[into]!) into = n;
      if (into === r) continue;
      const where = cells.find((at) => regionOf[at] === r);
      merged.push({
        absorbed: r,
        into,
        reason: "offcut",
        at: where === undefined ? null : cellCentre(grid, ...at3(where)),
        measured: count[r]! * areaOfCell,
        bar: minArea,
      });
      for (const at of cells) if (regionOf[at] === r) regionOf[at] = into;
      count[into]! += count[r]!;
      count[r] = 0;
      merges += 1;
      changed = true;
    }
    if (!changed) break;
  }
  if (merges > 0) {
    notes.push(
      `${merges} region(s) below ${minArea} square units were merged into the largest space ` +
        `they open onto. Without that step a watershed reports every corner of every doorway ` +
        `as a room of its own.`,
    );
  }

  // Renumber to a dense 0..n-1 so the ids mean something to a reader.
  const remap = new Map<number, number>();
  for (const at of cells) {
    const r = regionOf[at]!;
    if (!remap.has(r)) remap.set(r, remap.size);
    regionOf[at] = remap.get(r)!;
  }

  const rooms: Room[] = [];
  for (let i = 0; i < remap.size; i++) {
    rooms.push({
      id: i,
      cellCount: 0,
      floorArea: 0,
      floorAreaSquareMetres: 0,
      mins: [Infinity, Infinity, Infinity],
      maxs: [-Infinity, -Infinity, -Infinity],
      centre: [0, 0, 0],
      maxClearance: 0,
      neighbours: [],
    });
  }

  for (const at of cells) {
    const r = regionOf[at]!;
    const room = rooms[r]!;
    const [x, y, z] = at3(at);
    const centre = cellCentre(grid, x, y, z);
    room.cellCount += 1;
    const mins = room.mins as [number, number, number];
    const maxs = room.maxs as [number, number, number];
    for (let a = 0; a < 3; a++) {
      if (centre[a]! - grid.step / 2 < mins[a]!) mins[a] = centre[a]! - grid.step / 2;
      if (centre[a]! + grid.step / 2 > maxs[a]!) maxs[a] = centre[a]! + grid.step / 2;
    }
    const c = clearance[at]!;
    if (c > room.maxClearance) {
      room.maxClearance = c;
      room.centre = centre;
    }
  }

  for (const room of rooms) {
    room.floorArea = room.cellCount * areaOfCell;
    room.floorAreaSquareMetres = Math.round(room.floorArea * 0.0254 * 0.0254 * 100) / 100;
    // Clearance counts cells from the boundary, the first standable cell being 1. A run of
    // n cells across peaks at ceil(n/2), so half the width is that many cells. Checked
    // against the fixture: a 256-unit corridor peaks at 8 cells of 16, and 8 x 16 is 256.
    room.maxClearance = room.maxClearance * grid.step;
  }

  const portals: Portal[] = [];
  for (const { a, b, at } of collectPortals().values()) {
    const ra = remap.get(a) ?? a;
    const rb = remap.get(b) ?? b;
    if (ra === rb) continue;
    const [x, y, z] = at3(at);
    const width = 2 * clearance[at]! * grid.step;
    // Height at the col, measured by walking up the reached cells above it.
    let up = 0;
    while (z + up < grid.dims[2] && grid.cells[cellIndex(grid, x, y, z + up)] === 2) up += 1;
    portals.push({
      between: [Math.min(ra, rb), Math.max(ra, rb)],
      at: cellCentre(grid, x, y, z),
      approxWidthUnits: width,
      approxHeightUnits: up * grid.step,
    });
    rooms[ra]!.neighbours.push(rb);
    rooms[rb]!.neighbours.push(ra);
  }
  for (const room of rooms) room.neighbours = [...new Set(room.neighbours)].sort((p, q) => p - q);

  notes.push(
    `Rooms come from a watershed on the clearance field, not from connected components -- a ` +
      `sealed map has exactly one of those. This is a heuristic: it can split a hall with a ` +
      `pillar in it and swallow an alcove. Portal widths are voxel estimates to within a ` +
      `cell; a swept player hull is what measures one exactly.`,
  );

  // A region is absorbed once, and a reader should see it once.
  //
  // The merge loop visits a boundary from both of its sides, over several passes, and in
  // three dimensions also from the cell above and below -- so the same absorption was
  // reported up to four times with identical coordinates, which reads as four separate
  // decisions and inflates a count a caller is meant to reason about. First record wins:
  // it is the one that actually decided.
  //
  // Measured on the bodega map of 13/08/2026: 21 records for 14 absorptions. No committed
  // fixture reproduces it -- a single-layer plan never revisits a boundary and neither
  // does the three-room fixture -- so this is deduplication by construction rather than
  // by test, and saying so is the point. A region that has been absorbed cannot be
  // absorbed again, so keeping the first record cannot drop a real one.
  const seen = new Set<number>();
  const merged1 = merged.filter((m) => !seen.has(m.absorbed) && seen.add(m.absorbed) !== null);

  // Merges are recorded against internal region ids; the surviving ones are renumbered at
  // the end, so `into` is mapped through to the id the caller will actually see.
  for (const m of merged1) m.into = remap.get(m.into) ?? m.into;

  return {
    rooms,
    portals,
    merges: merged1,
    regionOf,
    method: "watershed-clearance",
    parameters: { minRoomArea: minArea, step: grid.step, cellArea: areaOfCell },
    notes,
  };
}
