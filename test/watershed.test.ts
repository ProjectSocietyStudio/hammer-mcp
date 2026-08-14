/**
 * The room finder, on floor plans small enough to draw.
 *
 * `test/rooms.test.ts` drives it through real geometry, which is the right way to know it
 * works and the wrong way to know *why* it does what it does: a `.vmf` decides the cell
 * indices, and this algorithm turns out to depend on them. So these plans are ASCII, one
 * character per cell, and everything the watershed sees is on the page.
 *
 * What that made visible: `peak` is a region's widest clearance, said so in the code's own
 * comment, and stopped being true the moment two regions merged. The merge points the
 * union at `min(index)` and left `peak` alone, so a one-cell nook that happened to be
 * scanned early kept its own tiny peak for the whole union -- and every later boundary
 * test used it. The bar for merging through a doorway somewhere else in the map dropped to
 * the width of that nook.
 *
 * An agent building a map hit this and could only get out of it by reading this file's
 * source; issue #48 has the session.
 */
import { describe, expect, it } from "vitest";
import { findRooms } from "../src/space/rooms.js";
import { REACHED, SOLID } from "../src/space/voxel.js";
import type { VoxelGrid } from "../src/space/voxel.js";

/**
 * A floor plan as text: `#` is solid, anything else is a cell a person can stand in.
 *
 * One z-layer, because the watershed is a 2D operation on the clearance field and a third
 * dimension would only add cells nothing in it reads.
 */
function plan(rows: string[], step = 16): VoxelGrid {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const total = width * height;
  const standable = new Uint8Array(total);
  const cells = new Uint8Array(total).fill(SOLID);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((rows[y]![x] ?? "#") === "#") continue;
      standable[y * width + x] = 1;
      cells[y * width + x] = REACHED;
    }
  }

  return {
    step,
    origin: [0, 0, 0],
    dims: [width, height, 1],
    cells,
    reachedCount: standable.reduce((n, v) => n + v, 0),
    standable,
    standableCount: standable.reduce((n, v) => n + v, 0),
    leaked: false,
    leakPath: [],
    seeds: [],
    notes: [],
  };
}

/** Rooms of at least one cell, so a plan's own shape decides the count and not a threshold. */
const rooms = (rows: string[]): number => findRooms(plan(rows), { minRoomArea: 0 }).rooms.length;

const NOOK = [
  "###############",
  "#.#...###.....#",
  "#.#...###.....#",
  "#.....###.....#",
  "#.............#",
  "#.....###.....#",
  "#.....###.....#",
  "#.....###.....#",
  "###############",
];

