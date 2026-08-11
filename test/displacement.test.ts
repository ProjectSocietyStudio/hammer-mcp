import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { callSidecar } from "../src/sidecar/client.js";
import { readDisplacements, VmfDisplacementError } from "../src/vmf/displacement.js";
import { config, has } from "./support/env.js";
import {
  displacedMap,
  DISPLACED_VMF,
  DISP_EAST,
  DISP_WEST,
  FLAT,
  RIDGE,
  SLOPE,
} from "./support/displaced.js";

const scratch = mkdtempSync(join(tmpdir(), "hammer-disp-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("readDisplacements", () => {
  it("finds both displacements and the grid each one has", () => {
    const r = readDisplacements(DISPLACED_VMF);
    expect(r.displacements).toHaveLength(2);
    for (const d of r.displacements) {
      // Power 2 is a 5x5 grid of 25 vertices, not 4x4. Every count in this format is off
      // by one from its neighbour, which is the whole reason for an independent oracle.
      expect(d.power).toBe(2);
      expect(d.size).toBe(5);
      expect(d.vertices).toHaveLength(25);
      expect(d.findings).toEqual([]);
    }
  });

  it("starts each grid at the corner startposition names", () => {
    // Getting this wrong turns a hillside upside down or mirrors it, and nothing
    // downstream reports either: the map compiles and the terrain is wrong.
    const r = readDisplacements(DISPLACED_VMF);
    const west = r.displacements.find((d) => d.solidId === DISP_WEST)!;
    const east = r.displacements.find((d) => d.solidId === DISP_EAST)!;
    for (let a = 0; a < 3; a += 1) {
      expect(west.corners[0][a], `west axis ${a}`).toBeCloseTo([0, 0, 64][a]!);
      expect(east.corners[0][a], `east axis ${a}`).toBeCloseTo([256, 0, 64][a]!);
    }
  });

  it("places a flat displacement exactly on the face it sits on", () => {
    const r = readDisplacements(DISPLACED_VMF);
    const west = r.displacements.find((d) => d.solidId === DISP_WEST)!;
    for (const v of west.vertices) {
      expect(v.position[2], "nothing moved, so nothing is off the face").toBeCloseTo(64);
      expect(v.position).toEqual(v.flat);
    }
    // And the grid spans the face rather than a corner of it.
    expect(Math.min(...west.vertices.map((v) => v.position[0]))).toBe(0);
    expect(Math.max(...west.vertices.map((v) => v.position[0]))).toBe(256);
  });

  it("moves a vertex along its own normal by its own distance", () => {
    const ridged = displacedMap(
      { ...RIDGE, startPosition: [0, 0, 64] },
      { ...FLAT, startPosition: [256, 0, 64] },
    ).text;
    const r = readDisplacements(ridged);
    const ridge = r.displacements.find((d) => d.maxDistance > 0)!;
    expect(ridge.minDistance).toBe(0);
    expect(ridge.maxDistance).toBe(64);
    // The normals in this fixture are all +z, so the peak is 64 above the face.
    expect(Math.max(...ridge.vertices.map((v) => v.position[2]))).toBeCloseTo(128);
  });

  it("says a displacement does not seal, because a leak here names an innocent brush", () => {
    const r = readDisplacements(DISPLACED_VMF);
    expect(r.warnings.join(" ")).toMatch(/does not seal/);
  });

  it("refuses a power Source does not have", () => {
    const bad = DISPLACED_VMF.replace('"power" "2"', '"power" "7"');
    expect(() => readDisplacements(bad)).toThrow(VmfDisplacementError);
  });

  it("says which row is short rather than reading past its end", () => {
    // A short row is not a Hammer file: it is a hand edit or a generator, and reading the
    // missing values as zero would report them as measurements.
    const truncated = DISPLACED_VMF.replace(/"row0" "0 0 0 0 0"/, '"row0" "0 0 0"');
    expect(truncated).not.toBe(DISPLACED_VMF);
    const r = readDisplacements(truncated);
    expect(r.displacements.some((d) => d.findings.some((f) => /row 0 has 3 numbers/.test(f)))).toBe(
      true,
    );
  });
});

