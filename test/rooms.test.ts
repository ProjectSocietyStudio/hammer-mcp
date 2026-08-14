import { describe, expect, it } from "vitest";
import { classify, FLOOR_COSINE, kindOf } from "../src/space/classify.js";
import { portalWidth } from "../src/space/measure.js";
import { findRooms, clearanceField } from "../src/space/rooms.js";
import { buildScene } from "../src/space/scene.js";
import { cellIndex, voxelise, VoxelBudgetError } from "../src/space/voxel.js";
import type { VoxelGrid } from "../src/space/voxel.js";
import { insertSolids } from "../src/vmf/build.js";
import type { Vec3 } from "../src/vmf/solid.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

/** The seed is the corridor's middle, which is where the fixture puts info_player_start. */
const SEED: Vec3 = [0, -256, 16];

const sealed = buildScene("rooms.vmf", roomsVmf());
const leaky = buildScene("rooms-leak.vmf", roomsVmf({ leak: true }));

const sealedGrid = voxelise(sealed, [SEED]);
const sealedRooms = findRooms(sealedGrid);

/** The cell a world point falls in, for asking the grid about a place by name. */
function pointToCell(grid: VoxelGrid, p: Vec3): number {
  return cellIndex(
    grid,
    Math.round((p[0] - grid.origin[0]) / grid.step),
    Math.round((p[1] - grid.origin[1]) / grid.step),
    Math.round((p[2] - grid.origin[2]) / grid.step),
  );
}

/** Square metres from square Hammer units, at the repo's own 0.0254 m per unit. */
const m2 = (units: number): number => units * 0.0254 * 0.0254;

describe("classify", () => {
  it("uses Source's own standable slope rather than a preference", () => {
    // 0.7 is roughly cos(45.6), the slope past which Source stops letting a player stand,
    // and the same threshold FaceSelector.facing already uses.
    expect(FLOOR_COSINE).toBe(0.7);
    expect(kindOf([0, 0, 1])).toBe("floor");
    expect(kindOf([0, 0, -1])).toBe("ceiling");
    expect(kindOf([1, 0, 0])).toBe("wall");
    expect(kindOf([0, 0.8, 0.6])).toBe("slope");
  });

  it("counts only the faces a person could touch", () => {
    // A map is boxes pushed against each other, so most of what a .vmf contains is buried:
    // the underside of every slab, the back of every wall. Counting those gives a building
    // with twice the floor it has, in a number that reads perfectly ordinary.
    const c = classify(sealed);
    expect(c.buriedCount).toBeGreaterThan(0);

    const exposedFloor = c.areaByKind.floor;
    const allFloor = c.faces
      .filter((f) => f.kind === "floor")
      .reduce((t, f) => t + f.area, 0);
    expect(exposedFloor).toBeLessThan(allFloor);

    // Exactly twice the footprint, and the factor of two is the finding rather than a
    // rounding: the ceiling slab's UPPER face points up and has open space in front of it,
    // so it is an exposed floor too. It is, in fact, the roof -- somewhere a person can
    // stand on many maps. "Exposed" means open space in front, which includes the outside
    // of the map; deciding what is inside is the flood's job, not a face's.
    const footprint = (ROOMS.east.x[1] + ROOMS.T - (ROOMS.west.x[0] - ROOMS.T)) *
      (ROOMS.west.y[1] + ROOMS.T - (ROOMS.corridor.y[0] - ROOMS.T));
    expect(exposedFloor).toBe(footprint * 2);
  });

  it("learns which brush touches which, from the same pass", () => {
    // Adjacency is free: when a probe lands inside a brush, that brush is the neighbour.
    // Nothing in this repository has ever known which brush touches which.
    const c = classify(sealed);
    expect(c.adjacency.size).toBeGreaterThan(0);
    for (const [a, set] of c.adjacency) {
      for (const b of set) {
        expect(c.adjacency.get(b), `${a}-${b} must be symmetric`).toContain(a);
      }
    }
  });
});

