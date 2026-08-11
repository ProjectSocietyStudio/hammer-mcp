import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { insertSolids } from "../src/vmf/build.js";
import { clipSolids, VmfClipError } from "../src/vmf/clip.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { Plane, SolidCheck, Vec3 } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const byId = (text: string, id: number): SolidCheck | undefined =>
  read(text).find((s) => s.id === id);

/** The probe's floor: a slab from -288..288 in x and y, -32..0 in z. */
const FLOOR = 7;
const WALL = 21;

/** A vertical plane through the origin, normal pointing along +x. */
const THROUGH_ORIGIN: Plane = { normal: [1, 0, 0], dist: 0 };

describe("clipSolids: the conservation law", () => {
  it("keeps both halves, and their volumes sum to the original", () => {
    // The whole oracle for this file. A plane taken in the wrong sense does not give a
    // slightly wrong sum: it gives the volume doubled, or zero.
    const before = byId(probe(), FLOOR)!;
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "both" });
    expect(r.matched).toBe(1);

    const piece = r.solids[0]!;
    expect(piece.otherId).not.toBeNull();
    expect(piece.volumeAfter + piece.volumeOther).toBeCloseTo(before.volume, 3);

    const after = read(r.text);
    expect(after).toHaveLength(6 + 1);
    const a = after.find((s) => s.id === FLOOR)!;
    const b = after.find((s) => s.id === piece.otherId)!;
    expect(a.volume + b.volume).toBeCloseTo(before.volume, 3);
  });

  it("cuts a slab exactly in half when the plane runs through its middle", () => {
    const before = byId(probe(), FLOOR)!;
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "both" });
    const piece = r.solids[0]!;
    expect(piece.volumeAfter).toBeCloseTo(before.volume / 2, 3);
    expect(piece.volumeOther).toBeCloseTo(before.volume / 2, 3);
  });

  it("makes two valid brushes, not two shapes that merely have the right volume", () => {
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "both" });
    const piece = r.solids[0]!;
    for (const id of [FLOOR, piece.otherId!]) {
      const s = byId(r.text, id)!;
      expect(s.valid, `solid ${id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(true);
      // A cut box is still a box: six faces, eight corners.
      expect(s.sides).toHaveLength(6);
      expect(s.vertices).toHaveLength(8);
    }
  });

  it("keeps only the side the normal points towards, when asked for the front", () => {
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "front" });
    const s = byId(r.text, FLOOR)!;
    expect(read(r.text)).toHaveLength(6);
    expect(s.mins[0]).toBeCloseTo(0);
    expect(s.maxs[0]).toBeCloseTo(288);
  });

  it("keeps the other side when asked for the back", () => {
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "back" });
    const s = byId(r.text, FLOOR)!;
    expect(s.mins[0]).toBeCloseTo(-288);
    expect(s.maxs[0]).toBeCloseTo(0);
  });

  it("survives a diagonal cut, which is where an axis-aligned shortcut would break", () => {
    const before = byId(probe(), FLOOR)!;
    const diagonal: Plane = { normal: [1 / Math.SQRT2, 1 / Math.SQRT2, 0], dist: 0 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, diagonal, { keep: "both" });
    const piece = r.solids[0]!;
    expect(piece.volumeAfter + piece.volumeOther).toBeCloseTo(before.volume, 2);
    expect(byId(r.text, FLOOR)!.valid).toBe(true);
    expect(byId(r.text, piece.otherId!)!.valid).toBe(true);
    // A square slab cut corner to corner gives two triangular prisms: five faces each.
    expect(byId(r.text, FLOOR)!.sides).toHaveLength(5);
  });
});

describe("clipSolids: what happens to the faces", () => {
  it("leaves a surviving face's material and texture axes exactly as they were", () => {
    // A clip that reset the texturing of every face it did not remove would be technically
    // correct and useless.
    const before = byId(probe(), FLOOR)!;
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "front" });
    const after = byId(r.text, FLOOR)!;
    const top = after.sides.find((s) => s.plane!.normal[2] > 0.9)!;
    const wasTop = before.sides.find((s) => s.plane!.normal[2] > 0.9)!;
    expect(top.material).toBe(wasTop.material);
    expect(top.uaxis!.axis).toEqual(wasTop.uaxis!.axis);
    expect(top.uaxis!.scale).toBe(wasTop.uaxis!.scale);
    expect(top.lightmapScale).toBe(wasTop.lightmapScale);
  });

  it("gives the new face the material of the largest one it kept", () => {
    // Cutting a brick wall in two and getting nodraw down the middle is the wrong answer
    // often enough that Hammer does the same thing.
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "front" });
    const after = byId(r.text, FLOOR)!;
    const cutFace = after.sides.find((s) => s.plane!.normal[0] < -0.9)!;
    expect(cutFace.material).toBe("DEV/DEV_MEASUREGENERIC01");
  });

  it("takes the material it was given for the cut, when it was given one", () => {
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, {
      keep: "front",
      cutMaterial: "TOOLS/TOOLSNODRAW",
    });
    const cutFace = byId(r.text, FLOOR)!.sides.find((s) => s.plane!.normal[0] < -0.9)!;
    expect(cutFace.material).toBe("TOOLS/TOOLSNODRAW");
  });

  it("keeps a tool brush a tool brush when it cuts one", () => {
    // A hint brush is TOOLS/TOOLSHINT and TOOLS/TOOLSSKIP and nothing else. Skipping every
    // tool texture when choosing the cut material fell through to NODRAW, so a hint cut in
    // two came back as a hint with a nodraw face -- which vvis reads as neither.
    const hint = insertSolids(probe(), [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 8] }], {
      material: "TOOLS/TOOLSSKIP",
      materialForFace: (f) => (f.areaRank <= 1 ? "TOOLS/TOOLSHINT" : "TOOLS/TOOLSSKIP"),
    });
    const id = hint.solidIds[0]!;
    const r = clipSolids(hint.text, { ids: [id] }, { normal: [1, 0, 0], dist: 128 }, {
      keep: "front",
    });
    const cutFace = byId(r.text, id)!.sides.find((s) => s.plane!.normal[0] < -0.9)!;
    expect(cutFace.material).toMatch(/^TOOLS\//);
    expect(cutFace.material).not.toBe("TOOLS/TOOLSNODRAW");
  });

  it("gives the second piece the source brush's own editor block", () => {
    // Without the source's block the half this tool made is outside every visgroup the
    // original was in, the next time Hammer opens the map -- and with no block at all it
    // can never be put in one.
    const built = insertSolids(probe(), [
      { shape: "box", mins: [-128, -128, 512], maxs: [128, 128, 640] },
    ]);
    const id = built.solidIds[0]!;
    // A membership and a colour of its own, as Hammer would have written them.
    const marked = built.text.replace(
      '"color" "0 180 220"',
      '"color" "12 34 56"\n\t\t\t"visgroupid" "77"\n\t\t\t"groupid" "88"',
    );
    expect(marked).not.toBe(built.text);

    const r = clipSolids(marked, { ids: [id] }, THROUGH_ORIGIN, { keep: "both" });
    const otherId = r.solids[0]!.otherId!;
    expect(otherId).toBeGreaterThan(0);

    // Two brushes now carry the membership, the colour and the group: the original and
    // the piece cut off it.
    expect((r.text.match(/"visgroupid" "77"/g) ?? [])).toHaveLength(2);
    expect((r.text.match(/"groupid" "88"/g) ?? [])).toHaveLength(2);
    expect((r.text.match(/"color" "12 34 56"/g) ?? [])).toHaveLength(2);
  });

  it("drops a face that no longer bounds anything, rather than leaving it redundant", () => {
    // A corner-to-corner cut of a square slab leaves each of two vertical faces touching
    // the hull at a single corner -- two points, no face. Leaving them in would not change
    // the shape, since the intersection is the same, but read_vmf_solids would report
    // redundant-side on every brush this tool made.
    const diagonal: Plane = { normal: [1 / Math.SQRT2, 1 / Math.SQRT2, 0], dist: 0 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, diagonal, { keep: "front" });
    expect(r.solids[0]!.facesDropped).toBe(2);
    const after = byId(r.text, FLOOR)!;
    expect(after.findings.filter((f) => f.rule === "redundant-side")).toEqual([]);
  });

  it("gives the cut face texture axes the checker accepts", () => {
    const diagonal: Plane = { normal: [1 / Math.SQRT2, 1 / Math.SQRT2, 0], dist: 0 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, diagonal, { keep: "both" });
    for (const s of read(r.text)) {
      expect(
        s.findings.filter((f) => f.rule === "texture-axis-along-normal"),
        `solid ${s.id}`,
      ).toEqual([]);
    }
  });
});

describe("clipSolids: a plane that misses", () => {
  it("leaves a brush alone, byte for byte, when the kept side holds all of it", () => {
    // Not "rewrites it with the same bytes": that is indistinguishable from a real edit in
    // a diff, and the point of this write path is that a diff shows only what changed.
    const far: Plane = { normal: [1, 0, 0], dist: 4096 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, far, { keep: "back" });
    expect(r.text).toBe(probe());
    expect(r.unchanged).toBe(true);
    expect(r.solids[0]!.removed).toBe(false);
  });

  it("removes a brush that lies entirely on the discarded side, and says so", () => {
    const far: Plane = { normal: [1, 0, 0], dist: 4096 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, far, { keep: "front" });
    expect(r.solids[0]!.removed).toBe(true);
    expect(byId(r.text, FLOOR)).toBeUndefined();
    expect(read(r.text)).toHaveLength(5);
    expect(r.warnings.join(" ")).toMatch(/leaks/);
  });

  it("makes no second piece when there was nothing to cut", () => {
    const far: Plane = { normal: [1, 0, 0], dist: 4096 };
    const r = clipSolids(probe(), { ids: [FLOOR] }, far, { keep: "both" });
    expect(r.solids[0]!.otherId).toBeNull();
    expect(read(r.text)).toHaveLength(6);
  });
});

describe("clipSolids: what it refuses", () => {
  it("refuses a selector that names nothing", () => {
    expect(() => clipSolids(probe(), {}, THROUGH_ORIGIN, { keep: "front" })).toThrow(
      VmfClipError,
    );
  });

  it("refuses a plane with no direction", () => {
    expect(() =>
      clipSolids(probe(), { ids: [FLOOR] }, { normal: [0, 0, 0] as Vec3, dist: 0 }, {
        keep: "front",
      }),
    ).toThrow(/no normal direction/);
  });

  it("refuses a brush carrying a displacement", () => {
    const withDisp = probe().replace(
      '\t\t\t"smoothing_groups" "0"',
      '\t\t\t"smoothing_groups" "0"\n\t\t\tdispinfo\n\t\t\t{\n\t\t\t\t"power" "3"\n\t\t\t}',
    );
    expect(() =>
      clipSolids(withDisp, { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "front" }),
    ).toThrow(/displacement/);
  });

  it("reports a selector that matched nothing rather than failing", () => {
    const r = clipSolids(probe(), { ids: [9999] }, THROUGH_ORIGIN, { keep: "front" });
    expect(r.matched).toBe(0);
    expect(r.text).toBe(probe());
  });
});

describe("clipSolids: the file around it", () => {
  it("leaves every brush it did not cut exactly as it was", () => {
    const before = read(probe());
    const r = clipSolids(probe(), { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "both" });
    const after = read(r.text);
    for (const b of before.filter((s) => s.id !== FLOOR)) {
      const a = after.find((s) => s.id === b.id)!;
      expect(a.volume, `solid ${b.id}`).toBe(b.volume);
      expect(a.mins, `solid ${b.id}`).toEqual(b.mins);
    }
  });

  it("gives every new side its own id, so Hammer can still open the file", () => {
    const r = clipSolids(probe(), { ids: [FLOOR, WALL] }, THROUGH_ORIGIN, { keep: "both" });
    const ids = read(r.text)
      .flatMap((s) => s.sides.map((x) => x.id))
      .filter((x): x is number => x !== null);
    expect(new Set(ids).size, "no id may be used twice").toBe(ids.length);
  });

  it("keeps the comments and blank lines a reserialiser would drop", () => {
    const source = `// hand-written\n${probe()}\n\n// trailing\n`;
    const r = clipSolids(source, { ids: [FLOOR] }, THROUGH_ORIGIN, { keep: "both" });
    expect(r.text.startsWith("// hand-written")).toBe(true);
    expect(r.text.endsWith("// trailing\n")).toBe(true);
  });
});

