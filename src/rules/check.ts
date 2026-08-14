/**
 * Judging a map against its own rules.
 *
 * Every check here is a measurement from `src/space/measure.ts` compared with a number from
 * the map's rules file. Nothing is decided in this file: it resolves what a rule points at,
 * calls the measurement, and reports the comparison with **both** numbers -- what was asked
 * for and what is there. A violation that says only "too narrow" sends the reader back to
 * measure it themselves.
 *
 * The output is deliberately shaped so a violation can be *looked at*: every one carries the
 * worst point, which `render_vmf_view` and `render_vmf_plan` both accept. Measure, locate,
 * look -- and the loop closes without anyone compiling anything.
 */
import {
  bodyFits,
  clearanceInFront,
  headroom,
  HULL_CROUCHING,
  HULL_STANDING,
  narrowestWidth,
  standingAt,
} from "../space/measure.js";
import type { BodyFit } from "../space/measure.js";
import { findRooms } from "../space/rooms.js";
import type { RoomsResult } from "../space/rooms.js";
import { MASK_PLAYER, MASK_SIGHT, MASK_SOLID } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { traceRay } from "../space/trace.js";
import { voxelise } from "../space/voxel.js";
import type { VoxelGrid } from "../space/voxel.js";
import { readEntities } from "../vmf/edit.js";
import type { VmfEntity } from "../vmf/edit.js";
import type { Vec3 } from "../vmf/solid.js";
import type { Anchor, Rule, RulesFile } from "./schema.js";

export interface Violation {
  ruleId: string;
  severity: "error" | "warning" | "info";
  what: string;
  /** What the rule asked for, in the rule's own units. */
  required: string;
  /** What is actually there. */
  measured: number | null;
  /** The worst point: pass it to render_vmf_view or render_vmf_plan and look. */
  at: Vec3 | null;
  /** What the finding is about, named the way the map names it. */
  subject: string;
  message: string;
  note?: string;
  /**
   * How the measurement was taken, for the checks where a bare number is ambiguous.
   *
   * A sub-object rather than flat fields because `headroom` and `room_area` have nothing to
   * put in it. What it exists to end: `clearance in front is 0 units` with no statement of
   * which way "in front" was taken and no mention that the hull did not fit where the sweep
   * started -- the same output for a wrong yaw convention and for a marker standing inside a
   * counter, which cost a builder its first and costlier hypothesis (issue #59).
   */
  evidence?: {
    /** False when the hull was already inside a brush, so `measured` means nothing. */
    hullFits: boolean;
    /** The brush occupied at the measuring point, when the hull did not fit. */
    startsInside: { brushId: number; owner: string } | null;
    /** What stopped the sweep, when something did. */
    blockedBy?: { brushId: number | null; material: string | null } | null;
    /** The direction swept, as a unit vector. Only for checks that have one. */
    facing?: Vec3;
    /** The yaw that direction came from, in degrees, and where it came from. */
    yawDegrees?: number;
    /** The hull assumed, stated because it is an assumption and not a measurement. */
    assumedHull: Vec3;
  };
}

export interface RulesReport {
  checked: number;
  /**
   * The segmentation every room and portal rule was judged against, or null when no rule
   * needed one.
   *
   * Reported because without it a caller cannot tell a rules file that is wrong from a
   * map that is wrong from a room pass that found nothing. On 13/08/2026 an agent got
   * `matchedNothing: ["doorways-wide-enough"]` with a note blaming the rules file, on a
   * map whose rules file and geometry were both correct: the room pass had found one room
   * and no portals at the default cell size. The tool had that number in hand and did not
   * say it.
   */
  segmentation: { rooms: number; portals: number; step: number } | null;
  /** Rules that matched nothing. A rule about a room that does not exist is a finding. */
  matchedNothing: string[];
  violations: Violation[];
  errorCount: number;
  warningCount: number;
  notes: string[];
}

const HULLS = { standing: HULL_STANDING, crouching: HULL_CROUCHING } as const;

function keyOf(e: VmfEntity, key: string): string | null {
  const pair = e.block.entries.find((n) => n.kind === "pair" && n.key === key);
  return pair && pair.kind === "pair" ? pair.value : null;
}

function originOf(e: VmfEntity): Vec3 | null {
  const raw = keyOf(e, "origin");
  if (!raw) return null;
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0]!, parts[1]!, parts[2]!]
    : null;
}

