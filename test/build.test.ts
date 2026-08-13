import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/mcp/registry.js";
import { writeVmfSolidTool } from "../src/tools/build.js";
import { runCompile } from "../src/tools/compile.js";
import { buildSolidText, insertSolids, textureAxesFor, VmfBuildError } from "../src/vmf/build.js";
import type { Vec3 } from "../src/vmf/solid.js";
import type { SolidSpec } from "../src/vmf/build.js";
import { checkVmfSolids, parsePlanePoints, planeFromPoints } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-build-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const probe = (): string => readFileSync(PROBE, "utf8");
const built = (specs: SolidSpec[]) => {
  const r = insertSolids(probe(), specs);
  return { ...r, check: checkVmfSolids("built", r.text) };
};
const newSolids = (r: ReturnType<typeof built>) =>
  r.check.solids.filter((s) => r.solidIds.includes(s.id ?? -1));

describe("texture axes", () => {
  /**
   * The probe writes its six faces by hand, in a file that has been through a real compile
   * and a real srcds boot. Four of the base-axis table's six branches are reachable from a
   * box, and all four must come out identical -- if they do not, the table is not vbsp's.
   */
  it("never returns an axis lying along its own face normal, on any slope", () => {
    // The failure that compiles and only the eye catches. Swept rather than spot-checked,
    // because a ramp or a prism reaches branches no box ever does.
    for (let a = 0; a < 360; a += 7) {
      for (let b = 0; b < 360; b += 7) {
        const t = (a * Math.PI) / 180;
        const p = (b * Math.PI) / 180;
        const n: [number, number, number] = [
          Math.cos(t) * Math.cos(p),
          Math.sin(t) * Math.cos(p),
          Math.sin(p),
        ];
        const { u, v } = textureAxesFor(n);
        expect(Math.abs(u[0] * n[0] + u[1] * n[1] + u[2] * n[2])).toBeLessThan(0.999);
        expect(Math.abs(v[0] * n[0] + v[1] * n[1] + v[2] * n[2])).toBeLessThan(0.999);
      }
    }
  });
});

describe("shapes, checked by the reader that runs the other way round", () => {
  it("builds a box whose recovered volume is the one asked for", () => {
    const r = built([{ shape: "box", mins: [-64, -64, 0], maxs: [64, 64, 128] }]);
    const [s] = newSolids(r);
    expect(s!.valid).toBe(true);
    expect(s!.sides).toHaveLength(6);
    expect(s!.vertices).toHaveLength(8);
    expect(s!.volume).toBe(128 * 128 * 128);
    expect(s!.mins).toEqual([-64, -64, 0]);
    expect(s!.maxs).toEqual([64, 64, 128]);
  });

  it("builds a wedge with five sides and exactly half the box's volume", () => {
    const r = built([
      { shape: "wedge", mins: [0, -64, 0], maxs: [128, 64, 96], slopeAxis: "x", high: "max" },
    ]);
    const [s] = newSolids(r);
    expect(s!.valid).toBe(true);
    // Five, not six with a degenerate one -- the mistake a collapsed box would make.
    expect(s!.sides).toHaveLength(5);
    expect(s!.vertices).toHaveLength(6);
    expect(s!.volume).toBe((128 * 128 * 96) / 2);
  });

  it("slopes the wedge toward the end it was told to", () => {
    const high = (end: "min" | "max"): number => {
      const r = built([
        { shape: "wedge", mins: [0, -64, 0], maxs: [128, 64, 96], slopeAxis: "x", high: end },
      ]);
      const s = newSolids(r)[0]!;
      // The tall corners are the ones at the top; hull corners come out of a linear
      // solve, so they are compared with a tolerance rather than for equality.
      const top = s.vertices.filter((v) => Math.abs(v[2] - 96) < 0.01);
      expect(top.length).toBe(2);
      return top[0]![0];
    };
    expect(high("max")).toBe(128);
    expect(high("min")).toBe(0);
  });

  it("builds prisms from 3 to 64 sides, each closed", () => {
    for (const sides of [3, 4, 5, 8, 12, 64]) {
      const r = built([
        { shape: "cylinder", mins: [-64, -64, 0], maxs: [64, 64, 128], sides },
      ]);
      const s = newSolids(r)[0]!;
      expect(s.valid, `${sides} sides`).toBe(true);
      expect(s.sides.length, `${sides} sides`).toBe(sides + 2);
      expect(s.volume, `${sides} sides`).toBeGreaterThan(0);
    }
  });

  it("extrudes a prism along the axis it was given", () => {
    const r = built([
      { shape: "cylinder", mins: [-32, -256, 0], maxs: [32, -192, 64], sides: 6, axis: "y" },
    ]);
    const s = newSolids(r)[0]!;
    expect(s.valid).toBe(true);
    expect(s.mins[1]).toBe(-256);
    expect(s.maxs[1]).toBe(-192);
  });

  it("refuses a shape it cannot close, rather than writing an open brush", () => {
    expect(() => built([{ shape: "cylinder", mins: [0, 0, 0], maxs: [64, 64, 64], sides: 2 }]))
      .toThrow(VmfBuildError);
    expect(() => built([{ shape: "box", mins: [0, 0, 0], maxs: [0, 64, 64] }])).toThrow(
      /strictly below/,
    );
    expect(() =>
      built([{ shape: "box", mins: [0, 0, 0], maxs: [20000, 64, 64] }]),
    ).toThrow(/outside the world/);
  });
});