describe("voxelise", () => {
  it("floods the interior and finds standable floor", () => {
    expect(sealedGrid.reachedCount).toBeGreaterThan(1000);
    expect(sealedGrid.standableCount).toBeGreaterThan(1000);
    expect(sealedGrid.leaked).toBe(false);
    expect(sealedGrid.leakPath).toEqual([]);
  });

  it("finds the hole, and the path out ends at it", () => {
    // The whole point of the file: vbsp is the only thing that can say a map leaks today,
    // and it costs a toolchain and minutes. A flood either stays inside or it does not.
    const grid = voxelise(leaky, [SEED]);
    expect(grid.leaked).toBe(true);
    expect(grid.leakPath.length).toBeGreaterThan(2);

    // The fixture's hole is 64 wide at x in [-800, -736], in the north wall at y = 512.
    const out = grid.leakPath[grid.leakPath.length - 1]!;
    expect(out[1], "the escape is north of the north wall").toBeGreaterThan(ROOMS.west.y[1]);
    expect(out[0], "and at the hole, not somewhere else along it").toBeGreaterThan(-820);
    expect(out[0]).toBeLessThan(-716);

    // The path starts at the seed, so it is something to follow rather than a lone point.
    const start = grid.leakPath[0]!;
    expect(Math.hypot(start[0] - SEED[0], start[1] - SEED[1])).toBeLessThan(grid.step * 2);
  });

  it("says a seed inside a brush is unusable instead of flooding the void", () => {
    const grid = voxelise(sealed, [[0, 0, 128]]); // inside the block between the rooms
    expect(grid.notes.join(" ")).toMatch(/inside a brush/);
    expect(grid.reachedCount).toBe(0);
  });

  it("refuses a budget it cannot meet rather than truncating", () => {
    // Truncating reports a sealed map with a hole in the part nobody looked at.
    expect(() => voxelise(sealed, [SEED], { maxCells: 1000 })).toThrow(VoxelBudgetError);
    expect(() => voxelise(sealed, [SEED], { maxCells: 1000 })).toThrow(/coarsen step/);
  });

  it("does not step diagonally through two brushes that merely touch", () => {
    // Two slabs meeting along a line, with open space on either side of the join. The cells
    // each side are diagonal neighbours and nothing solid lies between their centres, so a
    // 26-connected flood walks from one to the other -- through a join a player cannot pass.
    //
    // This needed a scene of its own. On the three-room fixture a 26-connected flood behaves
    // perfectly, because a cell is free only when its whole interior is and the walls are
    // thicker than a cell. The corner case is real; the fixture that was supposed to show it
    // could not, and the comment claiming otherwise was wrong for a whole afternoon.
    const seed =
      'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
    // Two blocks laid out like a checkerboard inside a sealed shell. They share the line
    // x = 8, z = 8 and nothing else, and each spans the shell, so the open space above-left
    // and the open space below-right touch only at that one edge. A 6-connected flood cannot
    // get from one to the other; a 26-connected one steps straight across.
    //
    // Two things about the scene are load-bearing and were both wrong first. The join sits
    // at x = 8, a cell BOUNDARY rather than a cell centre: put it at 0 and the cell there is
    // solid, no diagonal pair exists, and the test cannot tell the two connectivities apart.
    // And the shell has to be there at all -- two blocks in the void leak on the first step,
    // the flood stops, and almost nothing is ever visited.
    const S = 512;
    const T = 32;
    const text = insertSolids(
      seed,
      [
        { shape: "box", mins: [-S - T, -256 - T, -S - T], maxs: [S + T, -256, S + T] },
        { shape: "box", mins: [-S - T, 256, -S - T], maxs: [S + T, 256 + T, S + T] },
        { shape: "box", mins: [-S - T, -256, -S - T], maxs: [-S, 256, S + T] },
        { shape: "box", mins: [S, -256, -S - T], maxs: [S + T, 256, S + T] },
        { shape: "box", mins: [-S, -256, -S - T], maxs: [S, 256, -S] },
        { shape: "box", mins: [-S, -256, S], maxs: [S, 256, S + T] },
        { shape: "box", mins: [-S, -256, -S], maxs: [8, 256, 8] },
        { shape: "box", mins: [8, -256, 8], maxs: [S, 256, S] },
      ],
      { material: "DEV/DEV_MEASUREGENERIC01" },
    ).text;
    const grid = voxelise(buildScene("touching.vmf", text), [[-256, 0, 256]]);
    expect(grid.leaked, "the shell is sealed, so a leak here is the test's own fault").toBe(false);

    const near = pointToCell(grid, [0, 0, 16]);
    const far = pointToCell(grid, [16, 0, 0]);
    expect(grid.cells[near], "the near side of the join was flooded").toBe(2);
    expect(grid.cells[far], "the far side must not be reached through the join").not.toBe(2);
  });

  it("refuses to call a crawlspace standable", () => {
    // A duct 32 units high has floor under it and air in it and is not somewhere a person
    // stands. Without the headroom test it is a room, with an area and a width, and nothing
    // about the answer says a player could never be there.
    const seed =
      'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';
    const duct = insertSolids(
      seed,
      [
        { shape: "box", mins: [-512, -512, -32], maxs: [512, 512, 0] }, // floor
        { shape: "box", mins: [-512, -512, 32], maxs: [512, 512, 64] }, // ceiling 32 up
        { shape: "box", mins: [-512, -512, 0], maxs: [-480, 512, 32] },
        { shape: "box", mins: [480, -512, 0], maxs: [512, 512, 32] },
        { shape: "box", mins: [-512, -512, 0], maxs: [512, -480, 32] },
        { shape: "box", mins: [-512, 480, 0], maxs: [512, 512, 32] },
      ],
      { material: "DEV/DEV_MEASUREGENERIC01" },
    ).text;
    const grid = voxelise(buildScene("duct.vmf", duct), [[0, 0, 16]]);
    expect(grid.reachedCount, "the space is there and was flooded").toBeGreaterThan(100);
    expect(grid.standableCount, "and nobody can stand up in it").toBe(0);
    expect(findRooms(grid).rooms).toEqual([]);
  });
});

