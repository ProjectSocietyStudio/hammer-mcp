/**
 * The fittings, and the invariant per-brush validation cannot see.
 *
 * Three rounds of dogfooding produced a map that sealed, satisfied its brief and compiled
 * clean, and in game was grey boxes: a counter that was one brush, shelving that was one
 * brush, doorways with no frame at all. Everything the toolkit could check said yes. So the
 * assertions here are about the two things it could not: that a fitting is articulated at
 * dimensions taken off Valve's own models, and that its parts actually hold together.
 *
 * `read_vmf_solids` still runs over the result -- these are brushes and go through the same
 * oracle as any other. What it adds nothing to is whether a worktop sits on its body or
 * floats two units clear of it, which is precisely the failure that looks perfect in a
 * report and wrong on screen.
 */
import { describe, expect, it } from "vitest";
import { COUNTER, DOOR, TRIM } from "../src/vmf/fittings/dimensions.js";
import { expandFitting } from "../src/vmf/fittings/index.js";
import type { FittingSpec } from "../src/vmf/fittings/index.js";
import { checkAssembly, interiorsMeet, touch } from "../src/vmf/fittings/integrity.js";
import type { Part } from "../src/vmf/fittings/integrity.js";

const part = (name: string, mins: Part["mins"], maxs: Part["maxs"]): Part => ({ name, mins, maxs });

const named = (spec: FittingSpec, name: string): Part => {
  const found = expandFitting(spec).parts.find((p) => p.name === name);
  if (!found) throw new Error(`no part called ${name}`);
  return found;
};

describe("the assembly check", () => {
  it("calls two boxes meeting on a plane touching, and not overlapping", () => {
    const a = part("a", [0, 0, 0], [16, 16, 16]);
    const b = part("b", [0, 0, 16], [16, 16, 32]);
    expect(touch(a, b)).toBe(true);
    expect(interiorsMeet(a, b)).toBe(false);
  });

  /**
   * The exact case the door frame depends on and the reason there is no tolerance anywhere
   * in `integrity.ts`: skirting butted round a room meets only at the corners, and a check
   * that demanded face contact would call a correctly built run detached.
   */
  it("counts a corner as contact", () => {
    const a = part("a", [0, 0, 0], [16, 4, 8]);
    const b = part("b", [16, 4, 8], [32, 20, 16]);
    expect(touch(a, b)).toBe(true);
    expect(interiorsMeet(a, b)).toBe(false);
  });

  it("reports the volume two lapping parts share", () => {
    const r = checkAssembly([
      part("a", [0, 0, 0], [16, 16, 16]),
      part("b", [0, 0, 12], [16, 16, 32]),
    ]);
    expect(r.overlaps).toEqual([{ a: "a", b: "b", volume: 16 * 16 * 4 }]);
  });

  it("groups parts into the pieces they hold together as", () => {
    const r = checkAssembly([
      part("a", [0, 0, 0], [16, 16, 16]),
      part("b", [0, 0, 16], [16, 16, 32]),
      part("far", [512, 0, 0], [528, 16, 16]),
    ]);
    expect(r.components).toEqual([["a", "b"], ["far"]]);
  });

  /**
   * Grouping is by index, not by name -- four runs of skirting are all called `run`.
   *
   * This pair is here because the first version of it did not work. Asserting that two
   * *detached* same-named parts stay apart passes under a name-keyed implementation too:
   * the second is skipped inside the first group and then picked up as its own. The case
   * that discriminates is the opposite one -- two same-named parts that **do** touch, which
   * a name-keyed visited set refuses to merge, splitting a whole run into four pieces.
   * Verified by sabotage: keying on names kills the skirting tests and left this one green
   * until it was turned round.
   */
  it("merges two same-named parts that touch", () => {
    const r = checkAssembly([
      part("run", [0, 0, 0], [16, 16, 16]),
      part("run", [16, 0, 0], [32, 16, 16]),
    ]);
    expect(r.components).toEqual([["run", "run"]]);
  });

  it("keeps two same-named parts apart when they do not touch", () => {
    const r = checkAssembly([
      part("run", [0, 0, 0], [16, 16, 16]),
      part("run", [512, 0, 0], [528, 16, 16]),
    ]);
    expect(r.components).toHaveLength(2);
  });
});

