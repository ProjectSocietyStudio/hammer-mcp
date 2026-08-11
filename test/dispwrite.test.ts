import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../src/sidecar/client.js";
import { readDisplacements } from "../src/vmf/displacement.js";
import {
  paintDisplacements,
  sculptDisplacements,
  sewDisplacements,
  VmfDispWriteError,
  writeDisplacements,
} from "../src/vmf/dispwrite.js";
import { insertSolids } from "../src/vmf/build.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { config, has } from "./support/env.js";
import { displacedMap, DISPLACED_VMF, DISP_EAST, DISP_WEST, FLAT, SLOPE } from "./support/displaced.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-dispw-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Two plain brushes side by side, sharing the edge at x = 256, with no displacements. */
const PLAIN = ((): { text: string; west: number; east: number } => {
  const seed =
    'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n' +
    '\t"classname" "worldspawn"\n}\n';
  const a = insertSolids(seed, [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  const b = insertSolids(a.text, [{ shape: "box", mins: [256, 0, 0], maxs: [512, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  return { text: b.text, west: a.solidIds[0]!, east: b.solidIds[0]! };
})();

describe("writeDisplacements", () => {
  it("puts a grid on the face and the reader gets it back", () => {
    const r = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 3 });
    expect(r.created).toHaveLength(2);

    const back = readDisplacements(r.text).displacements;
    expect(back).toHaveLength(2);
    for (const d of back) {
      // Power 3 is 9x9. The one number in this format most likely to be got wrong.
      expect(d.power).toBe(3);
      expect(d.size).toBe(9);
      expect(d.vertices).toHaveLength(81);
      expect(d.findings).toEqual([]);
      expect(d.maxDistance).toBe(0);
    }
  });

  it("leaves the brush's geometry exactly as it was", () => {
    // A displacement is drawn over the face; it does not move it. If the solid changed
    // shape, something wrote in the wrong place.
    const before = checkVmfSolids("x", PLAIN.text).solids;
    const r = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 2 });
    const after = checkVmfSolids("x", r.text).solids;
    for (const b of before) {
      expect(after.find((s) => s.id === b.id)!.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });

  it("starts the grid on a corner of the face it is on", () => {
    // A startposition that is merely near the face gives a grid rotated a quarter turn,
    // which reads as terrain that has been mirrored.
    const r = writeDisplacements(PLAIN.text, { solidIds: [PLAIN.west], facing: "up" }, { power: 2 });
    const d = readDisplacements(r.text).displacements[0]!;
    const onFace = d.corners.some(
      (c) =>
        Math.abs(c[0] - d.startPosition[0]) < 0.01 &&
        Math.abs(c[1] - d.startPosition[1]) < 0.01 &&
        Math.abs(c[2] - d.startPosition[2]) < 0.01,
    );
    expect(onFace).toBe(true);
  });

  it("takes a shape when it is given one", () => {
    const r = writeDisplacements(
      PLAIN.text,
      { solidIds: [PLAIN.west], facing: "up" },
      { power: 2, height: (x, _y, size) => (64 * x) / (size - 1) },
    );
    const d = readDisplacements(r.text).displacements[0]!;
    expect(d.minDistance).toBe(0);
    expect(d.maxDistance).toBe(64);
  });

  it("refuses a power nobody builds terrain with", () => {
    expect(() => writeDisplacements(PLAIN.text, { facing: "up" }, { power: 1 })).toThrow(
      VmfDispWriteError,
    );
    expect(() => writeDisplacements(PLAIN.text, { facing: "up" }, { power: 5 })).toThrow(
      VmfDispWriteError,
    );
  });

  it("refuses to overwrite one that is already there", () => {
    // Replacing it silently discards whatever was sculpted and painted onto it, which is
    // the most expensive thing in a terrain and the least visible in a diff.
    expect(() => writeDisplacements(DISPLACED_VMF, { facing: "up" }, { power: 2 })).toThrow(
      /already has a displacement/,
    );
  });
});

describe("sewDisplacements", () => {
  const gapped = displacedMap(
    { ...SLOPE, startPosition: [0, 0, 64] },
    { ...FLAT, startPosition: [256, 0, 64] },
  ).text;

  it("closes the seam it was given, and the reader agrees it is closed", () => {
    // The oracle is exact and it is the reader. It decides adjacency the same way this
    // does, so it would find any pair the sew missed.
    expect(readDisplacements(gapped).seams).toHaveLength(1);

    const r = sewDisplacements(gapped);
    expect(r.moved).toBeGreaterThan(0);
    expect(readDisplacements(r.text).seams).toEqual([]);
  });

  it("meets in the middle rather than dragging one side to the other", () => {
    // Hammer's Sew averages. Taking one side's value would move a whole hillside to match
    // its neighbour, which is a bigger edit than the one that was asked for.
    const before = readDisplacements(gapped).displacements;
    const west = before.find((d) => d.solidId === DISP_WEST)!;
    const east = before.find((d) => d.solidId === DISP_EAST)!;
    expect(west.maxDistance).toBe(64);
    expect(east.maxDistance).toBe(0);

    const after = readDisplacements(sewDisplacements(gapped).text).displacements;
    const sharedWest = after
      .find((d) => d.solidId === DISP_WEST)!
      .vertices.filter((v) => Math.abs(v.flat[0] - 256) < 0.01);
    for (const v of sharedWest) expect(v.distance).toBeCloseTo(32);
  });

  it("leaves the vertices away from the join alone", () => {
    const after = readDisplacements(sewDisplacements(gapped).text).displacements;
    const west = after.find((d) => d.solidId === DISP_WEST)!;
    const far = west.vertices.filter((v) => Math.abs(v.flat[0]) < 0.01);
    for (const v of far) expect(v.distance).toBe(0);
  });

  it("says so when there is nothing to sew", () => {
    const r = sewDisplacements(DISPLACED_VMF);
    expect(r.unchanged).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/already agreed/);
  });

  it("says so when there is only one displacement", () => {
    const one = writeDisplacements(
      PLAIN.text,
      { solidIds: [PLAIN.west], facing: "up" },
      { power: 2 },
    ).text;
    expect(sewDisplacements(one).warnings.join(" ")).toMatch(/no seam to sew/);
  });
});

describe("sculptDisplacements", () => {
  const base = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 2 }).text;

  it("raises a terrain by the amount it was given", () => {
    const r = sculptDisplacements(base, { solidIds: [PLAIN.west] }, { kind: "raise", by: 48 });
    const d = readDisplacements(r.text).displacements.find((x) => x.solidId === PLAIN.west)!;
    expect(d.minDistance).toBe(48);
    expect(d.maxDistance).toBe(48);
  });

  it("slopes between two heights along the axis it was given", () => {
    const r = sculptDisplacements(base, { solidIds: [PLAIN.west] }, {
      kind: "slope",
      from: 0,
      to: 128,
      along: "x",
    });
    const d = readDisplacements(r.text).displacements.find((x) => x.solidId === PLAIN.west)!;
    expect(d.minDistance).toBe(0);
    expect(d.maxDistance).toBe(128);
    // And it really varies along x rather than along y.
    const row = d.vertices.filter((v) => v.y === 0).map((v) => v.distance);
    expect(row[0]).toBe(0);
    expect(row[row.length - 1]).toBe(128);
  });

  it("makes the same noise twice from the same seed", () => {
    // A terrain that cannot be regenerated from what produced it cannot be reviewed, and
    // cannot survive a merge. That is why noise takes a seed rather than reaching for
    // Math.random.
    const a = sculptDisplacements(base, {}, { kind: "noise", amplitude: 32, seed: 7 }).text;
    const b = sculptDisplacements(base, {}, { kind: "noise", amplitude: 32, seed: 7 }).text;
    expect(a).toBe(b);

    const c = sculptDisplacements(base, {}, { kind: "noise", amplitude: 32, seed: 8 }).text;
    expect(c).not.toBe(a);
  });

  it("keeps noise inside the amplitude it was given", () => {
    const r = sculptDisplacements(base, {}, { kind: "noise", amplitude: 32, seed: 7 });
    expect(Math.abs(r.minDistance)).toBeLessThanOrEqual(32);
    expect(Math.abs(r.maxDistance)).toBeLessThanOrEqual(32);
  });

  it("flattens back to nothing", () => {
    const raised = sculptDisplacements(base, {}, { kind: "raise", by: 64 }).text;
    const flat = sculptDisplacements(raised, {}, { kind: "flatten" });
    expect(flat.maxDistance).toBe(0);
    expect(readDisplacements(flat.text).seams).toEqual([]);
  });

  it("says the join opened when only one side was sculpted", () => {
    const r = sculptDisplacements(base, { solidIds: [PLAIN.west] }, { kind: "raise", by: 64 });
    expect(r.warnings.join(" ")).toMatch(/sew afterwards/);
    expect(readDisplacements(r.text).seams).toHaveLength(1);
  });
});

describe("paintDisplacements", () => {
  const base = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 2 }).text;

  it("paints every vertex when told to", () => {
    const r = paintDisplacements(base, {}, { kind: "uniform", alpha: 255 });
    const d = readDisplacements(r.text).displacements[0]!;
    expect(d.minAlpha).toBe(255);
    expect(d.maxAlpha).toBe(255);
    expect(d.alphaPainted).toBe(25);
  });

  it("fades between two heights rather than stepping", () => {
    // A shoreline that steps from grass to gravel in one vertex is what a threshold gives
    // and is not what anyone wants.
    const sloped = sculptDisplacements(base, {}, { kind: "slope", from: 0, to: 128, along: "x" }).text;
    const r = paintDisplacements(sloped, {}, { kind: "byHeight", low: 64, high: 192 });
    const d = readDisplacements(r.text).displacements[0]!;
    const alphas = new Set(d.vertices.map((v) => v.alpha));
    expect(alphas.size, "more than two values means it faded").toBeGreaterThan(2);
    expect(d.minAlpha).toBe(0);
    expect(d.maxAlpha).toBe(255);
  });

  it("clamps to the range the format has", () => {
    const r = paintDisplacements(base, {}, { kind: "uniform", alpha: 9999 });
    expect(readDisplacements(r.text).displacements[0]!.maxAlpha).toBe(255);
  });

  it("says when the material cannot show a blend at all", () => {
    const plainMaterial = writeDisplacements(
      insertSolids(
        'versioninfo\n{\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n',
        [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }],
        { material: "BRICK/BRICKWALL001A" },
      ).text,
      { facing: "up" },
      { power: 2 },
    ).text;
    const r = paintDisplacements(plainMaterial, {}, { kind: "uniform", alpha: 255 });
    expect(r.warnings.join(" ")).toMatch(/not a blend shader/);
  });

  it("leaves the shape alone", () => {
    const sloped = sculptDisplacements(base, {}, { kind: "slope", from: 0, to: 128, along: "x" }).text;
    const before = readDisplacements(sloped).displacements[0]!;
    const r = paintDisplacements(sloped, {}, { kind: "uniform", alpha: 128 });
    const after = readDisplacements(r.text).displacements[0]!;
    expect(after.maxDistance).toBe(before.maxDistance);
    expect(after.minDistance).toBe(before.minDistance);
  });
});

