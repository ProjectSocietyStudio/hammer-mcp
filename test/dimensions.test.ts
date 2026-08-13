/**
 * The scale Source is actually built at, pinned so it cannot drift.
 *
 * `dimensions.ts` exists because three rounds of dogfooding produced maps whose every
 * number was invented at the call site. What replaced the invention is a measurement, and a
 * measurement is only worth having if something notices when it changes.
 */
import { describe, expect, it } from "vitest";
import {
  COUNTER,
  DOOR,
  PLAYER,
  SHELF,
  TRIM,
  UNITS_PER_INCH,
  fromInches,
} from "../src/vmf/fittings/dimensions.js";

describe("the measured dimensions", () => {
  /**
   * The finding the whole table rests on, asserted so it cannot drift: Source's world is
   * built a third taller than real, and its own player is not. Three unrelated models
   * confirmed it -- a 30 in desk at 39.601, an 80 in door leaf at 108, a 72 in vending
   * machine at 96.578 -- and the player hull is 72 units for a six-foot body.
   */
  it("carries real heights at four thirds, and the player at one to one", () => {
    expect(UNITS_PER_INCH).toBeCloseTo(4 / 3, 10);
    expect(PLAYER.height).toBe(72);
    expect(fromInches(42)).toBe(COUNTER.shopHeight.units);
  });

  /**
   * Where the measurement and the arithmetic disagree, and by how much.
   *
   * This started life as `expect(fromInches(80)).toBe(DOOR.leafHeight.units)` and failed:
   * 106 against 108. The measurement is right and the assertion was wrong -- Valve's leaf
   * sits at 1.35 units to the inch, not 1.333, and the table takes the measured figure
   * because a measurement beats a derivation every time they meet.
   *
   * What is worth pinning is the claim the table actually makes: that four thirds predicts
   * the measured world to within a couple of units. Two is the observed disagreement, so
   * three is the bar -- close enough to fail if the constant drifts, loose enough not to
   * assert an equality that is not true.
   */
  it("predicts the measured door leaf to within a couple of units", () => {
    expect(Math.abs(fromInches(80) - DOOR.leafHeight.units)).toBeLessThanOrEqual(3);
  });

  /**
   * The guard is against a number arriving with nothing behind it -- an empty source, or a
   * `TODO` -- which is how a guessed figure gets in wearing the same clothes as a measured
   * one. An earlier version pattern-matched the wording and failed a perfectly good entry
   * (`openingHeight`, derived from another entry rather than from inches or a model), which
   * is the wrong thing to police: the vocabulary is not the point, the traceability is.
   */
  it("gives every number a provenance", () => {
    for (const table of [DOOR, COUNTER, TRIM]) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.source, `${key} has no provenance`).not.toMatch(/TODO|TBD|^\s*$/i);
        expect(value.source.length, `${key}'s provenance says nothing`).toBeGreaterThan(12);
        expect(value.units).toBeGreaterThan(0);
      }
    }
  });

  /** Off-grid corners are what produce the hairline cracks no compile log reports. */
  it("lands every derived height on a whole even unit", () => {
    for (const inches of [1.5, 3, 4, 5, 36, 42, 80]) {
      expect(fromInches(inches) % 2).toBe(0);
    }
  });
});