describe("a counter", () => {
  const spec: FittingSpec = {
    fitting: "counter",
    mins: [0, 0, 0],
    maxs: [128, 24, COUNTER.shopHeight.units],
    facing: "+y",
  };

  it("is three brushes and not one, which is the whole point", () => {
    const out = expandFitting(spec);
    expect(out.specs).toHaveLength(3);
    expect(out.parts.map((p) => p.name).sort()).toEqual(["body", "kick", "top"]);
  });

  it("holds together as one piece", () => {
    expect(checkAssembly(expandFitting(spec).parts).components).toHaveLength(1);
  });

  /**
   * The articulation the caller never asked for and never has to know: a worktop of the
   * tabled thickness, oversailing on the served side by the tabled nosing.
   */
  it("oversails the body on the side people stand at", () => {
    const top = named(spec, "top");
    expect(top.maxs[1]).toBe(24 + COUNTER.overhang.units);
    expect(top.maxs[2] - top.mins[2]).toBe(COUNTER.topThickness.units);
  });

  it("sets the kick back on that same side, and not on the others", () => {
    const kick = named(spec, "kick");
    expect(kick.maxs[1]).toBe(24 - COUNTER.kickDepth.units);
    expect(kick.mins[1]).toBe(0);
    expect(kick.maxs[2] - kick.mins[2]).toBe(COUNTER.kickHeight.units);
  });

  it("puts the kick on the other side when the counter faces the other way", () => {
    const kick = named({ ...spec, facing: "-y" } as FittingSpec, "kick");
    expect(kick.mins[1]).toBe(COUNTER.kickDepth.units);
    expect(kick.maxs[1]).toBe(24);
  });

  it("refuses an envelope with no body left between the kick and the worktop", () => {
    expect(() =>
      expandFitting({ ...spec, maxs: [128, 24, COUNTER.kickHeight.units + COUNTER.topThickness.units] } as FittingSpec),
    ).toThrow(/no body left/);
  });

  /**
   * Reported, never refused. `building.md` measured that furniture past about 32 deep
   * collapses the room segmentation from 200 units away -- but a deep counter is a design
   * choice, and turning one into a write error is how a tool stops being usable.
   */
  it("says so when it is deep enough to disturb the room pass", () => {
    const out = expandFitting({ ...spec, maxs: [128, 48, COUNTER.shopHeight.units] } as FittingSpec);
    expect(out.notes.join(" ")).toMatch(/collapse the room segmentation/);
    expect(out.depth).toBe(48);
  });

  it("says nothing about height when it is built to a tabled one", () => {
    expect(expandFitting(spec).notes.join(" ")).not.toMatch(/units tall/);
  });
});