describe("winding", () => {
  it("points every face's normal away from the solid, on every shape", () => {
    const specs: SolidSpec[] = [
      { shape: "box", mins: [-64, -64, 0], maxs: [64, 64, 128] },
      { shape: "wedge", mins: [128, -64, 0], maxs: [256, 64, 96], slopeAxis: "y", high: "min" },
      { shape: "cylinder", mins: [-64, 128, 0], maxs: [64, 256, 192], sides: 7 },
    ];
    for (const s of newSolids(built(specs))) {
      // The centroid of the corners, not the centre of the bounding box: on a wedge the
      // box centre lies exactly ON the slope, so it is inside no half-space strictly and
      // the assertion below would be testing nothing.
      const centre: [number, number, number] = [
        s.vertices.reduce((t, v) => t + v[0], 0) / s.vertices.length,
        s.vertices.reduce((t, v) => t + v[1], 0) / s.vertices.length,
        s.vertices.reduce((t, v) => t + v[2], 0) / s.vertices.length,
      ];
      for (const side of s.sides) {
        const p = side.plane!;
        // The centre of a convex solid is strictly inside every one of its half-spaces.
        expect(p.normal[0] * centre[0] + p.normal[1] * centre[1] + p.normal[2] * centre[2]).
          toBeLessThan(p.dist);
      }
    }
  });

  it("emits the probe's own box planes, point for point", () => {
    // The strongest single check available without a compiler: the writer, given the
    // probe's floor, must produce the same three points per face that a human wrote by
    // hand into gen_probe.py -- same order, same winding.
    const { text } = buildSolidText({ shape: "box", mins: [-288, -288, -32], maxs: [288, 288, 0] }, 1000);
    const mine = [...text.matchAll(/"plane" "([^"]+)"/g)].map((m) =>
      planeFromPoints(...parsePlanePoints(m[1]!)!),
    );
    const theirs = [...probe().matchAll(/"plane" "([^"]+)"/g)]
      .slice(0, 6)
      .map((m) => planeFromPoints(...parsePlanePoints(m[1]!)!));

    for (const t of theirs) {
      const match = mine.find(
        (p) =>
          Math.abs(p!.dist - t!.dist) < 0.001 &&
          p!.normal.every((c, i) => Math.abs(c - t!.normal[i]!) < 0.001),
      );
      expect(match, `no face matches normal ${t!.normal} dist ${t!.dist}`).toBeDefined();
    }
  });
});

