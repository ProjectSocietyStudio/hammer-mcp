import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../src/mcp/registry.js";
import { readVmfSolidsTool } from "../src/tools/solids.js";
import {
  checkVmfSolids,
  hullFromPlanes,
  largestGrid,
  parsePlanePoints,
  parseTextureAxis,
  planeFromPoints,
  WORLD_BOUND,
} from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;
const source = (): string => readFileSync(PROBE, "utf8");
const check = (text: string) => checkVmfSolids(PROBE, text);
const rules = (text: string): string[] => check(text).findings.map((f) => f.rule);

/**
 * The probe's six brushes, straight from the constants at the top of
 * `test/fixtures/gen_probe.py`: wall thickness 32, interior half-extent 256, so the outer
 * half-extent is 288. Written out here rather than derived from the reader, which is the
 * whole point -- these numbers came from the generator, the reader has to land on them.
 */
const EXPECTED_VOLUMES = [
  576 * 576 * 32, // floor
  576 * 576 * 32, // ceiling
  32 * 576 * 256, // -x wall
  32 * 576 * 256, // +x wall
  512 * 32 * 256, // -y wall
  512 * 32 * 256, // +y wall
];

/** Reverses one side's point order, which flips its normal and its half-space with it. */
function withInvertedSide(text: string): string {
  const m = text.match(/"plane" "(\([^"]*\))"/);
  if (!m) throw new Error("no plane in the probe VMF");
  const points = m[1]!.match(/\([^)]*\)/g)!;
  return text.replace(m[0], `"plane" "${[...points].reverse().join(" ")}"`);
}

function replaceFirst(text: string, pattern: RegExp, value: string): string {
  const m = text.match(pattern);
  if (!m) throw new Error(`pattern ${pattern} not in the probe VMF`);
  return text.replace(m[0], value);
}

describe("plane maths", () => {
  it("winds a +z face the way vbsp does, normal pointing out", () => {
    // The probe's own top-face point order, with the box at the origin.
    const p = planeFromPoints([-1, 1, 1], [1, 1, 1], [1, -1, 1]);
    expect(p).not.toBeNull();
    expect(p!.normal[2]).toBeCloseTo(1, 6);
    expect(p!.dist).toBeCloseTo(1, 6);
  });

  it("refuses three collinear points rather than inventing a plane", () => {
    expect(planeFromPoints([0, 0, 0], [1, 0, 0], [2, 0, 0])).toBeNull();
  });

  it("reads and rejects plane and axis syntax", () => {
    expect(parsePlanePoints("(0 0 0) (1 0 0) (1 1 0)")).toHaveLength(3);
    expect(parsePlanePoints("(0 0 0) (1 0 0)")).toBeNull();
    expect(parseTextureAxis("[1 0 0 0] 0.25")).toEqual({ axis: [1, 0, 0], offset: 0, scale: 0.25 });
    expect(parseTextureAxis("nonsense")).toBeNull();
  });

  it("rebuilds a unit cube from six half-spaces", () => {
    const cube = [
      { normal: [1, 0, 0] as const, dist: 1 },
      { normal: [-1, 0, 0] as const, dist: 1 },
      { normal: [0, 1, 0] as const, dist: 1 },
      { normal: [0, -1, 0] as const, dist: 1 },
      { normal: [0, 0, 1] as const, dist: 1 },
      { normal: [0, 0, -1] as const, dist: 1 },
    ];
    expect(hullFromPlanes(cube)).toHaveLength(8);
  });
});

