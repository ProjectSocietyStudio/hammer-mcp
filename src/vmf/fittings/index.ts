/**
 * Fittings: the things a room is finished with, rather than the things it is made of.
 *
 * `shapes.ts` sits one step above a box -- an arch, a sphere, a flight of stairs are each
 * several brushes, and it writes them so a caller does not have to. This sits one step above
 * that, and the step is not geometric but dimensional.
 *
 * The distinction is the whole point, so it is worth stating plainly. A compound *shape*
 * takes every number from its caller: an arch is whatever radius you asked for. A *fitting*
 * takes its envelope from the caller and everything inside it from {@link dimensions.ts} --
 * the thickness of a worktop, the setback of a toe kick, how far an architrave stands off a
 * wall. Those are exactly the numbers a builder has no way to know and, measured over three
 * rounds of dogfooding, never once got right: the round-3 map's counter was a single 40-unit
 * box, and so was its shelving, and so was everything else in it.
 *
 * So the trade a fitting offers is: **you own the envelope, it owns the articulation.** Ask
 * for a counter in the same `mins`/`maxs` you would have given a box, and get a worktop with
 * a nosing over a body over a recessed kick -- three brushes, at dimensions taken off models
 * Valve ships.
 *
 * Each one is checked against {@link checkAssembly} before it leaves here, which is the
 * invariant per-brush validation cannot see: the parts touch, and their interiors do not
 * meet.
 */
import { VmfBuildError } from "../build.js";
import type { SolidSpec } from "../build.js";
import type { Vec3 } from "../solid.js";
import { COUNTER, DOOR, SHELF, TRIM } from "./dimensions.js";
import { checkAssembly } from "./integrity.js";
import type { Part } from "./integrity.js";

/** Which side of a fitting a person stands on. */
export type Facing = "+x" | "-x" | "+y" | "-y";

export interface DoorFrameSpec {
  fitting: "door_frame";
  /** The hole already cut in the wall. The casing is built around it, not inside it. */
  mins: Vec3;
  maxs: Vec3;
  /** Casing on one wall face or both. Both, unless the far side is never seen. */
  sides?: "both" | "near" | "far";
  /** A raised strip across the foot of the opening. */
  threshold?: boolean;
}

export interface CounterSpec {
  fitting: "counter";
  /** The envelope, exactly as a box would take it. */
  mins: Vec3;
  maxs: Vec3;
  /** The side people stand at: where the top oversails and the kick is set back. */
  facing: Facing;
}

export interface SkirtingSpec {
  fitting: "skirting";
  /** The room's inner floor rectangle. `mins[2]` is the floor; `maxs[2]` is ignored. */
  mins: Vec3;
  maxs: Vec3;
  /** Walls to leave bare, because a doorway or a run of casework is against them. */
  omit?: Facing[];
  /** Run it at the ceiling instead, as a cornice. `maxs[2]` is then the ceiling. */
  at?: "floor" | "ceiling";
}

export type FittingSpec = DoorFrameSpec | CounterSpec | SkirtingSpec;

export interface FittingExpansion {
  specs: SolidSpec[];
  parts: Part[];
  notes: string[];
  /** How far the fitting stands out from the wall it is against, or how deep it is. */
  depth: number;
  /**
   * How many pieces of one tenant this fitting is supposed to come out as.
   *
   * Declared by each branch, and compared against what the parts actually form. Getting a
   * different number is how a head floating clear of its jambs announces itself: the parts
   * are all valid brushes and every one of them passes per-brush validation, but four
   * pieces came out of something that had to be two.
   */
  expectedComponents: number;
}

/**
 * A mutable triple, for building a corner one axis at a time.
 *
 * `Vec3` is readonly, which is right for everything that travels between modules and wrong
 * for the local arithmetic below: a door frame decides its through-axis at run time and then
 * assigns into it, which a readonly tuple will not have.
 */
type Xyz = [number, number, number];

const box = (name: string, mins: Vec3, maxs: Vec3): Part => ({ name, mins, maxs });

const toSpec = (p: Part): SolidSpec => ({
  shape: "box",
  mins: [...p.mins] as Vec3,
  maxs: [...p.maxs] as Vec3,
});

/** Refuses an envelope that is not a box at all, which every fitting below assumes. */
function requirePositive(mins: Vec3, maxs: Vec3, what: string): void {
  for (const axis of [0, 1, 2] as const) {
    if (maxs[axis] <= mins[axis]) {
      throw new VmfBuildError(
        `a ${what} needs an envelope with a positive extent on every axis, and this one ` +
          `spans ${maxs[axis] - mins[axis]} on ${"xyz"[axis]}`,
      );
    }
  }
}