describe("srctools reads what these writers produced", () => {
  const ready = has.sidecar;

  it.skipIf(!ready)(
    "agrees about a displacement this created and then sculpted",
    async () => {
      const created = writeDisplacements(PLAIN.text, { facing: "up" }, { power: 3 }).text;
      const sculpted = sculptDisplacements(created, {}, {
        kind: "slope",
        from: 0,
        to: 96,
        along: "y",
      }).text;
      const painted = paintDisplacements(sculpted, {}, { kind: "uniform", alpha: 200 }).text;

      const file = join(scratch, "written.vmf");
      writeFileSync(file, painted);
      const reply = (await callSidecar("vmf_displacements", { path: file }, config, 120_000)) as {
        count: number;
        displacements: Array<{
          solidId: number;
          power: number;
          size: number;
          vertexCount: number;
          minDistance: number;
          maxDistance: number;
          minAlpha: number;
          maxAlpha: number;
        }>;
      };

      expect(reply.count).toBe(2);
      const ours = readDisplacements(painted).displacements;
      for (const theirs of reply.displacements) {
        const mine = ours.find((d) => d.solidId === theirs.solidId)!;
        expect(theirs.power).toBe(3);
        expect(theirs.size).toBe(9);
        expect(theirs.vertexCount).toBe(81);
        expect(theirs.minDistance).toBeCloseTo(mine.minDistance, 4);
        expect(theirs.maxDistance).toBeCloseTo(mine.maxDistance, 4);
        expect(theirs.maxAlpha).toBeCloseTo(200, 4);
      }
    },
    120_000,
  );
});
