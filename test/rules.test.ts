import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { parseRules, RulesError, rulesPathFor } from "../src/rules/schema.js";
import { checkVmfRulesTool } from "../src/tools/rules.js";
import { readVmfRoomsTool } from "../src/tools/scene.js";
import { editVmf } from "../src/tools/vmfedit.js";
import { applyVmfOps } from "../src/vmf/edit.js";
import { ctx as sharedCtx } from "./support/env.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const ctx = sharedCtx as unknown as ToolContext;
const dir = mkdtempSync(join(tmpdir(), "hammer-rules-"));

/** The fixture, plus a door in the corridor facing the wall 128 units away. */
const MAP = join(dir, "rooms.vmf");
writeFileSync(
  MAP,
  applyVmfOps(roomsVmf(), [
    {
      op: "add",
      keyvalues: {
        classname: "prop_door_rotating",
        targetname: "front_door",
        origin: "0 -256 0",
        angles: "0 90 0",
      },
    },
    {
      op: "add",
      keyvalues: { classname: "info_target", targetname: "reception", origin: "-768 256 0" },
    },
  ]).text,
);

const writeRules = (name: string, rules: unknown): string => {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({ version: 1, rules }, null, 2));
  return path;
};

interface Report {
  overall: "pass" | "warn" | "fail" | "skipped";
  segmentation: { rooms: number; portals: number; step: number } | null;
  rulesFound: boolean;
  rulesChecked: number;
  errorCount: number;
  warningCount: number;
  matchedNothing: string[];
  violations: Array<{
    ruleId: string;
    severity: string;
    measured: number | null;
    required: string;
    at: number[] | null;
    subject: string;
    message: string;
    note?: string;
  }>;
  notes: string[];
}

const check = (rulesPath?: string, over: Record<string, unknown> = {}): Report =>
  checkVmfRulesTool.handler(
    { path: MAP, rulesPath, severity: "all", step: 16, maxCells: 4_000_000, limit: 100, ...over } as never,
    ctx,
  ) as unknown as Report;

describe("the rules file lives next to the map", () => {
  it("derives its path from the map's own name", () => {
    expect(rulesPathFor("/maps/rp_bronx.vmf")).toBe("/maps/rp_bronx.rules.json");
    expect(rulesPathFor("/maps/rp_bronx.VMF")).toBe("/maps/rp_bronx.rules.json");
  });

  it("says nothing was checked rather than inventing a bar", () => {
    // The decision that shapes the whole file: no rules means NO checking. A built-in
    // default would be wrong for a warehouse and for a residential street at once, while
    // reading as authoritative.
    const r = check();
    expect(r.rulesFound).toBe(false);
    expect(r.violations).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/no built-in bar/);
  });

  it("does not search up the directory tree", () => {
    // A rules file in a parent must be ignored: two maps in a folder are two maps, and
    // inheriting a bar from a sibling's neighbour is how a number becomes untraceable.
    writeFileSync(join(dir, "..", "rooms.rules.json"), '{"version":1,"rules":[]}');
    expect(check().rulesFound).toBe(false);
  });
});

describe("parseRules", () => {
  it("refuses a rule that cannot fail", () => {
    // Worse than no rule: it reads as enforcement and is not.
    expect(() =>
      parseRules(
        JSON.stringify({ version: 1, rules: [{ id: "a", what: "headroom", select: { room: "*" } }] }),
        "x",
      ),
    ).toThrow(/cannot fail/);
  });

  it("refuses a rule that applies to nothing", () => {
    expect(() =>
      parseRules(JSON.stringify({ version: 1, rules: [{ id: "a", what: "headroom", min: 96 }] }), "x"),
    ).toThrow(/applies to\s+nothing|no 'select'/);
  });

  it("refuses a sightline with only one end", () => {
    expect(() =>
      parseRules(
        JSON.stringify({
          version: 1,
          rules: [{ id: "a", what: "sightline", from: { entity: "x" } }],
        }),
        "x",
      ),
    ).toThrow(/no 'from' or no 'to'/);
  });

  it("refuses two rules with the same id", () => {
    // An id names a rule in its violations; a duplicate makes a finding impossible to trace.
    const twice = {
      version: 1,
      rules: [
        { id: "same", what: "headroom", select: { room: "*" }, min: 96 },
        { id: "same", what: "headroom", select: { room: "*" }, min: 128 },
      ],
    };
    expect(() => parseRules(JSON.stringify(twice), "x")).toThrow(/two rules are both called/);
  });

  it("says where the JSON is wrong rather than throwing a parser's words", () => {
    expect(() => parseRules("{ nope", "the-file")).toThrow(RulesError);
    expect(() => parseRules("{ nope", "the-file")).toThrow(/the-file: not valid JSON/);
  });
});