describe("clearanceField", () => {
  it("measures the corridor at exactly the width the fixture states", () => {
    // 256 units wide, so the widest point is 128 from either side: 8 cells of 16.
    const clearance = clearanceField(sealedGrid);
    let peak = 0;
    for (let i = 0; i < clearance.length; i++) if (clearance[i]! > peak) peak = clearance[i]!;
    // The rooms are 512 wide, so the map's peak is theirs: 16 cells.
    expect(peak * sealedGrid.step).toBe(512 / 2);
  });

  it("is not flat, which is the failure that hides", () => {
    // Written with the step directions folded into the neighbour list, every cell of a flat
    // floor had a non-standable neighbour one cell up, so every cell was a boundary and the
    // field was 1 everywhere. The watershed still returned rooms of roughly the right size.
    const clearance = clearanceField(sealedGrid);
    const values = new Set<number>();
    for (let i = 0; i < clearance.length; i++) if (clearance[i]! > 0) values.add(clearance[i]!);
    expect(values.size).toBeGreaterThan(8);
  });
});

/**
 * The top of a counter is standable, and it is not a room.
 *
 * The flood fills air, and the air above a counter rests on a surface -- so a 40-unit
 * counter grows its own region, which is then judged by rules written about rooms. It
 * fails all of them by construction: about 4 square metres and 104 units of headroom, at
 * every counter, forever. An agent building a shop escaped it only by making every piece
 * of furniture 80 units tall so that no top was standable at all, which is a constraint
 * from the voxeliser wearing the clothes of a style choice (issue #49).
 *
 * The tell was in the output all along: `connectsTo: []`. A walk steps one cell; a counter
 * top is two or more cells up, so nothing walks there.
 */