describe("findSeams", () => {
  it("finds nothing between two displacements that meet", () => {
    // The two flat sheets share the edge at x = 256 exactly, which is what sewn terrain
    // looks like. A seam here would be a false positive on the most common arrangement.
    expect(readDisplacements(DISPLACED_VMF).seams).toEqual([]);
  });

  it("finds the gap when one side is lifted and the other is not", () => {
    // The crack a player falls through is the same shape as the one that is merely ugly,
    // and neither is visible in the editor until you stand on it.
    // A slope rather than a ridge: the ridge is zero at both edges, which is exactly
    // where its neighbour meets it, so it cannot make a seam at all. The first version of
    // this test used one and found nothing, which looked like the check working.
    const sloped = displacedMap(
      { ...SLOPE, startPosition: [0, 0, 64] },
      { ...FLAT, startPosition: [256, 0, 64] },
    ).text;
    const seams = readDisplacements(sloped).seams;
    expect(seams).toHaveLength(1);
    expect(seams[0]!.openPairs).toBeGreaterThan(0);
    expect(seams[0]!.worstGap).toBeGreaterThan(1);
  });
});

describe("srctools reads the same displacements", () => {
  const ready = has.sidecar;

  /**
   * The oracle, and the only one available: no map on this machine carries a `dispinfo`,
   * so the fixture is written here and checked against an implementation that is not ours.
   * srctools refuses more of this format than we do -- a power outside 0..4, an
   * `allowed_verts` that is not ten long -- so a fixture it accepts is one Hammer would.
   */
  it.skipIf(!ready)(
    "agrees about the power, the grid and where each one starts",
    async () => {
      const file = join(scratch, "displaced.vmf");
      writeFileSync(file, DISPLACED_VMF);
      const reply = (await callSidecar(
        "vmf_displacements",
        { path: file },
        config,
        120_000,
      )) as {
        count: number;
        displacements: Array<{
          solidId: number;
          power: number;
          size: number;
          vertexCount: number;
          startPosition: number[];
          maxDistance: number;
        }>;
      };

      const ours = readDisplacements(DISPLACED_VMF).displacements;
      expect(reply.count).toBe(ours.length);

      for (const theirs of reply.displacements) {
        const mine = ours.find((d) => d.solidId === theirs.solidId)!;
        expect(mine, `solid ${theirs.solidId}`).toBeDefined();
        expect(mine.power).toBe(theirs.power);
        expect(mine.size).toBe(theirs.size);
        expect(mine.vertices).toHaveLength(theirs.vertexCount);
        for (let a = 0; a < 3; a += 1) {
          expect(mine.startPosition[a]).toBeCloseTo(theirs.startPosition[a]!);
        }
        expect(mine.maxDistance).toBeCloseTo(theirs.maxDistance, 4);
      }
    },
    120_000,
  );

  it.skipIf(!ready)(
    "agrees about a displacement that is not flat",
    async () => {
      const ridged = displacedMap(
        { ...RIDGE, startPosition: [0, 0, 64] },
        { ...FLAT, startPosition: [256, 0, 64] },
      ).text;
      const file = join(scratch, "ridged.vmf");
      writeFileSync(file, ridged);
      const reply = (await callSidecar("vmf_displacements", { path: file }, config, 120_000)) as {
        displacements: Array<{ solidId: number; maxDistance: number; minDistance: number }>;
      };

      const ours = readDisplacements(ridged).displacements;
      for (const theirs of reply.displacements) {
        const mine = ours.find((d) => d.solidId === theirs.solidId)!;
        expect(mine.maxDistance).toBeCloseTo(theirs.maxDistance, 4);
        expect(mine.minDistance).toBeCloseTo(theirs.minDistance, 4);
      }
      expect(reply.displacements.some((d) => d.maxDistance === 64)).toBe(true);
    },
    120_000,
  );
});