/**
 * A counter: worktop, body, recessed kick.
 *
 * The height is the caller's and is only reported on, never corrected -- a bodega counter
 * and a bar are different heights on purpose, and `check_vmf_rules` is where a brief gets
 * to insist. What is not the caller's is the articulation, because that is what was missing.
 */
function counter(spec: CounterSpec): FittingExpansion {
  requirePositive(spec.mins, spec.maxs, "counter");
  const axis = spec.facing.endsWith("x") ? 0 : 1;
  const towardsMax = spec.facing.startsWith("+");
  const height = spec.maxs[2] - spec.mins[2];
  const depth = spec.maxs[axis]! - spec.mins[axis]!;

  const kickH = COUNTER.kickHeight.units;
  const topT = COUNTER.topThickness.units;
  if (height <= kickH + topT) {
    throw new VmfBuildError(
      `a counter ${height} units tall has no body left: ${kickH} of it is the toe kick and ` +
        `${topT} is the worktop. Build it taller than ${kickH + topT}, or use a plain box.`,
    );
  }
  if (depth <= COUNTER.kickDepth.units) {
    throw new VmfBuildError(
      `a counter ${depth} units deep cannot have a ${COUNTER.kickDepth.units}-unit toe kick ` +
        `set into it. ${COUNTER.depth.units} is what Valve's own casework measures.`,
    );
  }

  const bodyTop = spec.maxs[2] - topT;
  const kickTop = spec.mins[2] + kickH;

  const kickMins: Xyz = [...spec.mins];
  const kickMaxs: Xyz = [spec.maxs[0], spec.maxs[1], kickTop];
  if (towardsMax) kickMaxs[axis] = spec.maxs[axis]! - COUNTER.kickDepth.units;
  else kickMins[axis] = spec.mins[axis]! + COUNTER.kickDepth.units;

  const topMins: Xyz = [spec.mins[0], spec.mins[1], bodyTop];
  const topMaxs: Xyz = [...spec.maxs];
  if (towardsMax) topMaxs[axis] = spec.maxs[axis]! + COUNTER.overhang.units;
  else topMins[axis] = spec.mins[axis]! - COUNTER.overhang.units;

  const parts = [
    box("kick", kickMins, kickMaxs),
    box("body", [spec.mins[0], spec.mins[1], kickTop], [spec.maxs[0], spec.maxs[1], bodyTop]),
    box("top", topMins, topMaxs),
  ];

  const notes = [
    `3 brushes: a worktop oversailing the body by ${COUNTER.overhang.units} on the ${spec.facing} ` +
      `side, over a kick set back ${COUNTER.kickDepth.units}. Both dimensions come from the ` +
      `measured table, not from the envelope.`,
  ];
  // Reported, not enforced. The two heights in the table are the two a counter is usually
  // built to, and a builder who has landed 8 units off one of them has almost always meant
  // to hit it -- but a serving hatch or a display plinth is a counter at a height nobody
  // tabulated, and refusing that would be the tool deciding a design question.
  const wanted = [COUNTER.shopHeight.units, COUNTER.kitchenHeight.units];
  if (!wanted.includes(height)) {
    notes.push(
      `this counter is ${height} units tall. Measured against Valve's own scale a shop or bar ` +
        `counter is ${COUNTER.shopHeight.units} and a kitchen run is ` +
        `${COUNTER.kitchenHeight.units}, with the player's eye at 64.`,
    );
  }
  if (depth > 32) {
    notes.push(
      `it is ${depth} units deep. Furniture past about 32 has been measured to collapse the ` +
        `room segmentation from 200 units away; Valve's casework is ${COUNTER.depth.units}.`,
    );
  }

  return { specs: parts.map(toSpec), parts, notes, depth, expectedComponents: 1 };
}

/**
 * A door casing: two jambs and a head, on one wall face or on both.
 *
 * The joint is the ordinary one a joiner would cut: the jambs run to the top of the opening
 * and the head sits across them. They meet on that plane and share nothing, which is what
 * makes the assembly check meaningful rather than decorative.
 */