describe("a door frame", () => {
  // A 48-wide, 112-tall hole through an 8-unit wall running along x.
  const spec: FittingSpec = {
    fitting: "door_frame",
    mins: [100, 0, 0],
    maxs: [148, 8, 112],
  };

  it("is a jamb each side and a head across them, on both faces of the wall", () => {
    const out = expandFitting(spec);
    expect(out.parts.map((p) => p.name).sort()).toEqual([
      "head_far",
      "head_near",
      "jamb_far_high",
      "jamb_far_low",
      "jamb_near_high",
      "jamb_near_low",
    ]);
  });

  /**
   * Two, not one, and the number is the assertion. The casings on either side of a wall are
   * joined by the wall, which is not part of the fitting -- so a check demanding a single
   * piece would refuse a frame that is correct.
   */
  it("comes out as one piece per wall face", () => {
    expect(checkAssembly(expandFitting(spec).parts).components).toHaveLength(2);
  });

  it("is welded into one piece by a threshold laid across the opening", () => {
    const out = expandFitting({ ...spec, threshold: true } as FittingSpec);
    expect(checkAssembly(out.parts).components).toHaveLength(1);
  });

  it("sits the head on the jambs rather than through them", () => {
    const head = named(spec, "head_near");
    const jamb = named(spec, "jamb_near_low");
    expect(head.mins[2]).toBe(jamb.maxs[2]);
    expect(touch(head, jamb)).toBe(true);
    expect(interiorsMeet(head, jamb)).toBe(false);
  });

  it("laps onto the wall and stands off it by the tabled amounts", () => {
    const jamb = named(spec, "jamb_near_low");
    expect(jamb.maxs[0] - jamb.mins[0]).toBe(DOOR.casingWidth.units);
    expect(jamb.mins[1]).toBe(-DOOR.casingProud.units);
    expect(jamb.maxs[1]).toBe(0);
  });

  it("works out which way the wall runs from the opening itself", () => {
    // The same hole through a wall running along y instead.
    const out = expandFitting({ fitting: "door_frame", mins: [0, 100, 0], maxs: [8, 148, 112] });
    const jamb = out.parts.find((p) => p.name === "jamb_near_low")!;
    expect(jamb.maxs[1] - jamb.mins[1]).toBe(DOOR.casingWidth.units);
  });

  it("refuses a hole that is square in plan, having no way to tell", () => {
    expect(() =>
      expandFitting({ fitting: "door_frame", mins: [0, 0, 0], maxs: [48, 48, 112] }),
    ).toThrow(/which way the wall runs/);
  });

  /** Both models Valve ships have a 48-unit leaf. A narrower hole takes no door at all. */
  it("says when the opening is too narrow for any door the game ships", () => {
    const out = expandFitting({ fitting: "door_frame", mins: [100, 0, 0], maxs: [132, 8, 112] });
    expect(out.notes.join(" ")).toMatch(/48-unit\s+leaf/);
  });
});

describe("skirting", () => {
  const spec: FittingSpec = { fitting: "skirting", mins: [0, 0, 0], maxs: [256, 192, 128] };

  it("runs round all four walls as one piece", () => {
    const out = expandFitting(spec);
    expect(out.specs).toHaveLength(4);
    expect(checkAssembly(out.parts).components).toHaveLength(1);
  });

  it("stands at the tabled height, on the floor", () => {
    const out = expandFitting(spec);
    for (const p of out.parts) {
      expect(p.mins[2]).toBe(0);
      expect(p.maxs[2]).toBe(TRIM.skirtingHeight.units);
    }
  });

  it("runs at the ceiling instead when asked for a cornice", () => {
    const out = expandFitting({ ...spec, at: "ceiling" } as FittingSpec);
    for (const p of out.parts) {
      expect(p.maxs[2]).toBe(128);
      expect(p.mins[2]).toBe(128 - TRIM.corniceHeight.units);
    }
  });

  it("leaves out the wall a doorway is in", () => {
    const out = expandFitting({ ...spec, omit: ["-y"] } as FittingSpec);
    expect(out.specs).toHaveLength(3);
    expect(checkAssembly(out.parts).components).toHaveLength(1);
  });

  /**
   * Opposite walls never touch, so omitting both of one pair splits the run in two. The
   * count is worked out from which walls survive and compared against the geometry, so the
   * two have to agree.
   */
  it("splits into two when both walls of a pair are left out", () => {
    const out = expandFitting({ ...spec, omit: ["-y", "+y"] } as FittingSpec);
    expect(checkAssembly(out.parts).components).toHaveLength(2);
  });

  it("refuses a room too narrow to take trim on both facing walls", () => {
    expect(() =>
      expandFitting({ fitting: "skirting", mins: [0, 0, 0], maxs: [256, 2, 128] }),
    ).toThrow(/not wide enough/);
  });

  it("refuses to build nothing", () => {
    expect(() =>
      expandFitting({ ...spec, omit: ["-x", "+x", "-y", "+y"] } as FittingSpec),
    ).toThrow(/no skirting to build/);
  });
});