describe("checking a map against its rules", () => {
  it("passes a corridor that meets the bar and fails one that does not", () => {
    // The corridor is 256 wide. A rule asking for 192 passes; one asking for 320 fails, and
    // says both numbers.
    const ok = check(writeRules("ok.json", [
      { id: "corridor", what: "circulation_width", select: { room: "*" }, min: 192 },
    ]));
    expect(ok.errorCount).toBe(0);

    const tight = check(writeRules("tight.json", [
      { id: "corridor", what: "circulation_width", select: { room: "*" }, min: 320 },
    ]));
    expect(tight.errorCount).toBeGreaterThan(0);
    const v = tight.violations[0]!;
    expect(v.measured).toBeGreaterThan(0);
    expect(v.required).toMatch(/at least 320/);
    expect(v.message).toMatch(/320/);
  });

  it("gives every violation a point to look at", () => {
    // The loop the whole stack is for: measure, locate, look. A violation without a
    // position sends the reader back to find it themselves.
    const r = check(writeRules("look.json", [
      { id: "corridor", what: "circulation_width", select: { room: "*" }, min: 9999 },
    ]));
    expect(r.violations.length).toBeGreaterThan(0);
    for (const v of r.violations) {
      expect(v.at).not.toBeNull();
      expect(v.at).toHaveLength(3);
    }
  });

  it("measures the doorway, not the room, when the rule is about doorways", () => {
    const r = check(writeRules("doors.json", [
      { id: "doorways", what: "circulation_width", select: { portal: "*" }, min: 128 },
    ]));
    // Both doorways are 96, so both fail a 128 bar, and the measurement is the doorway's.
    expect(r.violations).toHaveLength(2);
    for (const v of r.violations) expect(v.measured).toBeCloseTo(ROOMS.doorWidth, 0);
  });

  it("finds the door that opens into a wall", () => {
    // 112 units of room in front of it. Nothing else in this toolkit, and no compiler,
    // would have mentioned it.
    const r = check(writeRules("approach.json", [
      {
        id: "door-clearance",
        what: "clearance_in_front",
        select: { classname: "prop_door" },
        min: 192,
        note: "A person has to be able to stand in front of a door and open it.",
      },
    ]));
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.measured).toBeCloseTo(112, 0);
    expect(r.violations[0]!.subject).toMatch(/front_door/);
    expect(r.violations[0]!.note).toMatch(/stand in front of a door/);
  });

  it("checks a sight line between two things the map names", () => {
    const kept = check(writeRules("view-ok.json", [
      {
        id: "lobby-view",
        what: "sightline",
        from: { entity: "reception" },
        to: { entity: "reception" },
        mustBe: "clear",
      },
    ]));
    expect(kept.errorCount).toBe(0);

    // The spawn is in the corridor and the reception is in the west room, with a wall
    // between: a rule wanting that view kept fails, and names the brush in the way.
    const broken = check(writeRules("view-broken.json", [
      {
        id: "lobby-view",
        what: "sightline",
        from: { point: [0, -256, 64] },
        to: { entity: "reception" },
        mustBe: "clear",
      },
    ]));
    expect(broken.errorCount).toBe(1);
    expect(broken.violations[0]!.message).toMatch(/is in the way/);
  });

  it("reports a rule that matched nothing rather than counting it as a pass", () => {
    // A rule about a room the map does not have is a finding about the rules.
    const r = check(writeRules("ghost.json", [
      { id: "ghost", what: "headroom", select: { classname: "func_nonexistent" }, min: 96 },
    ]));
    expect(r.matchedNothing).toEqual(["ghost"]);
    expect(r.notes.join(" ")).toMatch(/matched nothing/);
  });

  /**
   * The three ways a run ends with no errors are not the same answer, and for one session
   * of real map building they were indistinguishable: a cold agent read `errorCount: 0`
   * on a map where one rule in seven had matched nothing, and took it for compliance.
   *
   * `read_map_report` already refuses this -- "a run that judged nothing comes back
   * skipped, never pass". These give the same discipline to the rules check.
   */
  describe("the overall verdict", () => {
    it("is pass only when every rule was checked and none failed", () => {
      const r = check(writeRules("all-good.json", [
        { id: "easy", what: "circulation_width", select: { room: "*" }, min: 1 },
      ]));
      expect(r.errorCount).toBe(0);
      expect(r.matchedNothing).toEqual([]);
      expect(r.overall).toBe("pass");
    });

    it("is skipped, not pass, when a rule matched nothing", () => {
      const r = check(writeRules("half.json", [
        { id: "easy", what: "circulation_width", select: { room: "*" }, min: 1 },
        { id: "ghost", what: "headroom", select: { classname: "func_nonexistent" }, min: 96 },
      ]));
      expect(r.errorCount).toBe(0);
      expect(r.matchedNothing).toEqual(["ghost"]);
      expect(r.overall).toBe("skipped");
    });

    it("is skipped when there is no rules file at all", () => {
      const r = check(join(dir, "absent.json"));
      expect(r.rulesFound).toBe(false);
      expect(r.overall).toBe("skipped");
    });

    it("is warn when the only findings are warnings", () => {
      const r = check(writeRules("only-warn.json", [
        {
          id: "narrow",
          what: "circulation_width",
          select: { room: "*" },
          min: 9999,
          severity: "warning",
        },
      ]));
      expect(r.errorCount).toBe(0);
      expect(r.warningCount).toBeGreaterThan(0);
      expect(r.overall).toBe("warn");
    });

    it("is fail as soon as one error violation stands, unmatched rules or not", () => {
      const r = check(writeRules("bad.json", [
        { id: "impossible", what: "circulation_width", select: { room: "*" }, min: 9999 },
        { id: "ghost", what: "headroom", select: { classname: "func_nonexistent" }, min: 96 },
      ]));
      expect(r.errorCount).toBeGreaterThan(0);
      expect(r.matchedNothing).toEqual(["ghost"]);
      expect(r.overall).toBe("fail");
    });
  });

  /**
   * `read_vmf_rooms` is what a caller uses to work out *why* a segmentation came out the
   * way it did, and this is what judges against it. Until they shared `minRoomArea` the
   * two could not be run at the same settings, so every diagnosis was about a slightly
   * different segmentation from the verdict it was meant to explain.
   */
  it("segments the map the same way read_vmf_rooms does, at the same minRoomArea", () => {
    // A bar no room can clear, so the check reports exactly one violation per room and
    // its count is directly comparable with the room finder's own.
    const rules = writeRules("every-room.json", [
      { id: "impossible", what: "room_area", select: { room: "*" }, min: 1e12 },
    ]);

    const roomsAt = (minRoomArea: number): number =>
      (
        readVmfRoomsTool.handler(
          { path: MAP, step: 16, maxCells: 4_000_000, minRoomArea } as never,
          ctx,
        ) as unknown as { roomCount: number }
      ).roomCount;

    for (const minRoomArea of [0, 4096, 500_000]) {
      expect(check(rules, { minRoomArea }).violations.length).toBe(roomsAt(minRoomArea));
    }

    // And the knob has to actually move something, or the equality above is vacuous.
    // Measured on this fixture: three rooms up to 100 000, one at 500 000.
    expect(roomsAt(0)).not.toBe(roomsAt(500_000));
  });

  /**
   * A rules file that is right, a map that is right, and a verdict that blames the rules
   * file. That is what a round-2 builder met: `matchedNothing: ["doorways-wide-enough"]`
   * on a shop with a doorway in it, because the room pass had found one room and no
   * portals at the default cell size and did not say so.
   */
  describe("the segmentation the verdict rests on", () => {
    it("is reported whenever a rule needed the room pass", () => {
      const r = check(writeRules("seg.json", [
        { id: "doorways", what: "circulation_width", select: { portal: "*" }, min: 1 },
      ]));
      expect(r.segmentation).not.toBeNull();
      expect(r.segmentation!.rooms).toBe(3);
      expect(r.segmentation!.portals).toBe(2);
      expect(r.segmentation!.step).toBe(16);
    });

    it("is null when no rule is about rooms, so nothing pays for the pass", () => {
      const r = check(writeRules("no-rooms.json", [
        { id: "till", what: "clearance_in_front", select: { classname: "prop_door" }, min: 1 },
      ]));
      expect(r.segmentation).toBeNull();
    });

    it("says the segmentation is the problem when a portal rule matches nothing", () => {
      // A cell size coarse enough that the pass finds no doorway at all.
      const r = check(
        writeRules("no-portal.json", [
          { id: "doorways", what: "circulation_width", select: { portal: "*" }, min: 1 },
        ]),
        { step: 128 },
      );
      expect(r.segmentation!.portals).toBe(0);
      expect(r.matchedNothing).toEqual(["doorways"]);
      // Naming 'step' is the point: it is what a caller has to vary, and nothing else said so.
      expect(r.notes.join(" ")).toMatch(/step/);
      expect(r.notes.join(" ")).toMatch(/not about the rules file/i);
    });
  });

  it("sorts errors before warnings and can filter to errors alone", () => {
    const path = writeRules("mixed.json", [
      { id: "warn", what: "circulation_width", select: { room: "*" }, min: 9999, severity: "warning" },
      { id: "err", what: "circulation_width", select: { room: "*" }, min: 9999, severity: "error" },
    ]);
    const all = check(path);
    expect(all.violations[0]!.severity).toBe("error");
    expect(all.warningCount).toBeGreaterThan(0);

    const errorsOnly = check(path, { severity: "error" });
    for (const v of errorsOnly.violations) expect(v.severity).toBe("error");
    expect(errorsOnly.violations.length).toBeLessThan(all.violations.length);
  });
});