describe("saying why it merged", () => {
  /**
   * The request this came from, in the builder's own words: for each pair of regions it
   * merged, report the reason and the cell. Every dead end hit while building
   * `hmcp_bodega` was a merge that could not be seen, at a coordinate nobody would guess,
   * and the only way out was reading `src/space/rooms.ts` -- which a caller of this server
   * cannot do.
   *
   * Worth having whether or not the peak defect below is ever repaired: it is what turns
   * a room count that surprises you into a sentence.
   */
  it("reports the merge that collapses two rooms into one, and where", () => {
    const result = findRooms(plan(NOOK), { minRoomArea: 0 });
    expect(result.rooms).toHaveLength(1);
    expect(result.merges.length).toBeGreaterThan(0);

    const constrictions = result.merges.filter((m) => m.reason === "not-a-constriction");
    expect(constrictions.length).toBeGreaterThan(0);
    for (const m of constrictions) {
      // Both numbers, so the reader can see the comparison rather than take a verdict.
      expect(m.measured).toBeGreaterThanOrEqual(m.bar);
      expect(m.at).not.toBeNull();
      expect(m.at).toHaveLength(3);
    }
  });

  it("says which regions were offcuts, and against what threshold", () => {
    // Two boxes that survive the constriction pass as separate rooms, judged against a
    // threshold neither clears -- so one is absorbed as an offcut, and says so.
    const twoBoxes = [
      "###############",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "#.............#",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "###############",
    ];
    expect(rooms(twoBoxes)).toBe(2);

    const result = findRooms(plan(twoBoxes), { minRoomArea: 1e9 });
    const offcuts = result.merges.filter((m) => m.reason === "offcut");
    expect(offcuts.length).toBeGreaterThan(0);
    for (const m of offcuts) {
      expect(m.bar).toBe(1e9);
      expect(m.measured).toBeLessThan(m.bar);
    }
  });

  /**
   * Issue #60, and the half of #48 that stayed open.
   *
   * `merges` explains every merge it makes. What the caller notices is the *portal that
   * stopped being reported*, which is the same event from the other side -- and on the
   * round-3 map it was noticed by a rule about a doorway going quiet after three furniture
   * brushes went in two hundred units away. Five `step` calls and four delete-and-recheck
   * cycles to find the cause, none of which the output pointed at.
   *
   * The NOOK plan is that map in miniature: two rooms, one doorway, and a corner bitten out
   * of the far side that collapses the segmentation.
   */
  it("names the doorway a merge stopped reporting", () => {
    const result = findRooms(plan(NOOK), { minRoomArea: 0 });
    // The premise: one room, so no portal is reported at all.
    expect(result.rooms).toHaveLength(1);
    expect(result.portals).toEqual([]);

    const closed = result.merges.filter((m) => m.closed !== null);
    expect(closed.length).toBeGreaterThan(0);

    // Every number below comes from the plan, not from a previous run. The only way
    // between the two halves is row 4, columns 6 to 8, and `cellCentre` is index x step --
    // so the doorway's col is at y = 64, x between 96 and 128. The nook in the corner is
    // closed by a merge of its own, hence "one of them" rather than "the first".
    const doorway = closed.filter(
      (m) => m.closed!.at[1] === 4 * 16 && m.closed!.at[0] >= 6 * 16 && m.closed!.at[0] <= 8 * 16,
    );
    expect(doorway.length).toBeGreaterThan(0);
    for (const m of doorway) expect(m.closed!.approxWidthUnits).toBeGreaterThan(0);

    // And every closed col names a real place: a merge that pointed at a wall would be
    // worse than saying nothing.
    for (const m of closed) expect(m.closed!.at[2]).toBe(0);
  });

  /**
   * The col is the *widest* cell on the boundary, not the first one the scan met.
   *
   * The merge loop knows only the cell it is standing on when it decides, which is wherever
   * the scan reached the boundary first -- on a wide opening, an edge of it. Reporting that
   * as "the doorway that closed" understates the opening and points at the wrong place, and
   * a plan where the two answers differ is the only way to know which one is being reported.
   *
   * This plan's wall is two cells with a four-cell gap between them, so the boundary is
   * several cells long and its widest point is not its first.
   */
  it("reports the widest cell on the boundary as the col, not the first one scanned", () => {
    const wideOpening = [
      "############",
      "#....#.....#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#....#.....#",
      "############",
    ];
    const result = findRooms(plan(wideOpening), { minRoomArea: 0 });
    expect(result.rooms).toHaveLength(1);

    const closed = result.merges.filter((m) => m.closed !== null);
    expect(closed.length).toBeGreaterThan(0);
    for (const m of closed) {
      // `measured` is the half-width at the cell the decision was taken on; the col is by
      // definition at least as wide as that, and on this plan strictly wider. An
      // implementation that reports the deciding cell as the col fails this.
      expect(m.closed!.approxWidthUnits).toBeGreaterThanOrEqual(2 * m.measured);
      expect(m.closed!.at).not.toEqual(m.at);
      // And it is in the opening: rows 2 to 5, which are the ones the wall leaves free.
      expect(m.closed!.at[1]).toBeGreaterThanOrEqual(2 * 16);
      expect(m.closed!.at[1]).toBeLessThanOrEqual(5 * 16);
    }
  });

  it("makes every merge's `into` a room the same result reports", () => {
    // `absorbed` cannot be looked up -- the region is gone. `into` is the whole point of
    // the field and used to be an internal number whenever a merge chained: absorbed in
    // one pass, absorbed again in the next, and mapped through a table that only holds
    // survivors. A huge threshold forces exactly those chains.
    for (const [rows, minRoomArea] of [
      [NOOK, 0],
      [NOOK, 1e9],
      [
        [
          "###############",
          "#.....###.....#",
          "#.....###.....#",
          "#.....###.....#",
          "#.............#",
          "#.....###.....#",
          "#.....###.....#",
          "#.....###.....#",
          "###############",
        ],
        1e9,
      ],
    ] as Array<[string[], number]>) {
      const result = findRooms(plan(rows), { minRoomArea });
      const ids = new Set([...result.rooms, ...result.unreachable].map((r) => r.id));
      expect(result.merges.length).toBeGreaterThan(0);
      for (const m of result.merges) expect(ids.has(m.into)).toBe(true);
    }
  });

  it("puts an offcut's point in the offcut, not at the corner it was scanned from", () => {
    // The right half of this plan is 5 cells wide by 7 tall. Its widest cell is in the
    // middle of it; the first cell in scan order is the top-left corner, which is where
    // this used to point -- a place a reader looks at and sees a wall.
    const twoBoxes = [
      "###############",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "#.............#",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "###############",
    ];
    const offcuts = findRooms(plan(twoBoxes), { minRoomArea: 1e9 }).merges.filter(
      (m) => m.reason === "offcut" && m.at !== null,
    );
    expect(offcuts.length).toBeGreaterThan(0);
    for (const m of offcuts) {
      const [x, y] = m.at!;
      // Off every wall of the plan by a full cell. The open cells run from index 1 to 13
      // across and 1 to 7 down, so a corner cell cannot satisfy this.
      expect(x).toBeGreaterThan(1 * 16);
      expect(x).toBeLessThan(13 * 16);
      expect(y).toBeGreaterThan(1 * 16);
      expect(y).toBeLessThan(7 * 16);
    }
  });

  it("reports no merges at all for a plan that needs none", () => {
    const result = findRooms(
      plan(["#########", "#.......#", "#.......#", "#.......#", "#########"]),
      { minRoomArea: 0 },
    );
    expect(result.merges).toEqual([]);
  });
});