function yawOf(e: VmfEntity): number {
  const raw = keyOf(e, "angles");
  if (!raw) return 0;
  const parts = raw.trim().split(/\s+/).map(Number);
  return parts.length === 3 && Number.isFinite(parts[1]) ? parts[1]! : 0;
}

function resolveAnchor(
  anchor: Anchor,
  entities: readonly VmfEntity[],
  rooms: RoomsResult | null,
  eyeHeight: number,
): { point: Vec3; name: string } | null {
  if ("point" in anchor) {
    const p = anchor.point;
    return { point: [p[0]!, p[1]!, p[2]!], name: `point ${p.join(" ")}` };
  }
  if ("entity" in anchor) {
    const want = anchor.entity.toLowerCase();
    for (const e of entities) {
      if ((e.targetname ?? "").toLowerCase() !== want) continue;
      const origin = originOf(e);
      if (!origin) continue;
      return { point: [origin[0], origin[1], origin[2] + eyeHeight], name: anchor.entity };
    }
    return null;
  }
  const room = rooms?.rooms.find((r) => r.id === anchor.room);
  if (!room) return null;
  return {
    point: [room.centre[0], room.centre[1], room.centre[2] + eyeHeight],
    name: `room ${room.id}`,
  };
}

/** `min`/`max` as a sentence, so a violation reads without the rules file beside it. */
function boundText(rule: Rule, unit: string): string {
  if (rule.min !== undefined && rule.max !== undefined) {
    return `between ${rule.min} and ${rule.max} ${unit}`;
  }
  if (rule.min !== undefined) return `at least ${rule.min} ${unit}`;
  return `at most ${rule.max} ${unit}`;
}

function outOfBounds(rule: Rule, value: number): boolean {
  if (rule.min !== undefined && value < rule.min) return true;
  if (rule.max !== undefined && value > rule.max) return true;
  return false;
}

const hullText = (half: Vec3): string => `${half[0] * 2}x${half[1] * 2}x${half[2] * 2}`;
const pointText = (p: Vec3): string => `[${p.map((n) => Math.round(n * 1000) / 1000).join(", ")}]`;

/**
 * The finding for a point no body can stand at, which is not the same finding as "too narrow".
 *
 * Both used to come back as a number -- 0 units of clearance, or 32 units of width, the hull's
 * own footprint -- and the caller had no way to tell a real constriction from a measurement
 * that never happened. `measured` is null here for the same reason `measure_vmf_clearance`
 * returns null: this repository would rather admit a gap than return a confident wrong value.
 */
function noBodyFits(
  rule: Rule,
  subject: string,
  from: Vec3,
  fit: BodyFit,
  half: Vec3,
  unit: string,
  swept?: { facing: Vec3; yawDegrees: number; hasOwnYaw: boolean },
): Omit<Violation, "ruleId" | "severity" | "what" | "note"> {
  const inside = fit.insideOf
    ? `brush ${fit.insideOf.brushId} (${fit.insideOf.owner})`
    : `a brush`;
  const direction = swept
    ? ` The direction taken was (${swept.facing[0]}, ${swept.facing[1]}), from yaw ` +
      `${swept.yawDegrees}` +
      (swept.hasOwnYaw
        ? ` -- the entity's own.`
        : ` -- the default, because a room or a doorway has no yaw of its own.`)
    : ``;
  return {
    required: boundText(rule, unit),
    measured: null,
    at: from,
    subject,
    message:
      `${subject}: no body fits where this would be measured. The ${hullText(half)} hull ` +
      `centred at ${pointText(from)} is already inside ${inside}, so every sweep from it ` +
      `returns 0 -- which is not a measurement of the room.${direction} Move the point clear ` +
      `of that brush, or measure with read_vmf_nearest_surface to find how far the open ` +
      `space is. The rule asks for ${boundText(rule, unit)}.`,
    evidence: {
      hullFits: false,
      startsInside: fit.insideOf,
      assumedHull: half,
      ...(swept ? { facing: swept.facing, yawDegrees: swept.yawDegrees } : {}),
    },
  };
}