describe("it reports and never refuses", () => {
  it("lets a write through on a map that violates its own rules", () => {
    // The rule this file exists to keep. A mapper may want a narrow alley; turning a design
    // choice into a write error is how a tool stops being usable. The geometry checks DO
    // refuse, because a non-planar face is not a choice.
    const map = join(dir, "editable.vmf");
    writeFileSync(map, roomsVmf());
    writeFileSync(
      rulesPathFor(map),
      JSON.stringify({
        version: 1,
        rules: [{ id: "impossible", what: "circulation_width", select: { room: "*" }, min: 9999 }],
      }),
    );

    // Every room violates it.
    const before = checkVmfRulesTool.handler(
      { path: map, severity: "all", step: 16, maxCells: 4_000_000, limit: 100 } as never,
      ctx,
    ) as unknown as Report;
    expect(before.errorCount).toBeGreaterThan(0);

    // And the writer does not care.
    const written = editVmf.handler(
      {
        path: map,
        ops: [{ op: "add", keyvalues: { classname: "info_target", origin: "0 0 64" } }],
        confirm: true,
        dryRun: false,
        backup: false,
      } as never,
      ctx,
    ) as unknown as { entitiesBefore: number; entitiesAfter: number };
    expect(written.entitiesAfter).toBe(written.entitiesBefore + 1);
  });

  it("says so in its own output, so nobody wires it into a guard", () => {
    const r = check(writeRules("say.json", [
      { id: "corridor", what: "circulation_width", select: { room: "*" }, min: 192 },
    ]));
    expect(r.notes.join(" ")).toMatch(/reports; it never refuses/);
  });
});