describe("the watershed on a drawn plan", () => {
  it("calls one open box one room", () => {
    expect(
      rooms([
        "#########",
        "#.......#",
        "#.......#",
        "#.......#",
        "#.......#",
        "#.......#",
        "#########",
      ]),
    ).toBe(1);
  });

  it("splits two boxes joined by a one-cell doorway", () => {
    expect(
      rooms([
        "###############",
        "#.....###.....#",
        "#.....###.....#",
        "#.....###.....#",
        "#.............#",
        "#.....###.....#",
        "#.....###.....#",
        "#.....###.....#",
        "###############",
      ]),
    ).toBe(2);
  });

  /**
   * The regression, and the whole reason this file exists.
   *
   * Same two rooms and same doorway as above, with a dead-end nook bitten out of the
   * top-left corner -- the lowest cell indices on the plan, so the watershed seeds it
   * first and it gets region 0.
   *
   * With `peak` left behind by the merge, the nook is absorbed into the left room, the
   * union keeps the nook's peak, and the doorway on the far side of the map then clears a
   * bar set by a corner nobody was looking at. Two rooms become one.
   *
   * Nothing about this is visible from the map: the nook is nowhere near the doorway it
   * destroys, and moving the same nook to the *bottom*-left corner -- a higher index --
   * makes the problem disappear, which is what made it so expensive to find.
   *
   * ## Why this is `it.fails` and not a fix
   *
   * The one-line repair is obvious and it is wrong. Carrying the peak through the merge --
   * `peak[root] = max(peak[root], peak[absorbed])` -- turns these two plans green and
   * turns the three-space fixture in `rooms.test.ts` into **four** rooms, along with nine
   * other assertions across the plan renderer and the doorway measurements.
   *
   * Which says something worth more than the fix: the merge criterion documented above --
   * "if the opening between two regions is as wide as the narrower of the two, nothing
   * narrows and they are one space" -- was calibrated against peaks that shrink when
   * regions merge. Correct the peak and the criterion under-merges: the corridor that the
   * rule exists to collapse stops collapsing.
   *
   * So the defect is real, minimal and reproduced here, and repairing it means revisiting
   * the criterion rather than the bookkeeping. `it.fails` because a test that passes by
   * asserting the wrong answer would enshrine it, and this one goes red the day somebody
   * gets it right. Issue #48.
   */
  it.fails("is not swayed by a dead-end nook in the corner it scans first", () => {
    const withNook = [
      "###############",
      "#.#...###.....#",
      "#.#...###.....#",
      "#.....###.....#",
      "#.............#",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "###############",
    ];
    expect(rooms(withNook)).toBe(2);
  });

  /**
   * The same plan mirrored top to bottom. It is the same building, so it has the same
   * number of rooms -- and it does not: one against two.
   *
   * This is the cleanest statement of the defect on the page, because mirroring changes
   * cell indices and nothing else. Any answer that moves is an answer about the scan
   * order rather than about the map. Same reason for `it.fails` as above.
   */
  it.fails("counts a plan and its mirror image the same", () => {
    const withNook = [
      "###############",
      "#.#...###.....#",
      "#.#...###.....#",
      "#.....###.....#",
      "#.............#",
      "#.....###.....#",
      "#.....###.....#",
      "#.....###.....#",
      "###############",
    ];
    expect(rooms(withNook)).toBe(rooms([...withNook].reverse()));
  });
});