export interface CheckOptions {
  /**
   * The offcut threshold the room pass merges below, in square units.
   *
   * It is here because `read_vmf_rooms` exposes it and this did not, so the tool a caller
   * uses to *diagnose* a segmentation and the tool that *judges* against it could never be
   * run at the same settings -- every diagnosis was at slightly different parameters from
   * the verdict it was meant to explain.
   */
  minRoomArea?: number;
  /** Height above a floor or origin at which a sight line is taken. Source's own eye. */
  eyeHeight?: number;
  step?: number;
  maxCells?: number;
  seeds?: readonly Vec3[];
}

export function checkRules(
  scene: Scene,
  source: string,
  file: RulesFile,
  options: CheckOptions = {},
): RulesReport {
  const eyeHeight = options.eyeHeight ?? 64;
  const { entities } = readEntities(source);
  const violations: Violation[] = [];
  const matchedNothing: string[] = [];
  const notes: string[] = [];
  /** Verdicts within one cell of their bar, pass or fail. See where they are pushed. */
  const nearMisses: string[] = [];

  // The room pass is only run when a rule needs it: it is the expensive half, and a file of
  // entity rules should not pay for it.
  const needsRooms = file.rules.some(
    (r) => r.select?.room !== undefined || r.select?.portal !== undefined || (r.from && "room" in r.from) || (r.to && "room" in r.to),
  );
  let rooms: RoomsResult | null = null;
  let grid: VoxelGrid | null = null;
  const step = options.step ?? 16;
  if (needsRooms) {
    const seeds =
      options.seeds && options.seeds.length > 0
        ? [...options.seeds]
        : entities
            .filter((e) => /^info_player_(start|teamspawn|deathmatch)$/.test(e.classname))
            .map(originOf)
            .filter((p): p is Vec3 => p !== null)
            .map((p) => [p[0], p[1], p[2] + 16] as Vec3);
    if (seeds.length === 0) {
      notes.push(
        "Some rules are about rooms and there is no spawn entity to flood from, so they " +
          "were not checked. Pass 'seeds' with a point inside the map.",
      );
    } else {
      grid = voxelise(scene, seeds, { step: options.step, maxCells: options.maxCells });
      rooms = findRooms(grid, options.minRoomArea === undefined ? {} : { minRoomArea: options.minRoomArea });
      if (grid.leaked) {
        notes.push(
          "This map is not sealed, so the room pass also filled the outside. read_vmf_leak " +
            "has the path out; room rules below may be about the void.",
        );
      }
    }
  }

  for (const rule of file.rules) {
    const half = HULLS[rule.hull];
    let matched = 0;

    const report = (v: Omit<Violation, "ruleId" | "severity" | "what" | "note">): void => {
      violations.push({
        ruleId: rule.id,
        severity: rule.severity,
        what: rule.what,
        ...(rule.note === undefined ? {} : { note: rule.note }),
        ...v,
      });
    };

    if (rule.what === "sightline") {
      const from = resolveAnchor(rule.from!, entities, rooms, eyeHeight);
      const to = resolveAnchor(rule.to!, entities, rooms, eyeHeight);
      if (!from || !to) {
        matchedNothing.push(rule.id);
        continue;
      }
      matched = 1;
      const t = traceRay(scene, from.point, to.point, MASK_SIGHT);
      const clear = !t.hit;
      const want = rule.mustBe ?? "clear";
      if ((want === "clear") !== clear) {
        report({
          required: `the line from ${from.name} to ${to.name} ${want}`,
          measured: clear ? null : Math.round(t.fraction * 1000) / 1000,
          at: clear ? to.point : t.point,
          subject: `${from.name} -> ${to.name}`,
          // The height is in the message because it had to be reverse-engineered from a
          // violation's own coordinates once: two entities at z 48, a doorway open from 0
          // to 112, a level trace clear by 64 units -- and a blocked verdict, because the
          // trace runs at origin + eyeHeight and struck the lintel. Nothing said so
          // (issue #56).
          message: clear
            ? `${from.name} can see ${to.name} at eye height ${eyeHeight}, and this rule ` +
              `wants that view blocked.`
            : `${from.name} cannot see ${to.name}: traced at eye height ${eyeHeight} above ` +
              `each end, brush ${t.brushId} (${t.material}) is in the way. Nothing else in ` +
              `this toolkit would have mentioned it.`,
        });
      }
      continue;
    }

    // Everything else is a bound on a measurement, over a set of subjects.
    const subjects: Array<{ at: Vec3; name: string; yaw?: number }> = [];

    if (rule.select?.classname || rule.select?.targetname) {
      for (const e of entities) {
        if (
          rule.select.classname &&
          !e.classname.toLowerCase().includes(rule.select.classname.toLowerCase())
        ) {
          continue;
        }
        if (
          rule.select.targetname &&
          !(e.targetname ?? "").toLowerCase().includes(rule.select.targetname.toLowerCase())
        ) {
          continue;
        }
        const origin = originOf(e);
        if (!origin) continue;
        subjects.push({
          at: origin,
          name: e.targetname ? `${e.classname} "${e.targetname}"` : `${e.classname} #${e.id ?? "?"}`,
          yaw: yawOf(e),
        });
      }
    }

    if (rule.select?.room !== undefined && rooms) {
      for (const room of rooms.rooms) {
        if (rule.select.room !== "*" && rule.select.room !== room.id) continue;
        subjects.push({ at: room.centre, name: `room ${room.id}` });
      }
    }

    if (rule.select?.portal !== undefined && rooms) {
      for (const portal of rooms.portals) {
        subjects.push({
          at: [portal.at[0], portal.at[1], portal.at[2] + 32],
          name: `doorway ${portal.between.join("-")}`,
        });
      }
    }

    for (const subject of subjects) {
      matched += 1;
      let value: number;
      let unit = "units";
      let at = subject.at;
      let evidence: Violation["evidence"];

      if (rule.what === "circulation_width") {
        // A room's widest cell and a doorway's col are both places on the floor, not body
        // positions. Measured as given, a hull centred there starts inside the slab and
        // every corridor in the map comes back 32 units wide -- the hull's own footprint.
        const from = standingAt(scene, subject.at, half);
        const fit = bodyFits(scene, from, half, MASK_PLAYER);
        if (!fit.fits) {
          report(noBodyFits(rule, subject.name, from, fit, half, unit));
          continue;
        }
        const m = narrowestWidth(scene, from, half, MASK_PLAYER);
        value = m.widthUnits;
        at = m.at;
        evidence = { hullFits: true, startsInside: null, assumedHull: half };
      } else if (rule.what === "clearance_in_front") {
        // The yaw is the entity's own; a room or a portal has none, and 0 means +x. Saying
        // so is the point: the identical "0 units" comes back from a marker facing a wall
        // and from a direction nobody chose (issue #59).
        const yaw = subject.yaw ?? 0;
        const a = clearanceInFront(scene, subject.at, yaw, half, MASK_PLAYER);
        if (!a.hullFits) {
          report(
            noBodyFits(
              rule,
              subject.name,
              a.from,
              { fits: false, insideOf: a.startsInside },
              half,
              unit,
              { facing: a.facing, yawDegrees: yaw, hasOwnYaw: subject.yaw !== undefined },
            ),
          );
          continue;
        }
        value = a.clearUnits;
        at = a.from;
        evidence = {
          hullFits: true,
          startsInside: null,
          blockedBy: a.blockedBy,
          facing: a.facing,
          yawDegrees: yaw,
          assumedHull: half,
        };
      } else if (rule.what === "headroom") {
        const h = headroom(scene, subject.at, MASK_SOLID);
        value = h.heightUnits;
      } else {
        const room = rooms?.rooms.find((r) => `room ${r.id}` === subject.name);
        value = room?.floorArea ?? 0;
        unit = "square units";
      }

      value = Math.round(value * 1000) / 1000;

      // A verdict that could go either way is worth saying so, and only for the checks
      // whose *place* came from the grid: a room's widest cell and a doorway's col are
      // located to within a cell, so the same measurement taken one cell over can land on
      // the other side of the bar. The measurement itself is a swept hull and exact --
      // what is approximate is where it was taken. Issue #61, where a doorway built to the
      // brief's own 64 measured under it and the natural reading was "widen the door".
      const fromTheGrid =
        subject.name.startsWith("doorway ") || subject.name.startsWith("room ");
      if (fromTheGrid && (rule.what === "circulation_width" || rule.what === "headroom")) {
        for (const bound of [rule.min, rule.max]) {
          if (bound === undefined || Math.abs(value - bound) >= step) continue;
          nearMisses.push(
            `${subject.name}: ${rule.what.replace(/_/g, " ")} is ${value} ${unit} against a ` +
              `bar of ${bound}, which is inside one cell of ${step}. The place this was ` +
              `measured at came from the grid, so it is located to within a cell -- the ` +
              `verdict is the one most likely to flip at another 'step'. ` +
              `${outOfBounds(rule, value) ? "It failed" : "It passed"} here.`,
          );
        }
      }

      if (!outOfBounds(rule, value)) continue;

      report({
        required: boundText(rule, unit),
        measured: value,
        at,
        subject: subject.name,
        message:
          `${subject.name}: ${rule.what.replace(/_/g, " ")} is ${value} ${unit}, and this ` +
          `map's rules ask for ${boundText(rule, unit)}.` +
          (evidence?.facing
            ? ` Measured along (${evidence.facing[0]}, ${evidence.facing[1]}) from yaw ` +
              `${evidence.yawDegrees}` +
              (subject.yaw === undefined
                ? ` -- the default, because a room or a doorway has no yaw of its own.`
                : `.`) +
              (evidence.blockedBy
                ? ` Brush ${evidence.blockedBy.brushId} (${evidence.blockedBy.material}) is ` +
                  `what stopped it.`
                : ` Nothing stopped it within reach.`)
            : ``),
        ...(evidence ? { evidence } : {}),
      });
    }

    if (matched === 0) matchedNothing.push(rule.id);
  }

  for (const near of nearMisses) notes.push(near);

  if (matchedNothing.length > 0) {
    notes.push(
      `${matchedNothing.length} rule(s) matched nothing at all: ${matchedNothing.join(", ")}. ` +
        `A rule about a room or an entity the map does not have is a finding about the ` +
        `rules, not a pass.`,
    );
  }

  notes.push(
    "This reports; it never refuses. A mapper may want a narrow alley, and turning a design " +
      "choice into a write error is how a tool stops being usable. The geometry checks do " +
      "refuse, because a non-planar face is not a choice and 96 units of corridor is.",
  );

  // A portal rule that matched nothing on a map the pass split into one room is not a
  // finding about the rules: it is the segmentation, and this is where to say so.
  //
  // What this note used to say, and why it changed: "try another 'step'". The cell size is
  // not monotone (issue #53) so that advice is right often enough to be worth giving -- but
  // on 13/08/2026 a builder followed it through five values, all returning one room, because
  // the cause was a shelf 48 units deep two hundred units from the doorway. The advice
  // pointed away from the cause and cost five calls. So the merge that closed the opening
  // now comes first, and the `step` sweep second, with a stopping rule on it.
  const wantedPortals = file.rules.some((r) => r.select?.portal !== undefined);
  if (rooms && wantedPortals && rooms.portals.length === 0) {
    const closed = rooms.merges.filter((m) => m.closed !== null);
    const worst = closed.reduce<(typeof closed)[number] | null>(
      (a, b) => (a === null || b.closed!.approxWidthUnits > a.closed!.approxWidthUnits ? b : a),
      null,
    );
    notes.push(
      `The room pass found ${rooms.rooms.length} room(s) and no doorways at step ${step}, ` +
        `so every rule about a portal matched nothing. That is about the segmentation, not ` +
        `about the rules file. ` +
        (worst
          ? `${closed.length} merge(s) closed an opening; the widest was about ` +
            `${worst.closed!.approxWidthUnits} units at ` +
            `[${worst.closed!.at.map((n) => Math.round(n)).join(", ")}]. Look there first: ` +
            `something narrowed one of the two spaces until that opening stopped being a ` +
            `constriction, and it need not be anywhere near it -- furniture depth is the ` +
            `usual cause. Varying 'step' will not find that. `
          : ``) +
        `If the geometry is not the cause, try another 'step': larger can help where smaller ` +
        `does not, and read_vmf_rooms at the same step shows every merge. Three or four ` +
        `values giving the same answer means it is not a resolution problem.`,
    );
  }

  return {
    checked: file.rules.length,
    segmentation: rooms
      ? { rooms: rooms.rooms.length, portals: rooms.portals.length, step }
      : null,
    matchedNothing,
    violations,
    errorCount: violations.filter((v) => v.severity === "error").length,
    warningCount: violations.filter((v) => v.severity === "warning").length,
    notes,
  };
}
