/**
 * A map whose answer is written in its own dimensions.
 *
 * The scene graph's hard part is that "how many rooms" has no oracle in nature. So this
 * fixture states the answer by construction: three rooms of stated size joined by a corridor
 * of stated width, through doorways of stated width. Every expectation in the test is a
 * number from this file, not a number recorded from a previous run -- a recorded expectation
 * turns a test into a description of whatever the code did the first time.
 *
 * The plan, seen from above (units, not to scale):
 *
 *     y
 *    +512  +---------------+       +---------------+
 *          |               |       |               |
 *          |      WEST     |       |     EAST      |
 *          |    512x512    |       |    512x512    |
 *    +128  +-------+  +----+       +----+  +-------+
 *          .       |96|    .       .    |96|       .
 *     -128 +-------+  +----+-------+----+  +-------+
 *          |            CORRIDOR 256 wide           |
 *     -384 +----------------------------------------+
 *          -1024        -256    256          1024   x
 *
 * The south room hangs off the corridor's middle through a 96-unit doorway, so the map has
 * a room that is not on the way between the other two -- which is what makes the portal
 * graph worth asserting rather than just the room count.
 *
 * Everything is built with `insertSolids`, the writer that a compiled, booted probe map
 * already proves. A fixture written plane-by-plane by hand tests the hand.
 */
import { insertSolids } from "../../src/vmf/build.js";
import type { SolidSpec } from "../../src/vmf/build.js";
import { applyVmfOps } from "../../src/vmf/edit.js";

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n}\n' +
  'visgroups\n{\n}\nworld\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n' +
  '\t"skyname" "sky_day01_01"\n}\n';

/** Stated once, used by both the fixture and the test. */
export const ROOMS = {
  /** Wall thickness, floor thickness and ceiling thickness. */
  T: 32,
  /** Interior height of every space. */
  HEIGHT: 256,
  west: { x: [-1024, -512], y: [-128, 512] },
  east: { x: [512, 1024], y: [-128, 512] },
  corridor: { x: [-1024, 1024], y: [-384, -128] },
  /** Both doorways from a room down into the corridor. */
  doorWidth: 96,
  /** The corridor's own width, which is what "how wide is this passage" should return. */
  corridorWidth: 256,
} as const;

const box = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
): SolidSpec => ({ shape: "box", mins: [x0, y0, z0], maxs: [x1, y1, z1] });

/**
 * Builds the map.
 *
 * Written as a solid block with the open spaces carved out of it by construction rather than
 * by a boolean operation: the walls are listed, and what is not a wall is a room. That is how
 * a mapper builds and how `hollow_solids` works, and it means every surface here is a surface
 * a person could touch.
 */
export function roomsVmf(options: { leak?: boolean } = {}): string {
  const { T, HEIGHT } = ROOMS;
  const W = ROOMS.west;
  const E = ROOMS.east;
  const C = ROOMS.corridor;
  const half = ROOMS.doorWidth / 2;

  const outer = { x0: W.x[0] - T, y0: C.y[0] - T, x1: E.x[1] + T, y1: W.y[1] + T };

  const walls: SolidSpec[] = [
    // Floor and ceiling over the whole footprint.
    box(outer.x0, outer.y0, -T, outer.x1, outer.y1, 0),
    box(outer.x0, outer.y0, HEIGHT, outer.x1, outer.y1, HEIGHT + T),

    // The outer shell.
    box(outer.x0, outer.y0, 0, W.x[0], outer.y1, HEIGHT), // west
    box(E.x[1], outer.y0, 0, outer.x1, outer.y1, HEIGHT), // east
    box(outer.x0, outer.y0, 0, outer.x1, C.y[0], HEIGHT), // south
    box(outer.x0, W.y[1], 0, outer.x1, outer.y1, HEIGHT), // north

    // The block between the two rooms, from the corridor up to the north wall. This is what
    // makes west and east separate rooms rather than one long one.
    box(W.x[1], C.y[1], 0, E.x[0], W.y[1], HEIGHT),

    // The wall between the west room and the corridor, with a doorway in it.
    box(W.x[0], C.y[1], 0, -768 - half, C.y[1] + T, HEIGHT),
    box(-768 + half, C.y[1], 0, W.x[1], C.y[1] + T, HEIGHT),

    // The same on the east side.
    box(E.x[0], C.y[1], 0, 768 - half, C.y[1] + T, HEIGHT),
    box(768 + half, C.y[1], 0, E.x[1], C.y[1] + T, HEIGHT),
  ];

  if (options.leak) {
    // A 64-unit hole in the north wall, above the WEST room. Which part of the wall matters:
    // a first version put the hole at x=0, where the north wall backs onto the solid block
    // between the two rooms, so it opened onto nothing and the map stayed sealed. A leak
    // fixture that does not leak is worse than no fixture -- it makes the checker look right.
    walls[5] = box(outer.x0, W.y[1], 0, -800, outer.y1, HEIGHT);
    walls.push(box(-736, W.y[1], 0, outer.x1, outer.y1, HEIGHT));
  }

  const built = insertSolids(SEED, walls, { material: "DEV/DEV_MEASUREGENERIC01" });

  return applyVmfOps(built.text, [
    {
      op: "add",
      keyvalues: {
        classname: "info_player_start",
        origin: `${(C.x[0] + C.x[1]) / 2} ${(C.y[0] + C.y[1]) / 2} 16`,
      },
    },
    {
      op: "add",
      keyvalues: { classname: "light", origin: "0 0 192", _light: "255 255 255 400" },
    },
  ]).text;
}
