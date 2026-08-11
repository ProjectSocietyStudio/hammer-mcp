import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { applyVmfOps, readEntities } from "../src/vmf/edit.js";
import { deleteSolids, transformSolids, VmfModifyError } from "../src/vmf/modify.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck, Vec3 } from "../src/vmf/solid.js";
import { mirror, rotation, scaling, translation } from "../src/vmf/transform.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const byId = (text: string, id: number): SolidCheck => read(text).find((s) => s.id === id)!;

/** The probe's six world solids: a floor, a ceiling and four walls. */
const ALL = [7, 14, 21, 28, 35, 42];
const WALL = 21;
const ORIGIN: Vec3 = [0, 0, 0];

describe("transformSolids: what must be conserved", () => {
  it("moves a brush by exactly the delta, and changes nothing else about it", () => {
    const before = byId(probe(), WALL);
    const r = transformSolids(probe(), { ids: [WALL] }, translation([512, -256, 64]));
    expect(r.matched).toBe(1);
    const after = byId(r.text, WALL);

    expect(after.volume).toBeCloseTo(before.volume);
    expect(after.valid).toBe(true);
    for (let a = 0; a < 3; a++) {
      expect(after.mins[a]).toBeCloseTo(before.mins[a]! + [512, -256, 64][a]!);
      expect(after.maxs[a]).toBeCloseTo(before.maxs[a]! + [512, -256, 64][a]!);
    }
  });

  it("leaves every solid it did not select exactly as it was", () => {
    const r = transformSolids(probe(), { ids: [WALL] }, translation([512, 0, 0]));
    const before = read(probe());
    const after = read(r.text);
    expect(after).toHaveLength(before.length);
    for (const b of before.filter((s) => s.id !== WALL)) {
      const a = after.find((s) => s.id === b.id)!;
      expect(a.volume, `solid ${b.id}`).toBe(b.volume);
      expect(a.mins, `solid ${b.id}`).toEqual(b.mins);
      expect(a.maxs, `solid ${b.id}`).toEqual(b.maxs);
    }
  });

  it("conserves volume exactly through a quarter turn", () => {
    const before = byId(probe(), WALL);
    const r = transformSolids(probe(), { ids: [WALL] }, rotation([0, 0, 1], 90, ORIGIN));
    const after = byId(r.text, WALL);
    expect(after.volume).toBe(before.volume);
    expect(after.valid).toBe(true);
  });

  it("conserves volume through a turn that lands on no grid, and stays a valid brush", () => {
    // The real test of the planarity trap. 45 degrees puts every corner on a half-integer
    // at best; if the planes came out of step with the corners, read_vmf_solids would fail
    // the solid rather than agreeing with it.
    const before = byId(probe(), WALL);
    const r = transformSolids(probe(), { ids: [WALL] }, rotation([0, 0, 1], 45, ORIGIN));
    const after = byId(r.text, WALL);
    // Relative, not absolute: the volume is 4.7 million cubic units and the plane points
    // are written to four decimals, as everything this repo emits is. The measured error
    // is 3.6 units in 4 718 592, which is 8 parts in ten million.
    expect(Math.abs(after.volume - before.volume) / before.volume).toBeLessThan(1e-5);
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(r.worstPlanarityError).toBeLessThan(0.01);
  });

  it("scales volume by the determinant", () => {
    const before = byId(probe(), WALL);
    const r = transformSolids(probe(), { ids: [WALL] }, scaling([2, 2, 2], ORIGIN), {
      textureLock: false,
    });
    expect(byId(r.text, WALL).volume).toBeCloseTo(before.volume * 8);
  });

  it("survives a mirror, which flips winding, and does not turn the brush inside out", () => {
    // A mirror has a negative determinant: every face's three points now wind the other
    // way. If nothing reversed them, the solid would enclose no volume at all and
    // read_vmf_solids would say unbounded-solid.
    const before = byId(probe(), WALL);
    const r = transformSolids(probe(), { ids: [WALL] }, mirror("x", ORIGIN));
    const after = byId(r.text, WALL);
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(after.volume).toBeCloseTo(before.volume);
    expect(after.mins[0]).toBeCloseTo(-before.maxs[0]!);
  });

  it("returns a brush to itself after four quarter turns", () => {
    let text = probe();
    for (let i = 0; i < 4; i++) {
      text = transformSolids(text, { ids: [WALL] }, rotation([0, 0, 1], 90, ORIGIN)).text;
    }
    const before = byId(probe(), WALL);
    const after = byId(text, WALL);
    expect(after.volume).toBe(before.volume);
    expect(after.mins).toEqual(before.mins);
    expect(after.maxs).toEqual(before.maxs);
  });
});