describe("a place you cannot walk to", () => {
  // In a corner rather than mid-floor: a block in the middle of a room splits the room
  // around itself, which is the watershed doing its job and a different subject.
  const bare = findRooms(voxelise(buildScene("bare.vmf", roomsVmf()), [SEED]));
  const withCounter = buildScene(
    "counter.vmf",
    insertSolids(roomsVmf(), [
      { shape: "box", mins: [-1024, -128, 0], maxs: [-896, 0, 40] },
    ]).text,
  );
  const result = findRooms(voxelise(withCounter, [SEED]));

  it("is reported apart from the rooms, not as one of them", () => {
    expect(bare.unreachable).toHaveLength(0);
    expect(result.unreachable.length).toBeGreaterThan(0);

    // Above the floor every room stands on, which is the whole of what makes it
    // unwalkable. The floor's own cells sit at the first cell centre, not at zero.
    const floor = Math.min(...result.rooms.map((r) => r.mins[2]));
    const top = result.unreachable.find((r) => r.mins[2] > floor);
    expect(top).toBeDefined();
    // A 40-unit counter, so its top sits a counter's height above the floor cells.
    expect(top!.mins[2] - floor).toBeGreaterThanOrEqual(32);
  });

  it("keeps every room it does report walk-connected to the rest", () => {
    // The property the counter top violated and that `connectsTo: []` was announcing.
    // A single-room map is the one case where having no neighbour is not a fault.
    if (result.rooms.length > 1) {
      for (const room of result.rooms) expect(room.neighbours.length).toBeGreaterThan(0);
    }
  });

  it("says so in its notes, rather than silently dropping space", () => {
    expect(result.notes.join(" ")).toMatch(/no walk reaches them from a spawn/);
  });
});

describe("findRooms", () => {

  it("finds the three spaces the fixture is made of, and no more", () => {
    expect(sealedRooms.rooms).toHaveLength(3);
  });

  it("gets each one's floor area to within a cell all round", () => {
    const areas = sealedRooms.rooms.map((r) => r.floorArea).sort((a, b) => b - a);
    const corridorArea =
      (ROOMS.corridor.x[1] - ROOMS.corridor.x[0]) * (ROOMS.corridor.y[1] - ROOMS.corridor.y[0]);
    const roomArea = (ROOMS.west.x[1] - ROOMS.west.x[0]) * (ROOMS.west.y[1] - ROOMS.west.y[0]);

    // A cell is free only when its whole interior is, so a region loses one cell against
    // every wall. That is a known, stated loss and not a tolerance for being wrong.
    expect(areas[0]! / corridorArea).toBeGreaterThan(0.85);
    expect(areas[0]! / corridorArea).toBeLessThan(1.05);
    expect(areas[1]! / roomArea).toBeGreaterThan(0.85);
    expect(areas[2]! / roomArea).toBeGreaterThan(0.85);

    // And in metres, since that is what a person asks in.
    expect(sealedRooms.rooms[0]!.floorAreaSquareMetres).toBeCloseTo(m2(areas[0]!), 1);
  });

  it("measures each room's width at its widest, exactly", () => {
    const byWidth = sealedRooms.rooms.map((r) => r.maxClearance).sort((a, b) => b - a);
    // Two rooms 512 units across: half of that is 256.
    expect(byWidth[0]).toBe(256);
    expect(byWidth[1]).toBe(256);
  });

  it("puts a doorway between each room and the corridor, at the stated width", () => {
    // The number the whole block is for: the fixture says 96, and nothing in the algorithm
    // was told that.
    expect(sealedRooms.portals).toHaveLength(2);
    for (const p of sealedRooms.portals) {
      expect(p.approxWidthUnits).toBe(ROOMS.doorWidth);
      // The doorway is in the wall at y in [-128, -96].
      expect(p.at[1]).toBeGreaterThan(ROOMS.corridor.y[1] - 48);
      expect(p.at[1]).toBeLessThan(ROOMS.corridor.y[1] + 48);
    }
  });

  it("knows the corridor connects to both rooms and they do not connect to each other", () => {
    // The graph, not just the count. A method that split the corridor in five would still
    // get "three rooms" wrong in a way a total could hide.
    const bySize = [...sealedRooms.rooms].sort((a, b) => b.floorArea - a.floorArea);
    const corridor = bySize[0]!;
    expect(corridor.neighbours).toHaveLength(2);
    for (const room of bySize.slice(1)) {
      expect(room.neighbours).toEqual([corridor.id]);
    }
  });

  it("does not split a corridor at every doorway mouth", () => {
    // Each doorway raises the corridor's clearance by a cell, which is a local maximum,
    // which a plain watershed splits at: the corridor came back as five rooms joined by
    // portals 256 units wide -- its own width. A portal that narrows nothing is not a
    // doorway, and that rule is what collapses them.
    for (const p of sealedRooms.portals) {
      expect(p.approxWidthUnits).toBeLessThan(ROOMS.corridorWidth);
    }
  });

  it("says the method and its parameters, because it is a heuristic", () => {
    expect(sealedRooms.method).toBe("watershed-clearance");
    expect(sealedRooms.parameters.step).toBe(16);
    expect(sealedRooms.notes.join(" ")).toMatch(/heuristic/);
    expect(sealedRooms.notes.join(" ")).toMatch(/connected components/);
  });

  it("still describes the map when it leaks", () => {
    // A leaking map is the one you most want a plan of. Refusing to answer would send the
    // caller back to the compiler, which is what this exists to avoid.
    const rooms = findRooms(voxelise(leaky, [SEED]));
    expect(rooms.rooms).toHaveLength(3);
  });
});

