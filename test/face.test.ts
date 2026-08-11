import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alignFaces,
  normaliseMaterial,
  resolveFaces,
  setFaceMaterial,
  setSmoothingGroups,
  VmfFaceError,
} from "../src/vmf/face.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck, Vec3 } from "../src/vmf/solid.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const FLOOR = 7;
const ALL_FACES = 36;

describe("resolveFaces", () => {
  it("finds every face of the map when nothing narrows it", () => {
    expect(resolveFaces(probe(), {})).toHaveLength(ALL_FACES);
  });

  it("narrows by solid, by facing and by material", () => {
    expect(resolveFaces(probe(), { solidIds: [FLOOR] })).toHaveLength(6);
    // Six brushes, each with one face pointing up.
    expect(resolveFaces(probe(), { facing: "up" })).toHaveLength(6);
    expect(resolveFaces(probe(), { material: "DEV" })).toHaveLength(ALL_FACES);
    expect(resolveFaces(probe(), { material: "brick" })).toHaveLength(0);
  });

  it("lines each side block up with what the reader measured for it", () => {
    for (const face of resolveFaces(probe(), {})) {
      expect(face.side.plane, `solid ${face.solidId}`).not.toBeNull();
      expect(face.side.vertices.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("setFaceMaterial", () => {
  it("changes only the faces it was given", () => {
    const r = setFaceMaterial(probe(), { solidIds: [FLOOR], facing: "up" }, "BRICK/BRICKWALL001A");
    expect(r.matched).toBe(1);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]!.to).toBe("BRICK/BRICKWALL001A");

    const after = read(r.text);
    const changed = after
      .flatMap((s) => s.sides)
      .filter((s) => s.material === "BRICK/BRICKWALL001A");
    expect(changed).toHaveLength(1);
  });

  it("leaves the geometry exactly as it was", () => {
    const before = read(probe());
    const r = setFaceMaterial(probe(), {}, "BRICK/BRICKWALL001A");
    const after = read(r.text);
    expect(after).toHaveLength(before.length);
    for (const b of before) {
      const a = after.find((s) => s.id === b.id)!;
      expect(a.volume, `solid ${b.id}`).toBe(b.volume);
      expect(a.valid).toBe(true);
    }
  });

  it("writes the name the way a .vmf stores it, whatever form it arrives in", () => {
    // A caller holding a path from read_map_dependencies has all three of the wrong
    // things: the prefix, the suffix, and the wrong case. vbsp resolves the name
    // literally, so the result would be purple checkerboard nobody sees until a player does.
    expect(normaliseMaterial("materials/brick/brickwall001a.vmt")).toBe("BRICK/BRICKWALL001A");
    expect(normaliseMaterial("brick\\brickwall001a")).toBe("BRICK/BRICKWALL001A");
    expect(normaliseMaterial("  /BRICK/BRICKWALL001A  ")).toBe("BRICK/BRICKWALL001A");

    const r = setFaceMaterial(probe(), { solidIds: [FLOOR] }, "materials/brick/wall.vmt");
    expect(r.changed[0]!.to).toBe("BRICK/WALL");
  });

  it("writes nothing when every face already carries the material", () => {
    const r = setFaceMaterial(probe(), {}, "DEV/DEV_MEASUREGENERIC01");
    expect(r.matched).toBe(ALL_FACES);
    expect(r.changed).toHaveLength(0);
    expect(r.unchanged).toBe(true);
    expect(r.text).toBe(probe());
  });

  it("says so when a tool texture is being applied on purpose or by accident", () => {
    const r = setFaceMaterial(probe(), { solidIds: [FLOOR] }, "TOOLS/TOOLSSKIP");
    expect(r.warnings.join(" ")).toMatch(/tool texture/);
  });

  it("refuses an empty name", () => {
    expect(() => setFaceMaterial(probe(), {}, "   ")).toThrow(VmfFaceError);
  });
});

describe("alignFaces: the oracle that compiled and booted", () => {
  /**
   * The six texture-axis pairs `test/fixtures/gen_probe.py` writes by hand, transcribed
   * from that file. The fixture has been through a real compile and a real srcds boot,
   * which is what makes it an oracle rather than a second opinion: aligning to world must
   * reproduce them exactly, on all six faces, for all six brushes.
   */
  const HAND_WRITTEN: Array<{ normal: Vec3; u: Vec3; v: Vec3 }> = [
    { normal: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    { normal: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
    { normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { normal: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
    { normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
  ];
  const expected = (n: Vec3): { u: Vec3; v: Vec3 } =>
    HAND_WRITTEN.find(
      (h) => Math.abs(h.normal[0] - n[0]) + Math.abs(h.normal[1] - n[1]) + Math.abs(h.normal[2] - n[2]) < 1e-6,
    )!;

  it("reproduces every axis the fixture states by hand", () => {
    const r = alignFaces(probe(), {}, { mode: "world" });
    expect(r.matched).toBe(ALL_FACES);
    let checked = 0;
    for (const solid of read(r.text)) {
      for (const side of solid.sides) {
        const want = expected(side.plane!.normal);
        for (let a = 0; a < 3; a++) {
          expect(side.uaxis!.axis[a], `solid ${solid.id} u`).toBeCloseTo(want.u[a]!);
          expect(side.vaxis!.axis[a], `solid ${solid.id} v`).toBeCloseTo(want.v[a]!);
        }
        checked++;
      }
    }
    expect(checked).toBe(ALL_FACES);
  });

  it("puts the texture's origin on the face, not wherever it was before", () => {
    // Carrying the old offset over is the single most common way an alignment tool
    // produces a map that compiles and looks wrong. The low corner of the face must land
    // on texture coordinate zero.
    const r = alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "world" });
    const floor = read(r.text).find((s) => s.id === FLOOR)!;
    for (const side of floor.sides) {
      const u = side.uaxis!;
      const coords = side.vertices.map(
        (w) => (w[0] * u.axis[0] + w[1] * u.axis[1] + w[2] * u.axis[2]) / u.scale + u.offset,
      );
      expect(Math.min(...coords), "the face starts at texel zero").toBeCloseTo(0);
    }
  });

  it("leaves the geometry alone", () => {
    const before = read(probe());
    const after = read(alignFaces(probe(), {}, { mode: "world" }).text);
    for (const b of before) {
      expect(after.find((s) => s.id === b.id)!.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });
});

describe("alignFaces: the other modes", () => {
  it("agrees with world mode on an axis-aligned face, because there is nothing to project", () => {
    const world = alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "world" }).text;
    const face = alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "face" }).text;
    expect(face).toBe(world);
  });

  it("makes the texture span the face exactly when told to fit", () => {
    const r = alignFaces(probe(), { solidIds: [FLOOR], facing: "up" }, { mode: "fit" });
    expect(r.changed).toHaveLength(1);
    const floor = read(r.text).find((s) => s.id === FLOOR)!;
    const top = floor.sides.find((s) => s.plane!.normal[2] > 0.9)!;
    const u = top.uaxis!;
    const coords = top.vertices.map(
      (w) => (w[0] * u.axis[0] + w[1] * u.axis[1] + w[2] * u.axis[2]) / u.scale + u.offset,
    );
    // One repeat across the face: zero at one edge, one texture width at the other.
    expect(Math.min(...coords)).toBeCloseTo(0);
    expect(Math.max(...coords)).toBeCloseTo(512);
  });

  it("repeats the texture the number of times it was asked for", () => {
    const r = alignFaces(
      probe(),
      { solidIds: [FLOOR], facing: "up" },
      { mode: "fit", repeat: [4, 4] },
    );
    const top = read(r.text)
      .find((s) => s.id === FLOOR)!
      .sides.find((s) => s.plane!.normal[2] > 0.9)!;
    const u = top.uaxis!;
    const coords = top.vertices.map(
      (w) => (w[0] * u.axis[0] + w[1] * u.axis[1] + w[2] * u.axis[2]) / u.scale + u.offset,
    );
    expect(Math.max(...coords)).toBeCloseTo(512 * 4);
  });

  it("says out loud that fit assumed a texture size it could not read", () => {
    const r = alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "fit" });
    expect(r.warnings.join(" ")).toMatch(/assumes a 512-texel texture/);
  });

  it("turns the axis pair inside the face's own plane", () => {
    const r = alignFaces(probe(), { solidIds: [FLOOR], facing: "up" }, {
      mode: "world",
      rotate: 90,
    });
    const top = read(r.text)
      .find((s) => s.id === FLOOR)!
      .sides.find((s) => s.plane!.normal[2] > 0.9)!;
    // World mode gives u = (1,0,0) and v = (0,-1,0) on a floor; a quarter turn swaps them.
    expect(top.uaxis!.axis[1]).toBeCloseTo(-1);
    expect(top.vaxis!.axis[0]).toBeCloseTo(-1);
    // Still perpendicular, and still in the plane.
    const u = top.uaxis!.axis;
    const v = top.vaxis!.axis;
    expect(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]).toBeCloseTo(0);
    expect(u[2]).toBeCloseTo(0);
  });

  it("multiplies both scales, rather than replacing them", () => {
    // The probe's faces sit at 0.25, so halving gives 0.125. Replacing would give 0.5 and
    // would quietly discard whatever the mapper had set.
    const r = alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "world", scale: 0.5 });
    const floor = read(r.text).find((s) => s.id === FLOOR)!;
    for (const side of floor.sides) expect(side.uaxis!.scale).toBeCloseTo(0.125);
  });

  it("refuses a scale of zero, which vbsp refuses outright", () => {
    expect(() => alignFaces(probe(), {}, { mode: "world", scale: 0 })).toThrow(VmfFaceError);
  });

  it("leaves a displaced face alone and says why", () => {
    const withDisp = probe().replace(
      '\t\t\t"smoothing_groups" "0"',
      '\t\t\t"smoothing_groups" "0"\n\t\t\tdispinfo\n\t\t\t{\n\t\t\t\t"power" "3"\n\t\t\t}',
    );
    const r = alignFaces(withDisp, {}, { mode: "world" });
    expect(r.warnings.join(" ")).toMatch(/displacement/);
    expect(r.changed.length).toBe(ALL_FACES - 1);
  });
});