describe("transformSolids: texture lock", () => {
  const uOf = (s: SolidCheck, i: number): { axis: Vec3; offset: number; scale: number } =>
    s.sides[i]!.uaxis!;

  it("keeps a texture in the same place on a face that moved", () => {
    // The coordinate of a fixed point of the brush must not change. That is what texture
    // lock means, and it is checkable without looking at the map: take a corner, read its
    // texture coordinate before, move it, read it after.
    const before = byId(probe(), WALL);
    const corner = before.vertices[0]!;
    const face = before.sides.findIndex((s) => s.uaxis && s.vertices.length >= 3);
    const u0 = uOf(before, face);
    const coordBefore =
      (u0.axis[0] * corner[0] + u0.axis[1] * corner[1] + u0.axis[2] * corner[2]) / u0.scale +
      u0.offset;

    const delta: Vec3 = [512, -256, 64];
    const r = transformSolids(probe(), { ids: [WALL] }, translation(delta));
    const after = byId(r.text, WALL);
    const moved: Vec3 = [corner[0] + delta[0], corner[1] + delta[1], corner[2] + delta[2]];
    const u1 = uOf(after, face);
    const coordAfter =
      (u1.axis[0] * moved[0] + u1.axis[1] * moved[1] + u1.axis[2] * moved[2]) / u1.scale +
      u1.offset;

    expect(coordAfter).toBeCloseTo(coordBefore, 3);
  });

  it("turns the texture axes with the brush", () => {
    const before = byId(probe(), WALL);
    const face = before.sides.findIndex((s) => s.uaxis);
    const r = transformSolids(probe(), { ids: [WALL] }, rotation([0, 0, 1], 90, ORIGIN));
    const a0 = uOf(before, face).axis;
    const a1 = uOf(byId(r.text, WALL), face).axis;
    // A quarter turn about z sends (x, y) to (-y, x).
    expect(a1[0]).toBeCloseTo(-a0[1]!);
    expect(a1[1]).toBeCloseTo(a0[0]!);
  });

  it("multiplies the texture scale by a uniform scale, so the texture grows with the wall", () => {
    const before = byId(probe(), WALL);
    const face = before.sides.findIndex((s) => s.uaxis);
    const r = transformSolids(probe(), { ids: [WALL] }, scaling([3, 3, 3], ORIGIN));
    expect(uOf(byId(r.text, WALL), face).scale).toBeCloseTo(uOf(before, face).scale * 3);
  });

  it("refuses to lock a texture through a stretch, instead of approximating it", () => {
    // A texture axis pair cannot express the shear a non-uniform scale would need. No
    // compiler reports a wrong texture, so guessing here would be undetectable.
    expect(() =>
      transformSolids(probe(), { ids: [WALL] }, scaling([2, 1, 1], ORIGIN)),
    ).toThrow(/shear/);
    expect(() =>
      transformSolids(probe(), { ids: [WALL] }, scaling([2, 1, 1], ORIGIN), {
        textureLock: false,
      }),
    ).not.toThrow();
  });

  it("says out loud when texture lock is off", () => {
    const r = transformSolids(probe(), { ids: [WALL] }, translation([64, 0, 0]), {
      textureLock: false,
    });
    expect(r.warnings.join(" ")).toMatch(/textureLock is off/);
  });
});

