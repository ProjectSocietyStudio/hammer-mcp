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