describe("setSmoothingGroups", () => {
  it("stores the bitmask Hammer's dialog means", () => {
    // Hammer numbers the groups 1 to 32; the file counts bits from zero. Group 1 is bit 0.
    expect(setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [1]).groups).toBe(1);
    expect(setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [2]).groups).toBe(2);
    expect(setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [13]).groups).toBe(4096);
    expect(setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [1, 2, 13]).groups).toBe(4099);
    expect(setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [32]).groups).toBe(2 ** 31);
  });

  it("writes it onto the faces, and clears it when given none", () => {
    const on = setSmoothingGroups(probe(), { solidIds: [FLOOR] }, [3]);
    expect(on.changed).toHaveLength(6);
    expect(on.text).toContain('"smoothing_groups" "4"');

    const off = setSmoothingGroups(on.text, { solidIds: [FLOOR] }, []);
    expect(off.groups).toBe(0);
    expect(off.text).toBe(probe());
  });

  it("refuses a group Hammer does not have", () => {
    expect(() => setSmoothingGroups(probe(), {}, [0])).toThrow(VmfFaceError);
    expect(() => setSmoothingGroups(probe(), {}, [33])).toThrow(VmfFaceError);
  });

  it("says so when a group of one face was set, which vrad cannot use", () => {
    const r = setSmoothingGroups(probe(), { solidIds: [FLOOR], facing: "up" }, [1]);
    expect(r.warnings.join(" ")).toMatch(/group of one/);
  });
});

describe("the file around a face edit", () => {
  it("changes only the lines it had to", () => {
    const before = probe();
    const after = setFaceMaterial(before, { solidIds: [FLOOR] }, "BRICK/WALL").text;
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    const changed = a.map((l, i) => [l, b[i]!] as const).filter(([x, y]) => x !== y);
    for (const [line] of changed) expect(line.trim()).toMatch(/^"material"/);
    expect(changed).toHaveLength(6);
  });

  it("keeps the comments and blank lines a reserialiser would drop", () => {
    const source = `// hand-written\n${probe()}\n\n// trailing\n`;
    const after = alignFaces(source, { solidIds: [FLOOR] }, { mode: "world" }).text;
    expect(after.startsWith("// hand-written")).toBe(true);
    expect(after.endsWith("// trailing\n")).toBe(true);
  });
});
