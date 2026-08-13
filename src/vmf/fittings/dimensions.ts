/**
 * How big things are, measured rather than guessed.
 *
 * Three rounds of dogfooding produced a map that sealed, satisfied every rule of its brief
 * and compiled clean -- and looked, in game, like grey boxes in a grey room. The counter was
 * one brush. The shelving was one brush. Nothing in it was built to any dimension a body
 * would recognise, because nothing in this toolkit knew one.
 *
 * This file is where that knowledge lives, and every number in it carries where it came
 * from. Two kinds only:
 *
 * - **measured** -- read off a model Valve ships, with `read_model_info`, on 13/08/2026.
 *   The model path is named so anybody can re-run the measurement.
 * - **derived** -- a real-world dimension carried through {@link UNITS_PER_INCH}, which is
 *   itself measured. The real figure is stated so the arithmetic is checkable.
 *
 * There is deliberately no third kind. A number nobody can trace is the thing this file
 * exists to replace.
 *
 * ## The finding that made the rest possible
 *
 * Source's world is **not** built at one unit to the inch, and its own player is. Measured
 * on three unrelated models that happen to have unambiguous real-world counterparts:
 *
 * | Model | Real | Measured | Ratio |
 * |---|---|---|---|
 * | `props_interiors/furniture_desk01a` | 30 in desk | 39.601 | 1.320 |
 * | `props_doors/door01_dynamic` | 80 in door leaf | 108.000 | 1.350 |
 * | `props_interiors/vendingmachinesoda01a` | 72 in machine | 96.578 | 1.341 |
 *
 * Four thirds, to within one and a half per cent, three times over. Meanwhile the player
 * hull is 72 units for a six-foot body -- **one to one**. So Valve's architecture stands a
 * third taller than the player it is built around, and that is not an accident of art
 * direction: a room built to honest real-world heights reads as a crawlspace through a
 * Source camera, which is exactly what the bodega's 176-unit ceiling did.
 *
 * ## And the exception, which is just as measured
 *
 * The factor holds for **height**. It does not hold in plan: casework depth comes back at
 * real-world inches, one to one, on four unrelated models --
 *
 * | Model | Depth |
 * |---|---|
 * | `props_interiors/sinkkitchen01a` | 23.877 |
 * | `props_interiors/furniture_cabinetdrawer01a` | 23.220 |
 * | `props_interiors/furniture_cabinetdrawer02a` | 21.110 |
 * | `props_interiors/refrigerator01a` | 33.828 |
 *
 * -- which are a 24-inch cabinet and a 34-inch fridge at face value. So a counter is 24
 * units deep and 56 units tall, and neither of those is a compromise.
 *
 * The one opening dimension resists both readings and is therefore taken as measured rather
 * than explained: a door leaf is **48 wide**, on both models that have one, where a real
 * door is 32 to 36. A doorway is the one fitting a 32-unit-wide player has to fit through,
 * and 48 is what Valve chose. No theory is offered here for why; the number is the number.
 *
 * ## Everything lands on the grid
 *
 * Derived values are rounded to a whole unit, and to a multiple of two wherever the choice
 * is free. `shapes.ts` learned this the expensive way -- off-grid corners are what produce
 * the hairline cracks no compile log reports -- and a 0.75-inch skirting projection, carried
 * through honestly, would be one unit and invisible. Where a rounded number is visibly not
 * the arithmetic, the entry says so.
 */

/**
 * World units per real-world inch, for **heights**.
 *
 * Measured, not chosen: see the table in this file's header. Use it for anything whose
 * height a standing body reads -- a counter, a sill, a rail, a lintel. Do not use it in
 * plan: depths and footprints measure one to one, which the header also shows.
 */
export const UNITS_PER_INCH = 4 / 3;

/** A real-world height in inches, as Source builds it: to the grid, and to a whole unit. */
export function fromInches(inches: number): number {
  const raw = inches * UNITS_PER_INCH;
  // To the nearest even unit. Odd-unit geometry is legal and lands on the grid, but every
  // fitting here is symmetrical about something, and an odd overall size makes a centred
  // part land on a half unit -- which is the one place a corner leaves the grid.
  return Math.round(raw / 2) * 2;
}

/** Where a number in this file comes from. There is no third option on purpose. */
export interface Provenance {
  /** The value, in world units. */
  units: number;
  /** `measured` names a model; `derived` names the real-world figure it came from. */
  source: string;
}

const measured = (units: number, model: string): Provenance => ({
  units,
  source: `measured on ${model} with read_model_info, 13/08/2026`,
});

const derived = (inches: number, what: string, units = fromInches(inches)): Provenance => ({
  units,
  source: `${inches} in ${what}, x${UNITS_PER_INCH.toFixed(3)} = ${(inches * UNITS_PER_INCH).toFixed(1)}, to the grid`,
});