describe("transformSolids: what it refuses", () => {
  it("refuses a selector that names nothing, which would move the whole map", () => {
    expect(() => transformSolids(probe(), {}, translation([1, 0, 0]))).toThrow(
      VmfModifyError,
    );
  });

  it("reports a selector that matched nothing rather than failing", () => {
    const r = transformSolids(probe(), { ids: [9999] }, translation([1, 0, 0]));
    expect(r.matched).toBe(0);
    expect(r.unchanged).toBe(true);
    expect(r.text).toBe(probe());
  });

  it("refuses a brush carrying a displacement", () => {
    // A dispinfo holds its own startposition and per-vertex offsets. Moving the face
    // without them slides the terrain off its own brush, and nothing downstream says so.
    const withDisp = probe().replace(
      '\t\t\t"smoothing_groups" "0"',
      '\t\t\t"smoothing_groups" "0"\n\t\t\tdispinfo\n\t\t\t{\n\t\t\t\t"power" "3"\n\t\t\t}',
    );
    expect(withDisp).not.toBe(probe());
    expect(() => transformSolids(withDisp, { ids: [7] }, translation([1, 0, 0]))).toThrow(
      /displacement/,
    );
  });
});

describe("transformSolids: the file around it", () => {
  it("changes only the lines it had to", () => {
    const before = probe();
    const after = transformSolids(before, { ids: [WALL] }, translation([64, 0, 0])).text;
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    const changed = a.map((line, i) => [line, b[i]!] as const).filter(([x, y]) => x !== y);
    // Every changed line states a plane or a texture axis, and all of them belong to the
    // brush that moved. Ten rather than eighteen because a move along x leaves the texture
    // offset of every face perpendicular to x exactly where it was, and a splice that
    // rewrites a line with the bytes it already had is not a change.
    for (const [line] of changed) expect(line.trim()).toMatch(/^"(plane|uaxis|vaxis)"/);
    expect(changed).toHaveLength(10);
  });

  it("keeps the comments and blank lines a reserialiser would drop", () => {
    const source = `// a comment Hammer never wrote\n${probe()}\n\n// trailing note\n`;
    const after = transformSolids(source, { ids: [WALL] }, translation([64, 0, 0])).text;
    expect(after.startsWith("// a comment Hammer never wrote")).toBe(true);
    expect(after.endsWith("// trailing note\n")).toBe(true);
  });
});

