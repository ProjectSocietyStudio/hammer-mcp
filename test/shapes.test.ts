import { describe, expect, it } from "vitest";
import { insertSolids, VmfBuildError } from "../src/vmf/build.js";
import { expandShape } from "../src/vmf/shapes.js";
import type { CompoundSpec } from "../src/vmf/shapes.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck } from "../src/vmf/solid.js";

/** The smallest thing insertSolids will add to: an empty world. */
const EMPTY = 'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

/** Builds a shape and reads every brush of it back through the independent checker. */
function build(spec: CompoundSpec): { solids: SolidCheck[]; notes: string[] } {
  const expansion = expandShape(spec);
  const result = insertSolids(EMPTY, expansion.specs, {
    material: "DEV/DEV_MEASUREGENERIC01",
  });
  const report = checkVmfSolids("x", result.text);
  return { solids: report.solids, notes: expansion.notes };
}

/**
 * The one thing every shape must satisfy, and the reason this file is short: a brush the
 * writer emits has to be a brush the reader accepts. The writer goes volume to planes and
 * the checker goes planes to volume, so a sign error in a new mesh cannot hide in both.
 */
function everyBrushIsValid(solids: SolidCheck[]): void {
  expect(solids.length).toBeGreaterThan(0);
  for (const s of solids) {
    expect(s.valid, `solid ${s.id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(true);
    expect(s.volume, `solid ${s.id} encloses nothing`).toBeGreaterThan(0);
  }
}

describe("cone", () => {
  it("is one brush the checker accepts", () => {
    const { solids } = build({
      shape: "cone",
      mins: [-64, -64, 0],
      maxs: [64, 64, 128],
      sides: 8,
    });
    expect(solids).toHaveLength(1);
    everyBrushIsValid(solids);
  });

  it("has one face per side plus its base", () => {
    const { solids } = build({
      shape: "cone",
      mins: [-64, -64, 0],
      maxs: [64, 64, 128],
      sides: 8,
    });
    expect(solids[0]!.sides).toHaveLength(9);
    expect(solids[0]!.vertices).toHaveLength(9);
  });

  it("holds roughly a third of the prism around it, which is what a cone is", () => {
    const { solids } = build({
      shape: "cone",
      mins: [-64, -64, 0],
      maxs: [64, 64, 128],
      sides: 32,
    });
    const cone = (Math.PI * 64 * 64 * 128) / 3;
    expect(solids[0]!.volume).toBeGreaterThan(cone * 0.9);
    expect(solids[0]!.volume).toBeLessThan(cone * 1.05);
  });

  it("refuses a side count no polygon has", () => {
    expect(() =>
      expandShape({ shape: "cone", mins: [0, 0, 0], maxs: [64, 64, 64], sides: 2 }),
    ).toThrow(VmfBuildError);
  });
});

describe("stairs", () => {
  it("is one brush per step, and every one is valid", () => {
    const { solids } = build({
      shape: "stairs",
      mins: [0, 0, 0],
      maxs: [256, 128, 128],
      steps: 8,
      direction: "+x",
    });
    expect(solids).toHaveLength(8);
    everyBrushIsValid(solids);
  });

  it("climbs, and every step reaches the ground", () => {
    // A tread that floats is a tread a player falls through the side of.
    const { solids } = build({
      shape: "stairs",
      mins: [0, 0, 0],
      maxs: [256, 128, 128],
      steps: 8,
      direction: "+x",
    });
    const byX = [...solids].sort((a, b) => a.mins[0]! - b.mins[0]!);
    for (let i = 0; i < byX.length; i++) {
      expect(byX[i]!.mins[2], `step ${i} floats`).toBe(0);
      expect(byX[i]!.maxs[2], `step ${i} is at the wrong height`).toBe(16 * (i + 1));
    }
  });

  it("climbs the other way when told to", () => {
    const { solids } = build({
      shape: "stairs",
      mins: [0, 0, 0],
      maxs: [256, 128, 128],
      steps: 8,
      direction: "-x",
    });
    const byX = [...solids].sort((a, b) => a.mins[0]! - b.mins[0]!);
    expect(byX[0]!.maxs[2]).toBe(128);
    expect(byX[byX.length - 1]!.maxs[2]).toBe(16);
  });

  it("says so when the rise is more than a player can climb", () => {
    // 18 units is the Half-Life 2 step height. Above it the flight needs a jump, which is
    // almost never what someone building stairs meant.
    const { notes } = build({
      shape: "stairs",
      mins: [0, 0, 0],
      maxs: [256, 128, 256],
      steps: 4,
      direction: "+x",
    });
    expect(notes.join(" ")).toMatch(/not walkable/);
  });
});

describe("arch", () => {
  it("is one brush per segment, and every one is valid", () => {
    const { solids } = build({
      shape: "arch",
      centre: [0, 0, 0],
      innerRadius: 128,
      outerRadius: 192,
      height: 32,
      arcDegrees: 180,
      segments: 8,
    });
    expect(solids).toHaveLength(8);
    everyBrushIsValid(solids);
  });

  it("stays inside its own radii", () => {
    const { solids } = build({
      shape: "arch",
      centre: [0, 0, 0],
      innerRadius: 128,
      outerRadius: 192,
      height: 32,
      arcDegrees: 360,
      segments: 12,
    });
    for (const s of solids) {
      for (const v of s.vertices) {
        const r = Math.hypot(v[0], v[1]);
        expect(r, `corner at radius ${r}`).toBeLessThanOrEqual(193);
        expect(r).toBeGreaterThanOrEqual(127);
        expect(v[2]).toBeGreaterThanOrEqual(0);
        expect(v[2]).toBeLessThanOrEqual(32);
      }
    }
  });

  it("refuses a segment past a quarter turn, instead of building its complement", () => {
    // A segment is a quadrilateral through four corners, so beyond 90 degrees it describes
    // the sector between its ends rather than the sector asked for. Measured: a 270-degree
    // arch in one segment came out with corners at 0 and -90 degrees -- the complementary
    // wedge -- and everyBrushIsValid accepted it, because that wedge is a valid brush.
    expect(() =>
      expandShape({
        shape: "arch",
        centre: [0, 0, 0],
        innerRadius: 64,
        outerRadius: 128,
        height: 32,
        arcDegrees: 270,
        segments: 1,
      }),
    ).toThrow(/quarter turn/);

    // And the same arch written the other way round. A negative arcDegrees is how a
    // clockwise arch is spelled, and testing the signed step let it straight through.
    expect(() =>
      expandShape({
        shape: "arch",
        centre: [0, 0, 0],
        innerRadius: 64,
        outerRadius: 128,
        height: 32,
        arcDegrees: -270,
        segments: 1,
      }),
    ).toThrow(/quarter turn/);

    // A clockwise arch with enough segments is fine.
    everyBrushIsValid(
      build({
        shape: "arch",
        centre: [0, 0, 0],
        innerRadius: 64,
        outerRadius: 128,
        height: 32,
        arcDegrees: -180,
        segments: 4,
      }).solids,
    );

    // Exactly a quarter turn is the common case -- a full ring in four segments -- and
    // must still work.
    const ring = build({
      shape: "arch",
      centre: [0, 0, 0],
      innerRadius: 64,
      outerRadius: 128,
      height: 32,
      arcDegrees: 360,
      segments: 4,
    });
    expect(ring.solids).toHaveLength(4);
    everyBrushIsValid(ring.solids);
  });

  it("refuses an inner radius that is not inside the outer one", () => {
    expect(() =>
      expandShape({
        shape: "arch",
        centre: [0, 0, 0],
        innerRadius: 192,
        outerRadius: 128,
        height: 32,
        arcDegrees: 180,
        segments: 4,
      }),
    ).toThrow(/inner radius/);
  });
});

describe("sphere", () => {
  it("is one brush per stack, and every one is valid", () => {
    const { solids } = build({
      shape: "sphere",
      centre: [0, 0, 0],
      radius: 128,
      sides: 12,
      stacks: 6,
    });
    expect(solids).toHaveLength(6);
    everyBrushIsValid(solids);
  });

  it("approaches the volume of a ball as it gets finer", () => {
    // The stack-of-frusta approximation always under-fills, and gets closer as the bands
    // narrow. That both numbers are below the true volume is the check that it is
    // approximating a ball rather than something else.
    const exact = (4 / 3) * Math.PI * 128 ** 3;
    const coarse = build({ shape: "sphere", centre: [0, 0, 0], radius: 128, sides: 8, stacks: 4 });
    const fine = build({ shape: "sphere", centre: [0, 0, 0], radius: 128, sides: 32, stacks: 16 });
    const sum = (s: SolidCheck[]): number => s.reduce((t, x) => t + x.volume, 0);

    expect(sum(coarse.solids)).toBeLessThan(exact);
    expect(sum(fine.solids)).toBeLessThan(exact);
    expect(sum(fine.solids)).toBeGreaterThan(sum(coarse.solids));
    expect(sum(fine.solids)).toBeGreaterThan(exact * 0.9);
  });

  it("stays inside its own radius", () => {
    const { solids } = build({
      shape: "sphere",
      centre: [0, 0, 0],
      radius: 128,
      sides: 12,
      stacks: 6,
    });
    for (const s of solids) {
      for (const v of s.vertices) {
        expect(Math.hypot(v[0], v[1], v[2])).toBeLessThanOrEqual(129);
      }
    }
  });

  it("refuses a sphere finer than the grid it has to live on", () => {
    // A ring of radius 1.5 with 32 sides rounds several corners onto the same whole unit,
    // and every face touching such a pair is degenerate. vbsp accepts a degenerate face
    // without saying so, so the brush would compile and be wrong. The refusal names the
    // two numbers in conflict, which is the thing a caller can act on.
    expect(() =>
      expandShape({ shape: "sphere", centre: [0, 0, 0], radius: 8, sides: 32, stacks: 16 }),
    ).toThrow(/same whole unit/);

    // And the same sphere with a side count the grid can carry is fine.
    everyBrushIsValid(
      build({ shape: "sphere", centre: [0, 0, 0], radius: 8, sides: 6, stacks: 4 }).solids,
    );
  });

  it("says what it costs, because a sphere is eight brushes and not one", () => {
    const { notes } = build({
      shape: "sphere",
      centre: [0, 0, 0],
      radius: 128,
      sides: 12,
      stacks: 8,
    });
    expect(notes.join(" ")).toMatch(/8 brushes/);
    expect(notes.join(" ")).toMatch(/prop_static/);
  });
});

describe("torus", () => {
  it("is one brush per segment, and every one is valid", () => {
    const { solids } = build({
      shape: "torus",
      centre: [0, 0, 0],
      majorRadius: 192,
      minorRadius: 48,
      majorSegments: 12,
      minorSides: 8,
    });
    expect(solids).toHaveLength(12);
    everyBrushIsValid(solids);
  });

  it("keeps the hole in the middle", () => {
    const { solids } = build({
      shape: "torus",
      centre: [0, 0, 0],
      majorRadius: 192,
      minorRadius: 48,
      majorSegments: 12,
      minorSides: 8,
    });
    for (const s of solids) {
      for (const v of s.vertices) {
        const r = Math.hypot(v[0], v[1]);
        expect(r, "a corner fell into the hole").toBeGreaterThan(140);
        expect(r).toBeLessThan(245);
      }
    }
  });

  it("refuses a tube as wide as its own ring, whose segments stop being convex", () => {
    expect(() =>
      expandShape({
        shape: "torus",
        centre: [0, 0, 0],
        majorRadius: 100,
        minorRadius: 100,
        majorSegments: 8,
        minorSides: 8,
      }),
    ).toThrow(/no hole/);
  });
});
