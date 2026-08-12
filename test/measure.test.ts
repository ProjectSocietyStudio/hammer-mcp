import { describe, expect, it } from "vitest";
import {
  clearanceInFront,
  headroom,
  HULL_CROUCHING,
  HULL_STANDING,
  narrowestWidth,
  nearestObstacle,
  sweep,
  widthAcross,
} from "../src/space/measure.js";
import { findRooms } from "../src/space/rooms.js";
import { buildScene, MASK_PLAYER } from "../src/space/scene.js";
import { voxelise } from "../src/space/voxel.js";
import { insertSolids } from "../src/vmf/build.js";
import type { Vec3 } from "../src/vmf/solid.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const SEED: Vec3 = [0, -256, 16];
const scene = buildScene("rooms.vmf", roomsVmf());
const grid = voxelise(scene, [SEED]);
const rooms = findRooms(grid);

const SEEDTEXT =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

describe("sweep", () => {
  it("stops a player's width short of where a ray reaches", () => {
    // The whole reason the hull is here. Standing in the corridor's middle, facing north:
    // the wall's inner face is at y = -128, so a point reaches 128 and a 32-wide box 112.
    const from: Vec3 = [0, -256, 64];
    const ray = sweep(scene, from, [0, 1, 0], [0, 0, 0], MASK_PLAYER);
    const hull = sweep(scene, from, [0, 1, 0], HULL_STANDING, MASK_PLAYER);
    expect(ray.distance).toBeCloseTo(128, 1);
    expect(hull.distance).toBeCloseTo(112, 1);
    expect(hull.brushId).not.toBeNull();
  });

  it("says it ran out of reach rather than returning a number that looks like a wall", () => {
    const open = buildScene(
      "open.vmf",
      insertSolids(SEEDTEXT, [{ shape: "box", mins: [-64, -64, -32], maxs: [64, 64, 0] }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    const s = sweep(open, [0, 0, 64], [1, 0, 0], HULL_STANDING);
    expect(s.unbounded).toBe(true);
    expect(s.brushId).toBeNull();
  });
});

describe("widthAcross", () => {
  it("measures the corridor at the width the fixture is built to, exactly", () => {
    // The number the whole block is for. 256 units, and nothing in the measurement was told
    // that -- it is two sweeps plus the box's own footprint.
    const m = widthAcross(scene, [0, -256, 64], [0, 1, 0]);
    expect(m.widthUnits).toBeCloseTo(ROOMS.corridorWidth, 1);
    expect(m.sides[0].brushId).not.toBeNull();
    expect(m.sides[1].brushId).not.toBeNull();
  });

  it("adds the box's own footprint back, which is a whole player's width", () => {
    // A 32-wide hull that travels 32 units each way stands in a 96-unit gap, not a 64-unit
    // one. Forgetting the term under-reports every width by exactly one player -- the width
    // most likely to be the one that matters.
    const gap = buildScene(
      "gap.vmf",
      insertSolids(
        SEEDTEXT,
        [
          { shape: "box", mins: [-256, -256, 0], maxs: [256, -48, 128] },
          { shape: "box", mins: [-256, 48, 0], maxs: [256, 256, 128] },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    const m = widthAcross(gap, [0, 0, 64], [0, 1, 0]);
    expect(m.widthUnits).toBeCloseTo(96, 1);

    // And the two sweeps alone are 64, which is the wrong answer this term prevents.
    expect(m.sides[0].distance + m.sides[1].distance).toBeCloseTo(64, 1);
  });

  it("measures a crouching player through a gap a standing one cannot use", () => {
    const duct = buildScene(
      "duct.vmf",
      insertSolids(
        SEEDTEXT,
        [
          { shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] },
          { shape: "box", mins: [-256, -256, 48], maxs: [256, 256, 96] },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    // A standing hull cannot even be placed here; a crouching one can move.
    const crouch = sweep(duct, [0, 0, 24], [1, 0, 0], HULL_CROUCHING);
    const stand = sweep(duct, [0, 0, 24], [1, 0, 0], HULL_STANDING);
    expect(crouch.distance).toBeGreaterThan(100);
    expect(stand.distance).toBe(0);
  });
});

describe("narrowestWidth", () => {
  it("finds the narrow direction rather than the one it was asked about", () => {
    // A corridor is wide one way and long the other. "How wide is it" means the narrow one,
    // and a measurement along a fixed axis answers a different question.
    const m = narrowestWidth(scene, [0, -256, 64]);
    expect(m.widthUnits).toBeCloseTo(ROOMS.corridorWidth, 0);
    // The narrow axis is across the corridor, which runs along x.
    expect(Math.abs(m.axis[1])).toBeGreaterThan(0.9);
  });

  it("finds a diagonal alley's diagonal", () => {
    // Two slabs at 45 degrees. A measurement restricted to x and y reports the diagonal
    // gap's projection, which is wider than the gap.
    const alley = buildScene(
      "alley.vmf",
      insertSolids(
        SEEDTEXT,
        [
          { shape: "box", mins: [-512, -512, 0], maxs: [512, 512, 128], rotateZ: 45 },
          { shape: "box", mins: [-512, 600, 0], maxs: [512, 1600, 128], rotateZ: 45 },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    const alongY = widthAcross(alley, [0, 556, 64], [0, 1, 0]);
    const narrow = narrowestWidth(alley, [0, 556, 64]);
    expect(narrow.widthUnits).toBeLessThanOrEqual(alongY.widthUnits + 0.1);
  });
});

describe("headroom", () => {
  it("measures floor to ceiling at the height the fixture states", () => {
    const h = headroom(scene, [0, -256, 64]);
    expect(h.floorZ).toBeCloseTo(0, 1);
    expect(h.heightUnits).toBeCloseTo(ROOMS.HEIGHT, 1);
    expect(h.unbounded).toBe(false);
  });

  it("finds a beam a ray would slip past", () => {
    // Two beams with a gap between them. A line finds the gap and reports the room's full
    // height; a 32-wide box finds the beams, which is what a person's head does.
    const beams = buildScene(
      "beams.vmf",
      insertSolids(
        SEEDTEXT,
        [
          { shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] },
          { shape: "box", mins: [-256, -256, 128], maxs: [256, -8, 160] },
          { shape: "box", mins: [-256, 8, 128], maxs: [256, 256, 160] },
          { shape: "box", mins: [-256, -256, 256], maxs: [256, 256, 288] },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    const h = headroom(beams, [0, 0, 64]);
    expect(h.heightUnits).toBeCloseTo(128, 1);
    expect(h.heightUnits).toBeLessThan(256);
  });

  it("says it is unbounded rather than inventing a ceiling", () => {
    const open = buildScene(
      "open.vmf",
      insertSolids(SEEDTEXT, [{ shape: "box", mins: [-256, -256, -32], maxs: [256, 256, 0] }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    expect(headroom(open, [0, 0, 64]).unbounded).toBe(true);
  });
});

describe("clearanceInFront", () => {
  it("measures the room a person has in front of a thing", () => {
    // Facing north out of the corridor's middle: 128 to the wall, less the hull, so 112.
    const a = clearanceInFront(scene, [0, -256, 0], 90);
    expect(a.clearUnits).toBeCloseTo(112, 1);
    expect(a.blockedBy).not.toBeNull();
  });

  it("lifts off the floor before sweeping, because an origin sits on it", () => {
    // An entity's origin is at its base. A sweep from there travels through the floor slab
    // and reports zero, which reads as "completely blocked" for every entity in the map.
    const a = clearanceInFront(scene, [0, -256, 0], 90);
    expect(a.from[2]).toBeGreaterThan(HULL_STANDING[2]);
    expect(a.clearUnits).toBeGreaterThan(0);
  });

  it("names the hull it assumed, because it is an assumption", () => {
    // A door's leaf width lives in a model this server cannot open offline, so "can it
    // swing" is not answerable. How much room a person has in front of it is.
    const a = clearanceInFront(scene, [0, -256, 0], 90);
    expect(a.assumedHull).toEqual(HULL_STANDING);
  });

  it("turns with the yaw it is given", () => {
    const north = clearanceInFront(scene, [0, -256, 0], 90).clearUnits;
    const east = clearanceInFront(scene, [0, -256, 0], 0).clearUnits;
    expect(north).not.toBeCloseTo(east, 0);
  });
});

describe("nearestObstacle", () => {
  it("measures to the surface, not to a corner", () => {
    const n = nearestObstacle(scene, [0, -256, 64], 512)!;
    expect(n.distanceUnits).toBeCloseTo(64, 3);
    expect(n.point[2]).toBeCloseTo(0, 3);
  });
});

describe("the voxel localises and the hull measures", () => {
  it("agrees with the room pass about where the doorway is, and is exact about how wide", () => {
    // The pattern the whole file is built on. The watershed found the doorway to within a
    // cell; the sweep says 96.00 rather than "about six cells".
    expect(rooms.portals).toHaveLength(2);
    for (const portal of rooms.portals) {
      const at: Vec3 = [portal.at[0], portal.at[1], portal.at[2] + 32];
      const m = narrowestWidth(scene, at);
      expect(m.widthUnits).toBeCloseTo(ROOMS.doorWidth, 1);
    }
  });

  it("would still be right if the doorway were not a whole number of cells", () => {
    // 100 units is six cells and a bit. The voxel estimate rounds to 96 and looks perfectly
    // reasonable; the sweep says 100. This is the case that makes the second half of the
    // pattern necessary rather than tidy.
    const odd = buildScene(
      "odd.vmf",
      insertSolids(
        SEEDTEXT,
        [
          { shape: "box", mins: [-256, -256, 0], maxs: [256, -50, 128] },
          { shape: "box", mins: [-256, 50, 0], maxs: [256, 256, 128] },
        ],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    expect(widthAcross(odd, [0, 0, 64], [0, 1, 0]).widthUnits).toBeCloseTo(100, 1);
  });
});