describe("deleteSolids", () => {
  it("removes exactly what was named, and leaves the rest untouched", () => {
    const before = read(probe());
    const r = deleteSolids(probe(), { ids: [WALL] });
    expect(r.matched).toBe(1);
    expect(r.deleted[0]!.id).toBe(WALL);
    expect(r.deleted[0]!.volume).toBeCloseTo(before.find((s) => s.id === WALL)!.volume);

    const after = read(r.text);
    expect(after).toHaveLength(before.length - 1);
    for (const b of before.filter((s) => s.id !== WALL)) {
      const a = after.find((s) => s.id === b.id)!;
      expect(a.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });

  it("leaves no blank line where the brush was", () => {
    const r = deleteSolids(probe(), { ids: [WALL] });
    expect(r.text).not.toMatch(/\n[\t ]+\n[\t ]*solid/);
    expect(r.text.split("\n").filter((l) => l.trim() === "")).toHaveLength(
      probe().split("\n").filter((l) => l.trim() === "").length,
    );
  });

  it("warns when the world has nothing left to seal with", () => {
    const r = deleteSolids(probe(), { ids: ALL });
    expect(r.matched).toBe(6);
    expect(r.worldSolidsAfter).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/leak/);
  });

  it("does not warn when something still holds the hull", () => {
    const r = deleteSolids(probe(), { ids: [WALL] });
    expect(r.worldSolidsAfter).toBe(5);
    expect(r.warnings).toEqual([]);
  });

  it("refuses a selector that names nothing, which would empty the map", () => {
    expect(() => deleteSolids(probe(), {})).toThrow(VmfModifyError);
  });

  it("reports a selector that matched nothing rather than failing", () => {
    const r = deleteSolids(probe(), { ids: [9999] });
    expect(r.matched).toBe(0);
    expect(r.unchanged).toBe(true);
    expect(r.text).toBe(probe());
  });

  it("deletes by material and by box, not only by id", () => {
    expect(deleteSolids(probe(), { material: "DEV" }).matched).toBe(6);
    const wall = byId(probe(), WALL);
    expect(deleteSolids(probe(), { within: { mins: wall.mins, maxs: wall.maxs } }).matched).toBe(
      1,
    );
  });
});

describe("what the compiler says about a moved map", () => {
  const canCompile = has.toolchain;
  const scratch = mkdtempSync(join(tmpdir(), "hammer-modify-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const ctx = sharedCtx as unknown as ToolContext;

  const compile = async (vmf: string): Promise<{ ok: boolean; leaked: boolean }> =>
    (await runCompile.handler(
      {
        vmf,
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

  /**
   * The whole room turned by 45 degrees about its own centre, entities included. Not one
   * corner lands on the grid afterwards, so this is the case the planarity trap was going
   * to break: if the planes came out of step with the corners, vbsp would refuse the brush
   * or the hull would open.
   */
  it.skipIf(!canCompile)(
    "a room turned 45 degrees still seals",
    async () => {
      const turned = join(scratch, "turned.vmf");
      const r = transformSolids(probe(), { owner: "world" }, rotation([0, 0, 1], 45, ORIGIN));
      expect(r.matched).toBe(6);
      for (const s of read(r.text)) {
        expect(s.valid, `solid ${s.id}`).toBe(true);
      }
      writeFileSync(turned, r.text);
      const out = await compile(turned);
      expect(out.leaked).toBe(false);
      expect(out.ok).toBe(true);
    },
    300_000,
  );

  it.skipIf(!canCompile)(
    "and leaks the moment one of its walls is deleted, so the test above means something",
    async () => {
      // The negative control. Without it, a transform that quietly produced a solid block
      // of world would pass the sealed test just as happily.
      const holed = join(scratch, "holed.vmf");
      const turned = transformSolids(probe(), { owner: "world" }, rotation([0, 0, 1], 45, ORIGIN));
      const cut = deleteSolids(turned.text, { ids: [WALL] });
      expect(cut.matched).toBe(1);
      writeFileSync(holed, cut.text);
      expect((await compile(holed)).leaked).toBe(true);
    },
    300_000,
  );

  it.skipIf(!canCompile)(
    "a room moved bodily still seals, and the entities move with it",
    async () => {
      // Moving the brushes without the spawn point would leave it outside the hull, which
      // vbsp reports as a leak from an entity rather than from geometry -- a different
      // failure with a different message, and one worth telling apart.
      const moved = join(scratch, "moved.vmf");
      const delta: Vec3 = [1024, 512, 0];
      const geometry = transformSolids(probe(), { owner: "world" }, translation(delta));
      const withEntities = applyVmfOps(
        geometry.text,
        (["info_player_start", "light", "info_target"] as const).map((classname) => ({
          op: "update" as const,
          match: { classname },
          set: { origin: shifted(probe(), classname, delta) },
        })),
      );
      writeFileSync(moved, withEntities.text);
      const out = await compile(moved);
      expect(out.leaked).toBe(false);
      expect(out.ok).toBe(true);
    },
    300_000,
  );
});

/** Reads an entity's origin out of the source and shifts it, as a keyvalue string. */
function shifted(source: string, classname: string, delta: Vec3): string {
  const { entities } = readEntities(source);
  const e = entities.find((x) => x.classname === classname)!;
  const raw = e.block.entries.find(
    (n): n is Extract<typeof n, { kind: "pair" }> => n.kind === "pair" && n.key === "origin",
  );
  const [x, y, z] = (raw?.value ?? "0 0 0").split(/\s+/).map(Number);
  return `${x! + delta[0]} ${y! + delta[1]} ${z! + delta[2]}`;
}