function doorFrame(spec: DoorFrameSpec): FittingExpansion {
  requirePositive(spec.mins, spec.maxs, "door frame");
  const spanX = spec.maxs[0] - spec.mins[0];
  const spanY = spec.maxs[1] - spec.mins[1];
  if (spanX === spanY) {
    throw new VmfBuildError(
      `this opening is ${spanX} by ${spanY} in plan, so there is no telling which way the ` +
        `wall runs. A door frame is built around a hole that is thin through the wall and ` +
        `wide across it.`,
    );
  }
  // The wall's thickness is the short plan axis; the opening's width is the long one.
  const through: 0 | 1 = spanX < spanY ? 0 : 1;
  const across: 0 | 1 = through === 0 ? 1 : 0;

  const casing = DOOR.casingWidth.units;
  const proud = DOOR.casingProud.units;
  const parts: Part[] = [];

  const faces: ("near" | "far")[] =
    spec.sides === "near" ? ["near"] : spec.sides === "far" ? ["far"] : ["near", "far"];

  for (const face of faces) {
    // `near` is the low side of the through axis, so its casing stands off towards -through.
    const at = face === "near" ? spec.mins[through]! : spec.maxs[through]!;
    const t0 = face === "near" ? at - proud : at;
    const t1 = face === "near" ? at : at + proud;

    const jamb = (side: "low" | "high"): Part => {
      const w0 =
        side === "low" ? spec.mins[across]! - casing : spec.maxs[across]!;
      const w1 = side === "low" ? spec.mins[across]! : spec.maxs[across]! + casing;
      const mins: Xyz = [0, 0, spec.mins[2]];
      const maxs: Xyz = [0, 0, spec.maxs[2]];
      mins[through] = t0;
      maxs[through] = t1;
      mins[across] = w0;
      maxs[across] = w1;
      return box(`jamb_${face}_${side}`, mins, maxs);
    };

    const head = (): Part => {
      const mins: Xyz = [0, 0, spec.maxs[2]];
      const maxs: Xyz = [0, 0, spec.maxs[2] + casing];
      mins[through] = t0;
      maxs[through] = t1;
      // Across the jambs' outer edges, so the three read as one frame rather than as a
      // lintel that stops short.
      mins[across] = spec.mins[across]! - casing;
      maxs[across] = spec.maxs[across]! + casing;
      return box(`head_${face}`, mins, maxs);
    };

    parts.push(jamb("low"), jamb("high"), head());
  }

  if (spec.threshold) {
    const mins: Xyz = [0, 0, spec.mins[2]];
    const maxs: Xyz = [0, 0, spec.mins[2] + DOOR.thresholdHeight.units];
    mins[through] = spec.mins[through]!;
    maxs[through] = spec.maxs[through]!;
    mins[across] = spec.mins[across]!;
    maxs[across] = spec.maxs[across]!;
    parts.push(box("threshold", mins, maxs));
  }

  const width = spec.maxs[across]! - spec.mins[across]!;
  const height = spec.maxs[2] - spec.mins[2];
  const notes = [
    `${parts.length} brushes: jambs to the head of the opening, the head across them, ` +
      `standing ${proud} off each wall face and lapping ${casing} onto it.`,
  ];
  if (width < DOOR.leafWidth.units) {
    notes.push(
      `the opening is ${width} wide. Both door models Valve ships have a ${DOOR.leafWidth.units}-unit ` +
        `leaf, so nothing will hang in this one -- and a 32-unit player passes it with ` +
        `${(width - 32) / 2} either side.`,
    );
  }
  if (height < DOOR.leafHeight.units) {
    notes.push(
      `the opening is ${height} tall against a ${DOOR.leafHeight.units}-unit leaf. ` +
        `${DOOR.openingHeight.units} is the usual cut.`,
    );
  }

  // One frame per wall face, because the two are joined by the wall and the wall is not
  // ours. A threshold laid across the opening touches both, and welds them into one.
  return {
    specs: parts.map(toSpec),
    parts,
    notes,
    depth: proud,
    expectedComponents: spec.threshold ? 1 : faces.length,
  };
}

/**
 * Skirting round the inside of a room, or a cornice at its ceiling.
 *
 * The four runs butt rather than mitre: the two along x span the full rectangle and the two
 * along y are inset by the projection at each end. That is a choice, and it is the one that
 * makes the assembly check exact -- a mitre is two wedges meeting on a diagonal plane, which
 * no axis-aligned box can express and no integer arithmetic can verify.
 */
