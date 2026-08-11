import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEmptySelector, matchesSolid } from "../src/vmf/select.js";
import type { SolidSelector } from "../src/vmf/select.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck } from "../src/vmf/solid.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const solids = (): SolidCheck[] => checkVmfSolids(PROBE, readFileSync(PROBE, "utf8")).solids;
const pick = (sel: SolidSelector): number[] =>
  solids()
    .filter((s) => matchesSolid(s, sel))
    .map((s) => s.id!)
    .sort((a, b) => a - b);

/** The probe: six world brushes, a floor and a ceiling and four walls. */
const ALL = [7, 14, 21, 28, 35, 42];

describe("matchesSolid", () => {
  it("selects nothing but what it was asked for, by id", () => {
    expect(pick({ ids: [21] })).toEqual([21]);
    expect(pick({ ids: [21, 7] })).toEqual([7, 21]);
    expect(pick({ ids: [9999] })).toEqual([]);
  });

  it("selects by owner, and the probe's brushes are all the world's", () => {
    expect(pick({ owner: "world" })).toEqual(ALL);
    expect(pick({ owner: "func_detail" })).toEqual([]);
  });

  it("selects by material, matching part of the name and ignoring case", () => {
    expect(pick({ material: "dev_measuregeneric01" })).toEqual(ALL);
    expect(pick({ material: "DEV" })).toEqual(ALL);
    expect(pick({ material: "brick" })).toEqual([]);
  });

  it("takes a brush only when the box holds all of it", () => {
    // The half-caught brush is the classic way a box selection deletes something the
    // caller could not see it had touched. Containment is total or it is not a match.
    expect(pick({ within: { mins: [-1000, -1000, -1000], maxs: [1000, 1000, 1000] } })).toEqual(
      ALL,
    );

    // Take a real brush's own bounds, then shave one unit off the box. Exact containment
    // must still match -- the test would be worth nothing if the boundary were exclusive --
    // and one unit less must not.
    const wall = solids().find((s) => s.id === 21)!;
    const exact = { mins: wall.mins, maxs: wall.maxs };
    expect(pick({ within: exact })).toContain(21);

    const shaved = {
      mins: exact.mins,
      maxs: [exact.maxs[0]! - 1, exact.maxs[1]!, exact.maxs[2]!] as [number, number, number],
    };
    expect(pick({ within: shaved })).not.toContain(21);
  });

  it("intersects its criteria rather than uniting them", () => {
    expect(pick({ ids: [7, 21], owner: "world", material: "DEV" })).toEqual([7, 21]);
    expect(pick({ ids: [7, 21], owner: "func_detail" })).toEqual([]);
  });

  it("matches everything when it names nothing, which is why callers must refuse that", () => {
    expect(pick({})).toEqual(ALL);
    expect(isEmptySelector({})).toBe(true);
    expect(isEmptySelector({ ids: [1] })).toBe(false);
  });
});