/**
 * The player, which is the ruler everything else is read against.
 *
 * These are engine constants rather than measurements of content, and they are restated
 * here because every dimension below is only meaningful beside them. `src/space/voxel.ts`
 * derives `STANDING_CELLS` from the same 72.
 */
export const PLAYER = {
  /** Standing hull height. A six-foot body at one unit to the inch. */
  height: 72,
  /** Standing hull width and depth. */
  width: 32,
  /** Where the camera sits. Source's own `VEC_VIEW`. */
  eye: 64,
  /** The tallest lip a player walks over without jumping. */
  step: 18,
} as const;

/**
 * A doorway, and the casing round it.
 *
 * The leaf figure is the one to build openings from: a hole narrower than 48 cannot take a
 * door Valve ships, and a hole exactly 48 wide leaves a 32-wide player eight units either
 * side, which is the clearance HL2 corridors are cut to.
 */
export const DOOR = {
  /** Both door models agree: 48.5 and 48.0. */
  leafWidth: measured(48, "props_c17/door01_left and props_doors/door01_dynamic"),
  /** 108.5 and 108.0. Also the cleanest confirmation of UNITS_PER_INCH in the file. */
  leafHeight: measured(108, "props_c17/door01_left and props_doors/door01_dynamic"),
  /**
   * The hole to cut. The leaf height rounded up to the next multiple of 16, so the opening
   * clears the leaf and its top lands where wall brushwork usually already has an edge.
   */
  openingHeight: { units: 112, source: "leafHeight 108, up to the next multiple of 16" },
  /** How far the casing laps onto the wall either side of the hole. A 2.5 in architrave. */
  casingWidth: derived(3, "architrave", 4),
  /**
   * How far the casing stands out from the wall face. Honest arithmetic on a 0.75 in casing
   * gives 1, and one unit of relief is invisible at any distance a player stands.
   */
  casingProud: { units: 2, source: "0.75 in casing would be 1 unit; 2 is the least that reads" },
  /** A threshold strip under the opening. */
  thresholdHeight: derived(1.5, "threshold"),
} as const;

/**
 * A counter: shop, bar or kitchen.
 *
 * Height is the number that decides whether the thing reads as a counter or as a crate.
 * The player's eye is at 64, so a 56-unit shop counter is met just below the chin -- which
 * is what serving over a counter looks like -- and a 48-unit kitchen run is at the elbow.
 */
export const COUNTER = {
  /** A serving counter, 42 in. Chest height on a standing player. */
  shopHeight: derived(42, "shop or bar counter"),
  /** A kitchen run, 36 in. */
  kitchenHeight: derived(36, "kitchen counter"),
  /** In plan, so one to one: the four casework models measure 21 to 34. */
  depth: measured(24, "sinkkitchen01a at 23.877 and furniture_cabinetdrawer01a at 23.220"),
  /** The slab itself. A 1.5 in worktop would be 2; 4 keeps the front edge on the grid. */
  topThickness: { units: 4, source: "1.5 in worktop would be 2 units; 4 to stay on the grid" },
  /** How far the top oversails the body on the served side. */
  overhang: derived(1.5, "worktop nosing", 2),
  /** The recess at the foot, which is what stops a counter reading as a solid block. */
  kickHeight: derived(4, "toe kick"),
  /** How far that recess is set back. */
  kickDepth: derived(3, "toe kick", 4),
} as const;

/**
 * Skirting, and its opposite at the ceiling.
 *
 * The cheapest detail in the file and the one whose absence is most visible: in the round-3
 * screenshots the wall meets the floor at a bare right angle in every shot, and a bare right
 * angle is the single clearest tell that a room was built by somebody who stopped early.
 */
export const TRIM = {
  /** A 4 in skirting board. */
  skirtingHeight: derived(4, "skirting board"),
  /** Same reasoning as the door casing: honest arithmetic gives 1, and 1 does not read. */
  skirtingProud: { units: 2, source: "0.5 in board would be 1 unit; 2 is the least that reads" },
  /** A 5 in cornice, for the wall-to-ceiling joint. */
  corniceHeight: derived(5, "cornice"),
  corniceProud: { units: 2, source: "matches skirtingProud, so a room's two trims agree" },
} as const;

/**
 * Shelving, kept here because its depth is the one dimension that interacts with a defect.
 *
 * `building.md` measured on 13/08/2026 that a furniture run 48 units deep collapses the room
 * segmentation from 200 units away, where the same run at 32 does not. A shelf unit Valve
 * ships is **19 deep** -- comfortably under that, which is worth stating: building to the
 * measured dimension avoids the trap for free, and building to a guessed one is how the
 * round-3 map lost a doorway.
 */
export const SHELF = {
  depth: measured(19, "props_interiors/furniture_shelf01a at 18.953"),
  height: measured(87, "props_interiors/furniture_shelf01a at 87.324"),
  width: measured(49, "props_interiors/furniture_shelf01a at 48.906"),
} as const;