/**
 * The doorway a voxel count cannot report, and the swept hull can.
 *
 * `approxWidthUnits` counts cells: it is a multiple of `step` by construction, and it rounds
 * down, because a cell is free only when its whole interior is. So a doorway is reported at
 * the largest multiple of the cell size that fits inside it -- and a builder that widens a
 * door until the estimate reaches the brief's own number is following the ruler rather than
 * the brief. Measured 13/08/2026: a doorway built 80 wide reported 64 at step 16, and the
 * builder had to build 80 to satisfy a rule about 64 (issue #61).
 *
 * The gap between the two numbers is what this fixture is for, so its doorway is built at a
 * width that is **not** a multiple of the cell size. 100 units, at step 16: six whole cells
 * fit, which is 96, and the four missing units are exactly the error.
 */
describe("measuring a doorway rather than counting cells", () => {
  const T = 32;
  const H = 256;
  const GAP = 100;
  const box = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): { shape: "box"; mins: Vec3; maxs: Vec3 } => ({
    shape: "box",
    mins: [x0, y0, z0],
    maxs: [x1, y1, z1],
  });

  // Two 320-square rooms either side of a divider at x 368..400, with a GAP-wide opening
  // in it centred on y = 256. The opening's edges land off the 16-unit grid on purpose.
  const low = 256 - GAP / 2;
  const high = 256 + GAP / 2;
  const SOURCE = insertSolids(
    'versioninfo\n{\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n',
    [
      box(-T, -T, -T, 768 + T, 512 + T, 0),
      box(-T, -T, H, 768 + T, 512 + T, H + T),
      box(-T, -T, 0, 0, 512 + T, H),
      box(768, -T, 0, 768 + T, 512 + T, H),
      box(-T, -T, 0, 768 + T, 0, H),
      box(-T, 512, 0, 768 + T, 512 + T, H),
      box(368, 0, 0, 400, low, H),
      box(368, high, 0, 400, 512, H),
    ],
    { material: "DEV/DEV_MEASUREGENERIC01" },
  ).text;

  const scene = buildScene("doorway.vmf", SOURCE);
  const rooms = findRooms(voxelise(scene, [[184, 256, 16]]));

  it("has the two rooms and the one doorway the plan states", () => {
    expect(rooms.rooms).toHaveLength(2);
    expect(rooms.portals).toHaveLength(1);
  });

  it("counts cells low, which is why the estimate alone is a trap", () => {
    // Not a defect: the voxeliser is right to lose space against a surface rather than
    // gain it through one. It is a defect only when it is the number a rule is judged on.
    const estimate = rooms.portals[0]!.approxWidthUnits;
    expect(estimate).toBeLessThan(GAP);
    expect(estimate % 16).toBe(0);
  });

  it("measures the doorway it was built at, to the unit", () => {
    const measured = portalWidth(scene, rooms.portals[0]!.at);
    expect(measured).not.toBeNull();
    expect(measured!).toBeCloseTo(GAP, 1);
  });
});