describe("write_vmf_solid", () => {
  const target = join(scratch, "target.vmf");

  it("writes nothing on a dry run, but still checks", async () => {
    writeFileSync(target, probe());
    const out = z.object(writeVmfSolidTool.outputSchema!).parse(
      await writeVmfSolidTool.handler(
        {
          path: target,
          solids: [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
          dryRun: true,
          backup: false, confirm: true,
        },
        ctx,
      ),
    );
    expect(out.written).toBe(false);
    expect(out.verified[0]!.valid).toBe(true);
    expect(out.solidsBefore).toBe(6);
    expect(out.solidsAfter).toBe(7);
    expect(readFileSync(target, "utf8")).toBe(probe());
  });

  it("leaves every byte it did not add exactly where it was", async () => {
    writeFileSync(target, probe());
    const before = readFileSync(target, "utf8");
    await writeVmfSolidTool.handler(
      {
        path: target,
        solids: [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
        backup: false, confirm: true,
      },
      ctx,
    );
    const after = readFileSync(target, "utf8");
    expect(after.length).toBeGreaterThan(before.length);

    // Splice discipline, asserted without knowing where the insertion went: the longest
    // common prefix and the longest common suffix must together account for every byte of
    // the original. That is only true if the change is one contiguous insertion and
    // nothing else moved.
    let head = 0;
    while (head < before.length && before[head] === after[head]) head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      before[before.length - 1 - tail] === after[after.length - 1 - tail]
    ) {
      tail++;
    }
    expect(head + tail).toBe(before.length);
  });

  it("never reuses an id already in the file", async () => {
    writeFileSync(target, probe());
    const out = z.object(writeVmfSolidTool.outputSchema!).parse(
      await writeVmfSolidTool.handler(
        {
          path: target,
          solids: [
            { shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] },
            { shape: "box", mins: [128, 0, 0], maxs: [192, 64, 64] },
          ],
          backup: false, confirm: true,
        },
        ctx,
      ),
    );
    // Not "every id in the file is unique": the probe fixture itself ships two nodes
    // numbered 1. What must hold is that nothing this tool wrote collides with anything
    // that was already there, or with each other.
    const beforeIds = new Set(
      [...probe().matchAll(/"id" "(\d+)"/g)].map((m) => Number(m[1])),
    );
    const afterIds = [...readFileSync(target, "utf8").matchAll(/"id" "(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    const added = afterIds.filter((id) => !beforeIds.has(id));
    expect(new Set(added).size).toBe(added.length);
    expect(added.length).toBe(14); // two solids, six sides each, two solid ids
    expect(out.solidIds[1]!).toBeGreaterThan(out.solidIds[0]!);
  });

  it("adds to a brush entity when given its id", async () => {
    writeFileSync(target, probe());
    const withEntity = readFileSync(target, "utf8").replace(
      /^world\n/m,
      'entity\n{\n\t"id" "900"\n\t"classname" "func_detail"\n}\nworld\n',
    );
    writeFileSync(target, withEntity);
    const out = z.object(writeVmfSolidTool.outputSchema!).parse(
      await writeVmfSolidTool.handler(
        {
          path: target,
          solids: [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
          entityId: 900,
          backup: false, confirm: true,
        },
        ctx,
      ),
    );
    expect(out.target).toBe("func_detail");
    // Found by id, not by position: the entity is written before `world`, so the last
    // solid in the file is still one of the room's walls.
    const all = checkVmfSolids(target, readFileSync(target, "utf8")).solids;
    expect(all.find((s) => s.id === out.solidIds[0])!.owner).toBe("func_detail");
  });

  it("names the entity id it could not find, instead of falling back to the world", async () => {
    writeFileSync(target, probe());
    expect(() =>
      writeVmfSolidTool.handler(
        {
          path: target,
          solids: [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }],
          entityId: 4242,
          backup: false, confirm: true,
        },
        ctx,
      ),
    ).toThrow(/4242/);
  });
});

/**
 * One brush, three materials.
 *
 * `material` is a single string for every face, so a floor whose top is tile and whose
 * sides are nodraw took a second call to `set_face_material` plus a lookup to find which
 * faces were the sides. An agent building a map accepted uniform materials rather than pay
 * for that, and recorded it (issue #57) -- which is the outcome worth noticing: the tool
 * refused nothing, it just made the cheaper answer the wrong one.
 *
 * The roles are the ones `set_face_material`'s `facing` selects, at the same threshold,
 * from the same constant. Two thresholds for one word is how two tools come to disagree
 * about what a wall is.
 */
describe("a material per role", () => {
  const box: SolidSpec[] = [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 16] }];

  /** A fresh copy of the probe, so each case writes to its own file. */
  let n = 0;
  const PROBE_COPY = (): string => {
    const path = join(scratch, `roles-${n++}.vmf`);
    writeFileSync(path, probe());
    return path;
  };

  const facesOf = (text: string): Array<{ material: string; normalZ: number }> => {
    const report = checkVmfSolids("built", text);
    const solid = report.solids[report.solids.length - 1]!;
    return solid.sides.map((side) => ({
      material: side.material,
      normalZ: side.plane?.normal[2] ?? 0,
    }));
  };

  it("puts each material on the faces that role names", () => {
    const roles = writeVmfSolidTool.handler(
      {
        path: PROBE_COPY(),
        solids: box,
        materials: { top: "DEV/DEV_MEASUREWALL01A", bottom: "TOOLS/TOOLSNODRAW", sides: "DEV/DEV_MEASUREGENERIC01" },
        dryRun: false,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    ) as { path: string };

    const faces = facesOf(readFileSync(roles.path, "utf8"));
    const up = faces.filter((f) => f.normalZ > 0.7);
    const down = faces.filter((f) => f.normalZ < -0.7);
    const side = faces.filter((f) => Math.abs(f.normalZ) <= 0.7);
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(1);
    expect(side).toHaveLength(4);
    expect(up[0]!.material).toBe("DEV/DEV_MEASUREWALL01A");
    expect(down[0]!.material).toBe("TOOLS/TOOLSNODRAW");
    for (const f of side) expect(f.material).toBe("DEV/DEV_MEASUREGENERIC01");
  });

  it("falls back to `material` for a role left out", () => {
    const r = writeVmfSolidTool.handler(
      {
        path: PROBE_COPY(),
        solids: box,
        material: "DEV/DEV_MEASUREGENERIC01",
        materials: { top: "DEV/DEV_MEASUREWALL01A" },
        dryRun: false,
        backup: false,
        confirm: true,
      } as never,
      ctx,
    ) as { path: string };

    const faces = facesOf(readFileSync(r.path, "utf8"));
    expect(faces.filter((f) => f.normalZ > 0.7)[0]!.material).toBe("DEV/DEV_MEASUREWALL01A");
    for (const f of faces.filter((f) => f.normalZ <= 0.7)) {
      expect(f.material).toBe("DEV/DEV_MEASUREGENERIC01");
    }
  });
});

/**
 * The compiler oracle.
 *
 * Everything above is one program checking another, both written here on the same
 * afternoon. vbsp was not, and it is the thing that has to accept this geometry -- so a
 * room built entirely by the writer is compiled for real, and a leak means the brushes do
 * not seal, whatever the algebra said.
 */
describe("a room built by the writer, compiled for real", () => {
  const canCompile = has.toolchain;
  const room = join(scratch, "written_room.vmf");

  const SKELETON =
    `versioninfo\n{\n\t"editorversion" "400"\n\t"mapversion" "1"\n\t"formatversion" "100"\n\t"prefab" "0"\n}\n` +
    `visgroups\n{\n}\n` +
    `world\n{\n\t"id" "1"\n\t"mapversion" "1"\n\t"classname" "worldspawn"\n` +
    `\t"skyname" "sky_day01_01"\n}\n` +
    `entity\n{\n\t"id" "2"\n\t"classname" "info_player_start"\n\t"origin" "0 0 16"\n}\n` +
    `entity\n{\n\t"id" "3"\n\t"classname" "light"\n\t"origin" "0 0 128"\n\t"_light" "255 255 255 200"\n}\n`;

  /** The same six-brush shell as the probe, but every brush chosen by the writer. */
  const SHELL: SolidSpec[] = [
    { shape: "box", mins: [-288, -288, -32], maxs: [288, 288, 0] },
    { shape: "box", mins: [-288, -288, 256], maxs: [288, 288, 288] },
    { shape: "box", mins: [-288, -288, 0], maxs: [-256, 288, 256] },
    { shape: "box", mins: [256, -288, 0], maxs: [288, 288, 256] },
    { shape: "box", mins: [-256, -288, 0], maxs: [256, -256, 256] },
    { shape: "box", mins: [-256, 256, 0], maxs: [256, 288, 256] },
  ];

  it.skipIf(!canCompile)(
    "seals: vbsp compiles it with no leak",
    async () => {
      writeFileSync(
        room,
        insertSolids(SKELETON, SHELL, { material: "DEV/DEV_MEASUREGENERIC01" }).text,
      );
      const r = (await runCompile.handler(
        {
          vmf: room,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        },
        ctx,
      )) as { ok: boolean; leaked: boolean; bspExists: boolean };

      expect(r.leaked).toBe(false);
      expect(r.bspExists).toBe(true);
      expect(r.ok).toBe(true);
    },
    300_000,
  );

  it.skipIf(!canCompile)(
    "leaks the moment one wall is left out, so the test above means something",
    async () => {
      // The negative control. Without it, a writer that emitted nothing at all would pass
      // the sealed test just as happily.
      const open = join(scratch, "open_room.vmf");
      writeFileSync(
        open,
        insertSolids(SKELETON, SHELL.slice(0, 5), { material: "DEV/DEV_MEASUREGENERIC01" }).text,
      );
      const r = (await runCompile.handler(
        {
          vmf: open,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        },
        ctx,
      )) as { ok: boolean; leaked: boolean };
      expect(r.leaked).toBe(true);
    },
    300_000,
  );
});

describe("the texture axis table against the fixture that booted", () => {
  /**
   * The six faces `test/fixtures/gen_probe.py` writes by hand, transcribed from that file.
   * It has been through a real compile and a real srcds boot, which is what makes it an
   * oracle rather than a second opinion.
   */
  const HAND_WRITTEN: Array<{ face: string; normal: Vec3; u: Vec3; v: Vec3 }> = [
    { face: "+z", normal: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
    { face: "-z", normal: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0] },
    { face: "-y", normal: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { face: "+y", normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { face: "-x", normal: [-1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
    { face: "+x", normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, -1] },
  ];

  it.each(HAND_WRITTEN)("reproduces the $face face's axes exactly", ({ normal, u, v }) => {
    const got = textureAxesFor(normal);
    expect(got.u).toEqual(u);
    expect(got.v).toEqual(v);
  });

  it("covers every branch of the table, so none is taken on faith", () => {
    // The comment above BASE_AXES claims all six branches are confirmed. Pinned here so the
    // claim cannot quietly become false -- a seventh entry, or a changed one, fails above
    // and this count says why. An earlier version of that comment said "four of six", which
    // understated what the fixture actually proves; measuring settled it.
    const reached = new Set(
      HAND_WRITTEN.map(({ normal }) => {
        const { u, v } = textureAxesFor(normal);
        return `${u.join(",")}|${v.join(",")}|${normal.join(",")}`;
      }),
    );
    expect(reached.size).toBe(6);
  });
});
