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
  clearanceInFront,
  headroom,
  HULL_CROUCHING,
  HULL_STANDING,
  narrowestWidth,
  standingAt,
} from "../space/measure.js";
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

      if (rule.what === "circulation_width") {
        // A room's widest cell and a doorway's col are both places on the floor, not body
        // positions. Measured as given, a hull centred there starts inside the slab and
        // every corridor in the map comes back 32 units wide -- the hull's own footprint.
        const m = narrowestWidth(scene, standingAt(scene, subject.at, half), half, MASK_PLAYER);
        value = m.widthUnits;
        at = m.at;
      } else if (rule.what === "clearance_in_front") {
        const a = clearanceInFront(scene, subject.at, subject.yaw ?? 0, half, MASK_PLAYER);
        value = a.clearUnits;
        at = a.from;
      } else if (rule.what === "headroom") {
        const h = headroom(scene, subject.at, MASK_SOLID);
        value = h.heightUnits;
      } else {
        const room = rooms?.rooms.find((r) => `room ${r.id}` === subject.name);
        value = room?.floorArea ?? 0;
        unit = "square units";
      }

      value = Math.round(value * 1000) / 1000;
      if (!outOfBounds(rule, value)) continue;

      report({
        required: boundText(rule, unit),
        measured: value,
        at,
        subject: subject.name,
        message:
          `${subject.name}: ${rule.what.replace(/_/g, " ")} is ${value} ${unit}, and this ` +
          `map's rules ask for ${boundText(rule, unit)}.`,
      });
    }

    if (matched === 0) matchedNothing.push(rule.id);
  }

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
  // finding about the rules: it is the segmentation, and this is where to say so. The
  // cell size is the thing to vary, and it is not monotone -- see issue #53.
  const wantedPortals = file.rules.some((r) => r.select?.portal !== undefined);
  if (rooms && wantedPortals && rooms.portals.length === 0) {
    notes.push(
      `The room pass found ${rooms.rooms.length} room(s) and no doorways at step ${step}, ` +
        `so every rule about a portal matched nothing. That is about the segmentation, not ` +
        `about the rules file: try another 'step'. Larger can help where smaller does not, ` +
        `and read_vmf_rooms at the same step shows the merges that produced this.`,
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