describe("what the compiler says about a cut map", () => {
  const canCompile = has.toolchain;
  const scratch = mkdtempSync(join(tmpdir(), "hammer-clip-"));
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
   * Every wall of the sealed room cut diagonally, keeping both halves. The hull is
   * unchanged as a set of points -- two brushes now occupy what one did -- so the map must
   * still seal. If the cut left the faintest gap along a cut plane, vbsp finds it: a leak
   * is the most sensitive test of geometry there is.
   */
  it.skipIf(!canCompile)(
    "a room whose every wall was cut in two still seals",
    async () => {
      const cut = join(scratch, "cut.vmf");
      const diagonal: Plane = { normal: [1 / Math.SQRT2, 1 / Math.SQRT2, 0], dist: 0 };
      const r = clipSolids(probe(), { owner: "world" }, diagonal, { keep: "both" });
      expect(r.matched).toBe(6);
      for (const s of read(r.text)) {
        expect(s.valid, `solid ${s.id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(
          true,
        );
      }
      // Ten, not twelve. Four of the six brushes meet the diagonal and become two each;
      // the north and south walls span x from -256 to 256 at y = +/-256..288, so x + y is
      // zero at exactly one corner and never crosses. They are left whole, which is the
      // right answer and not the one the arithmetic in this test first assumed.
      expect(read(r.text)).toHaveLength(10);
      expect(r.solids.filter((s) => s.otherId !== null)).toHaveLength(4);
      writeFileSync(cut, r.text);

      const out = await compile(cut);
      expect(out.leaked).toBe(false);
      expect(out.ok).toBe(true);
    },
    300_000,
  );

  it.skipIf(!canCompile)(
    "and leaks when one of the two halves is thrown away, so the test above means something",
    async () => {
      // The negative control. Keeping only the front leaves half of every wall, and half a
      // wall does not seal a room.
      const holed = join(scratch, "half.vmf");
      const diagonal: Plane = { normal: [1 / Math.SQRT2, 1 / Math.SQRT2, 0], dist: 0 };
      const r = clipSolids(probe(), { owner: "world" }, diagonal, { keep: "front" });
      writeFileSync(holed, r.text);
      expect((await compile(holed)).leaked).toBe(true);
    },
    300_000,
  );
});