function skirting(spec: SkirtingSpec): FittingExpansion {
  requirePositive(spec.mins, spec.maxs, "run of skirting");
  const ceiling = spec.at === "ceiling";
  const height = ceiling ? TRIM.corniceHeight.units : TRIM.skirtingHeight.units;
  const proud = ceiling ? TRIM.corniceProud.units : TRIM.skirtingProud.units;

  const z0 = ceiling ? spec.maxs[2] - height : spec.mins[2];
  const z1 = ceiling ? spec.maxs[2] : spec.mins[2] + height;

  const omit = new Set(spec.omit ?? []);
  const [x0, y0] = [spec.mins[0], spec.mins[1]];
  const [x1, y1] = [spec.maxs[0], spec.maxs[1]];

  if (x1 - x0 <= 2 * proud || y1 - y0 <= 2 * proud) {
    throw new VmfBuildError(
      `a room ${x1 - x0} by ${y1 - y0} is not wide enough for ${proud} units of trim on ` +
        `each of its facing walls`,
    );
  }

  const parts: Part[] = [];
  // The x-runs take the full span and the y-runs give way at each end. Reversing that would
  // be equally correct and would produce a different set of brushes, so it is fixed here
  // rather than decided per call: a fitting that rebuilds differently on identical input is
  // a fitting whose diffs cannot be read.
  if (!omit.has("-y")) parts.push(box("run", [x0, y0, z0], [x1, y0 + proud, z1]));
  if (!omit.has("+y")) parts.push(box("run", [x0, y1 - proud, z0], [x1, y1, z1]));
  if (!omit.has("-x")) parts.push(box("run", [x0, y0 + proud, z0], [x0 + proud, y1 - proud, z1]));
  if (!omit.has("+x")) parts.push(box("run", [x1 - proud, y0 + proud, z0], [x1, y1 - proud, z1]));

  if (parts.length === 0) {
    throw new VmfBuildError("every wall was omitted, so there is no skirting to build");
  }

  // Runs against adjacent walls butt at the corner and so hold together; runs against
  // opposite walls never touch. So the four go round in a ring, and omitting some cuts that
  // ring into arcs -- one piece if nothing is omitted, otherwise one per surviving arc.
  // Working it out here rather than reading it back off the geometry is what makes it an
  // assertion: the two are derived independently and `expandFitting` compares them.
  const ring: Facing[] = ["-y", "+x", "+y", "-x"];
  const present = ring.map((w) => !omit.has(w));
  const expectedComponents = present.every(Boolean)
    ? 1
    : present.filter((here, i) => here && !present[(i + ring.length - 1) % ring.length]).length;

  const notes = [
    `${parts.length} run${parts.length === 1 ? "" : "s"}, ${height} tall and ${proud} proud, ` +
      `butted at the corners. ${ceiling ? "Cornice" : "Skirting"} is the cheapest detail there ` +
      `is and its absence is the clearest tell that a room was left unfinished.`,
  ];
  if (omit.size === 0) {
    notes.push(
      "no wall was omitted. A run across a doorway is the usual mistake here -- pass the " +
        "walls that have openings in `omit`.",
    );
  }

  return { specs: parts.map(toSpec), parts, notes, depth: proud, expectedComponents };
}

/**
 * Builds a fitting, and refuses to hand back one that is not whole.
 *
 * The check is here rather than at the tool because a fitting that fails it is a defect in
 * this file, not in the call: every branch above chooses its own joints, so an overlap or a
 * detached part means the arithmetic is wrong. Refusing at the point of construction means a
 * test can drive it directly, without a .vmf and without a filesystem.
 */
export function expandFitting(spec: FittingSpec): FittingExpansion {
  const expansion =
    spec.fitting === "counter"
      ? counter(spec)
      : spec.fitting === "door_frame"
        ? doorFrame(spec)
        : skirting(spec);

  const integrity = checkAssembly(expansion.parts);
  if (integrity.overlaps.length > 0) {
    throw new VmfBuildError(
      `this ${spec.fitting} has parts that share an interior: ` +
        integrity.overlaps.map((o) => `${o.a} and ${o.b} by ${o.volume} cubic units`).join("; ") +
        `. Parts of a fitting meet on a plane and never lap.`,
    );
  }
  if (integrity.components.length !== expansion.expectedComponents) {
    throw new VmfBuildError(
      `this ${spec.fitting} came out as ${integrity.components.length} separate pieces where ` +
        `it should be ${expansion.expectedComponents}: ` +
        integrity.components.map((c) => `[${c.join(" + ")}]`).join(", ") +
        `. Something that should be joined is not touching.`,
    );
  }
  return expansion;
}

export { SHELF };
