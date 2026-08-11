import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck, Vec3 } from "../src/vmf/solid.js";
import { moveVertices, VmfVertexError } from "../src/vmf/vertex.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const byId = (text: string, id: number): SolidCheck => read(text).find((s) => s.id === id)!;

/** The probe's floor: -288..288 in x and y, -32..0 in z. */
const FLOOR = 7;

/** The two corners of the floor's top eastern edge. */
const EAST_TOP: [Vec3, Vec3] = [
  [288, -288, 0],
  [288, 288, 0],
];

describe("moveVertices: a move every face survives", () => {
  /**
   * Dropping one whole edge of the top face turns the slab into a wedge. Every face stays
   * flat: the top tilts, the two side faces keep the corner inside their own plane because
   * it moves along z and they contain z, and the rest do not touch it.
   */
  const tilt = (dz: number): ReturnType<typeof moveVertices> =>
    moveVertices(probe(), FLOOR, [
      { from: EAST_TOP[0], to: [288, -288, dz] },
      { from: EAST_TOP[1], to: [288, 288, dz] },
    ]);

  it("tilts a slab into a wedge and leaves a valid brush", () => {
    const r = tilt(-16);
    expect(r.moved).toBe(2);
    expect(r.worstPlanarityError).toBeLessThan(0.01);

    const after = byId(r.text, FLOOR);
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(after.sides).toHaveLength(6);
    expect(after.vertices).toHaveLength(8);
  });

  it("puts the corners exactly where they were asked to go", () => {
    const after = byId(tilt(-16).text, FLOOR);
    for (const want of [
      [288, -288, -16],
      [288, 288, -16],
    ] as Vec3[]) {
      const hit = after.vertices.find(
        (v) => Math.abs(v[0] - want[0]) < 0.01 && Math.abs(v[1] - want[1]) < 0.01 && Math.abs(v[2] - want[2]) < 0.01,
      );
      expect(hit, `no corner at (${want.join(" ")})`).toBeDefined();
    }
    // And the corners nobody moved are still where they were.
    expect(after.vertices.some((v) => v[0] === -288 && v[1] === -288 && v[2] === 0)).toBe(true);
  });

  it("takes the volume the new shape really has, not the one it had", () => {
    const before = byId(probe(), FLOOR);
    const r = tilt(-16);
    // A slab 576 x 576 x 32 loses a wedge 576 x 576 x 16, halved: 2 654 208 cubic units.
    expect(r.volumeBefore).toBe(before.volume);
    expect(r.volumeAfter).toBeCloseTo(before.volume - (576 * 576 * 16) / 2, 0);
    expect(byId(r.text, FLOOR).volume).toBeCloseTo(r.volumeAfter, 0);
  });

  it("leaves every other brush exactly as it was", () => {
    const before = read(probe());
    const after = read(tilt(-16).text);
    for (const b of before.filter((s) => s.id !== FLOOR)) {
      expect(after.find((s) => s.id === b.id)!.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });

  it("leaves the materials and texture axes alone, as Hammer does", () => {
    // The plane under a face moves; the projection onto it does not, so the texture slides
    // with the geometry. Rewriting the axes here would be a second, unasked-for edit.
    const before = byId(probe(), FLOOR);
    const after = byId(tilt(-16).text, FLOOR);
    expect(after.sides.map((s) => s.material)).toEqual(before.sides.map((s) => s.material));
    for (let i = 0; i < after.sides.length; i++) {
      expect(after.sides[i]!.uaxis!.axis, `side ${i}`).toEqual(before.sides[i]!.uaxis!.axis);
    }
  });

  it("changes only the plane lines", () => {
    const a = probe().split("\n");
    const b = tilt(-16).text.split("\n");
    expect(b).toHaveLength(a.length);
    const changed = a.map((l, i) => [l, b[i]!] as const).filter(([x, y]) => x !== y);
    for (const [line] of changed) expect(line.trim()).toMatch(/^"plane"/);
    // Four of the six faces own a moved corner; the west face and the bottom do not.
    expect(changed).toHaveLength(4);
  });
});

describe("moveVertices: the refusals, which are parity with Hammer and not a shortfall", () => {
  it("refuses a single corner pulled off the planes it belongs to", () => {
    // The central case. A corner of a box sits on three faces at once, so moving it
    // diagonally leaves each of them with a fourth point off its own plane. Hammer shows
    // this as a red invalid solid and will not build it either.
    expect(() =>
      moveVertices(probe(), FLOOR, [{ from: [288, 288, 0], to: [200, 200, 0] }]),
    ).toThrow(/out of plane/);
  });

  it("refuses a corner slid along one edge, for the same reason", () => {
    // Tempting, and still wrong: moving down the vertical edge keeps the two side faces
    // happy and leaves the top face with one corner below it.
    expect(() =>
      moveVertices(probe(), FLOOR, [{ from: [288, 288, 0], to: [288, 288, -16] }]),
    ).toThrow(/out of plane/);
  });

  it("names the corners it does have when given one it does not", () => {
    // A caller who mistypes a coordinate must hear about it, not watch nothing happen.
    expect(() =>
      moveVertices(probe(), FLOOR, [{ from: [1, 2, 3], to: [4, 5, 6] }]),
    ).toThrow(/is not a corner of solid 7/);
  });

  it("refuses the same corner named twice", () => {
    expect(() =>
      moveVertices(probe(), FLOOR, [
        { from: [288, 288, 0], to: [288, 288, -16] },
        { from: [288, 288, 0], to: [288, 288, -8] },
      ]),
    ).toThrow(/named twice/);
  });

  it("refuses an empty move list", () => {
    expect(() => moveVertices(probe(), FLOOR, [])).toThrow(VmfVertexError);
  });

  it("refuses a solid that is not in the map", () => {
    expect(() =>
      moveVertices(probe(), 9999, [{ from: [288, 288, 0], to: [288, 288, -1] }]),
    ).toThrow(/no solid with id 9999/);
  });

  it("refuses a brush carrying a displacement", () => {
    const withDisp = probe().replace(
      '\t\t\t"smoothing_groups" "0"',
      '\t\t\t"smoothing_groups" "0"\n\t\t\tdispinfo\n\t\t\t{\n\t\t\t\t"power" "3"\n\t\t\t}',
    );
    expect(() =>
      moveVertices(withDisp, FLOOR, [
        { from: EAST_TOP[0], to: [288, -288, -16] },
        { from: EAST_TOP[1], to: [288, 288, -16] },
      ]),
    ).toThrow(/displacement/);
  });

  it("refuses a move where every face stays flat but the planes stop meeting there", () => {
    // The subtle one, and the only thing that catches it is going planes -> hull, the
    // opposite way from the rewrite. Pulling the top eastern edge down past the bottom
    // face leaves every face individually planar -- the top merely tilts further -- while
    // the tilted top plane now crosses the bottom plane inside the brush. The shape the
    // planes really enclose is not the shape that was asked for.
    expect(() =>
      moveVertices(probe(), FLOOR, [
        { from: EAST_TOP[0], to: [288, -288, -64] },
        { from: EAST_TOP[1], to: [288, 288, -64] },
      ]),
    ).toThrow(/corners where it had|do not\s+meet there/);
  });

  it("refuses a move that collapses a face to a line", () => {
    // Pulling both corners of the top eastern edge all the way down to the bottom face
    // leaves the east face with no height at all.
    expect(() =>
      moveVertices(probe(), FLOOR, [
        { from: EAST_TOP[0], to: [288, -288, -32] },
        { from: EAST_TOP[1], to: [288, 288, -32] },
      ]),
    ).toThrow(/in a line|no area|corners where it had/);
  });
});

describe("moveVertices: tolerance", () => {
  it("accepts a corner named to within half a unit, because JSON rounds", () => {
    const r = moveVertices(probe(), FLOOR, [
      { from: [288.2, -287.8, 0.1], to: [288, -288, -16] },
      { from: [287.9, 288.1, -0.2], to: [288, 288, -16] },
    ]);
    expect(r.moved).toBe(2);
  });

  it("does not accept one that is merely nearby", () => {
    expect(() =>
      moveVertices(probe(), FLOOR, [{ from: [280, -280, 0], to: [288, -288, -16] }]),
    ).toThrow(/is not a corner/);
  });
});