describe("checkVmfSolids on the probe", () => {
  it("recovers the six brushes the generator declared, volume for volume", () => {
    const r = check(source());
    expect(r.solidCount).toBe(6);
    expect(r.validCount).toBe(6);
    expect(r.findings).toEqual([]);
    expect(r.solids.map((s) => s.volume)).toEqual(EXPECTED_VOLUMES);
    for (const s of r.solids) {
      expect(s.vertices).toHaveLength(8);
      expect(s.sides).toHaveLength(6);
      // Every side of a box bounds a quad, and the six areas close the volume.
      for (const side of s.sides) expect(side.vertices.length).toBe(4);
    }
  });

  it("catches a single inverted winding, which is the failure this oracle exists for", () => {
    const r = check(withInvertedSide(source()));
    expect(r.validCount).toBe(5);
    expect(rules(withInvertedSide(source()))).toContain("unbounded-solid");
  });

  it("catches three collinear points on a side", () => {
    const broken = replaceFirst(
      source(),
      /"plane" "\([^"]*\)"/,
      `"plane" "(0 0 0) (16 0 0) (32 0 0)"`,
    );
    expect(rules(broken)).toContain("degenerate-plane");
  });

  it("catches a texture axis lying along its own face normal", () => {
    // The probe's floor top face is +z; a uaxis of [0 0 1] has no extent across it, so the
    // texture stretches without bound. Nothing else in the toolchain notices: it compiles.
    const broken = replaceFirst(source(), /"uaxis" "\[1 0 0 0\] 0\.25"/, `"uaxis" "[0 0 1 0] 0.25"`);
    expect(rules(broken)).toContain("texture-axis-along-normal");
  });

  it("catches a zero texture scale", () => {
    const broken = replaceFirst(source(), /"uaxis" "\[1 0 0 0\] 0\.25"/, `"uaxis" "[1 0 0 0] 0"`);
    expect(rules(broken)).toContain("zero-texture-scale");
  });

  it("catches a corner past the world bound, and quotes the right bound", () => {
    const broken = source().replace(/-288/g, String(-(WORLD_BOUND + 1024)));
    const found = check(broken).findings.filter((f) => f.rule === "outside-world");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]!.message).toMatch(/16384/);
    expect(found[0]!.message).toMatch(/32768 is COORD_EXTENT/);
  });

  it("reports the coarsest grid every corner fits, not the finest", () => {
    // The probe is built from 32 and 256, so 32 divides every corner and 64 does not.
    expect(largestGrid([[0, 32, 64], [96, 128, -32]])).toBe(32);
    expect(largestGrid([[0, 32, 64], [96, 128, -33]])).toBe(1);
    expect(largestGrid([[0, 0, 0.5]])).toBe(0);
    expect(largestGrid([])).toBe(0);
    expect(check(source()).gridHistogram).toEqual({ "32": 6 });
  });

  it("warns rather than errors on off-grid corners", () => {
    const broken = source().replace(/256\)/g, "256.5)");
    const off = check(broken).findings.filter((f) => f.rule === "off-grid");
    expect(off.length).toBeGreaterThan(0);
    expect(off.every((f) => f.severity === "warning")).toBe(true);
  });
});

describe("read_vmf_solids", () => {
  it("returns only the broken solids by default, and counts them all", async () => {
    const out = z
      .object(readVmfSolidsTool.outputSchema!)
      .parse(await readVmfSolidsTool.handler({ path: PROBE }, ctx));
    expect(out.solidCount).toBe(6);
    expect(out.validCount).toBe(6);
    expect(out.solids).toHaveLength(0);
    expect(out.truncated).toBe(false);
  });

  it("returns every solid when asked, and its corners when asked", async () => {
    const out = z
      .object(readVmfSolidsTool.outputSchema!)
      .parse(await readVmfSolidsTool.handler({ path: PROBE, include: "all", vertices: true }, ctx));
    expect(out.solids).toHaveLength(6);
    expect(out.solids[0]!.vertices).toHaveLength(8);
  });

  it("says it truncated rather than quietly returning a short list", async () => {
    const out = z
      .object(readVmfSolidsTool.outputSchema!)
      .parse(await readVmfSolidsTool.handler({ path: PROBE, include: "all", limit: 2 }, ctx));
    expect(out.returned).toBe(2);
    expect(out.truncated).toBe(true);
    expect(out.solidCount).toBe(6);
  });

  it.skipIf(!has.tttSource)("agrees that a shipped Hammer map is mostly well-formed", () => {
    const r = checkVmfSolids(paths.tttSource, readFileSync(paths.tttSource, "utf8"));
    expect(r.solidCount).toBe(75);
    // Not 100%: a hand-built map legitimately carries rotated and off-grid geometry, and
    // those are warnings. Errors are what would have to be near zero.
    const errors = r.findings.filter((f) => f.severity === "error");
    expect(errors.length / r.solidCount).toBeLessThan(0.02);
  });

  it.skipIf(!has.tttSource)("shows a shipped map is not built to one uniform grid", () => {
    // Measured 11/08/2026 on ttt_traps.vmf, the only Hammer-written map shipped with the
    // game: 75 solids spread over grids 16, 8, 4, 2 and 1, none off-grid, no errors. It
    // is worth pinning because it contradicts the tidy version of the "build everything
    // on one grid" rule -- a map that shipped and plays does not obey it.
    const h = checkVmfSolids(paths.tttSource, readFileSync(paths.tttSource, "utf8")).gridHistogram;
    expect(Object.keys(h).length).toBeGreaterThan(3);
    expect(h["0"]).toBeUndefined();
  });
});
