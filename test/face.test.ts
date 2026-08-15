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
import { insertSolids } from "../src/vmf/build.js";
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

  it("keeps the axis pair perpendicular on an oblique face", () => {
    // The distortion this mode exists to remove. Projecting u and v independently onto a
    // sloped plane does not keep them at right angles: on a normal of (0.5, 0.5, 0.707)
    // the projected pair has a dot product of 0.333, which shears the texture visibly.
    // Every test here used axis-aligned faces, where the projection is a no-op, so the
    // fault could not show.
    // A tetrahedron with a corner at the origin: its fourth face has a normal of
    // (1,1,1)/sqrt(3), which has a component along every base axis.
    const sloped = insertSolids(probe(), [
      {
        shape: "convex",
        faces: [
          [[0, 0, 0], [0, 256, 0], [256, 0, 0]],
          [[0, 0, 0], [256, 0, 0], [0, 0, 256]],
          [[0, 0, 0], [0, 0, 256], [0, 256, 0]],
          [[256, 0, 0], [0, 256, 0], [0, 0, 256]],
        ],
      },
    ]);
    const r = alignFaces(sloped.text, { solidIds: sloped.solidIds }, { mode: "face" });
    expect(r.changed.length).toBeGreaterThan(0);

    let oblique = 0;
    for (const solid of read(r.text).filter((x) => sloped.solidIds.includes(x.id ?? -1))) {
      for (const side of solid.sides) {
        const u = side.uaxis!.axis;
        const v = side.vaxis!.axis;
        const n = side.plane!.normal;
        expect(
          Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]),
          `solid ${solid.id}: axes are not perpendicular`,
        ).toBeLessThan(1e-6);
        // And both still lie in the face, or the texture is projected onto it rather than
        // running along it.
        expect(Math.abs(u[0] * n[0] + u[1] * n[1] + u[2] * n[2])).toBeLessThan(1e-6);
        expect(Math.abs(v[0] * n[0] + v[1] * n[1] + v[2] * n[2])).toBeLessThan(1e-6);
        if (Math.abs(n[0]) > 0.01 && Math.abs(n[2]) > 0.01) oblique++;
      }
    }
    expect(oblique, "the fixture must actually have an oblique face").toBeGreaterThan(0);
  });

  it("refuses a repeat of zero rather than writing an infinite scale", () => {
    // Divides through to Infinity, which lands in the .vmf as the literal text and makes
    // parseTextureAxis call the axis unreadable -- a warning the tool's own check ignored.
    expect(() =>
      alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "fit", repeat: [0, 1] }),
    ).toThrow(/positive number of repeats/);
    expect(() =>
      alignFaces(probe(), { solidIds: [FLOOR] }, { mode: "fit", repeat: [1, -2] }),
    ).toThrow(/positive number of repeats/);
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

describe("resolveFaces on a map with no side ids", () => {
  it("tells four walls apart when they are all the same distance from the origin", () => {
    // A box centred on the origin has every wall at the same plane distance. Matching a
    // side block to what the reader measured by distance alone therefore resolved all four
    // to the first, and a material or facing selector edited the wrong faces.
    const centred = insertSolids(probe(), [
      { shape: "box", mins: [-64, -64, -64], maxs: [64, 64, 64] },
    ]);
    const noIds = centred.text
      .split("\n")
      .filter((l, i, all) => {
        // Drop the id of every side block, keeping the solids' own.
        const prev = all[i - 1]?.trim();
        return !(l.trim().startsWith('"id"') && prev === "{" && all[i - 2]?.trim() === "side");
      })
      .join("\n");
    expect(noIds).not.toBe(centred.text);

    const faces = resolveFaces(noIds, { solidIds: centred.solidIds });
    const normals = faces.map((f) => f.side.plane!.normal.map((n) => Math.round(n)).join(" "));
    // Six faces, six different normals. Before the fix the four walls all reported one.
    expect(new Set(normals).size).toBe(6);
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

/**
 * #93. Found in the game, on `hmcp_rotunda`, and only there.
 *
 * A ring of fourteen 22.5° facets aligned with `mode: "face"` — the right call, because `world`
 * squashes a brick on a 22.5° facet by cos 22.5°, fourteen times, each differently. In game the
 * wall read as flat plates, and not because of the lighting: the smoothing groups were working.
 * The **texture** restarted at every seam, because `face` anchors each facet's offset at its
 * own low corner.
 *
 * Both modes are per-face. A curve needs a run: the per-face scale, with each facet's offset
 * carrying on from where its neighbour stopped. That is arithmetic, not judgement.
 */
describe("alignFaces: a texture that runs around an arc (#93)", () => {
  const ROTUNDA = join(FIXTURES, "hmcp_rotunda.vmf");
  const ring = (): string => readFileSync(ROTUNDA, "utf8");

  /** Every vertical brick facet's u offset, in texels. */
  const offsets = (text: string): number[] => {
    const out: number[] = [];
    for (const solid of read(text)) {
      for (const side of solid.sides) {
        if (!side.material.includes("BRICKWALL001A")) continue;
        if (!side.plane || Math.abs(side.plane.normal[2]) > 0.01) continue;
        if (side.uaxis) out.push(Math.round(side.uaxis.offset));
      }
    }
    return out;
  };

  it("gives the facets of a ring offsets that carry on from each other", () => {
    const perFace = offsets(alignFaces(ring(), { material: "BRICKWALL001A" }, { mode: "face" }).text);
    const arc = offsets(alignFaces(ring(), { material: "BRICKWALL001A" }, { mode: "arc" }).text);

    expect(perFace.length).toBeGreaterThan(20);
    expect(arc.length).toBe(perFace.length);

    // The defect and the fix in one comparison: `face` anchors every facet at its own corner,
    // so the offsets collapse onto a handful of values. `arc` spreads them along the run.
    expect(new Set(arc).size).toBeGreaterThan(new Set(perFace).size);
  });

  it("reports how many runs it found rather than pretending the ring is closed", () => {
    // The rotunda's ring has two doorways cut in it, so it is two arcs. Saying so is the point:
    // refusing it would refuse the case this was built for.
    const r = alignFaces(ring(), { material: "BRICKWALL001A" }, { mode: "arc" });
    expect(r.warnings.join(" ")).toMatch(/run\(s\)/);
  });

  it("leaves a lone box exactly where face mode puts it", () => {
    // Every face of a box turns 90 degrees from its neighbours, and a corner is not a curve:
    // six runs of one, each anchored at its own corner, which is face mode exactly.
    //
    // The probe itself is six slabs that touch, and there `arc` does differ -- two coplanar
    // faces meeting edge to edge are one surface and a texture should run across them. That
    // is the feature working, not a regression, so the claim is tested on the shape it is
    // about.
    const lone = insertSolids(
      'versioninfo\n{\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n',
      [{ shape: "box", mins: [0, 0, 0], maxs: [128, 128, 128] }],
      { material: "BRICK/BRICKWALL014A" },
    ).text;
    expect(alignFaces(lone, {}, { mode: "arc" }).text).toBe(
      alignFaces(lone, {}, { mode: "face" }).text,
    );
  });
});
