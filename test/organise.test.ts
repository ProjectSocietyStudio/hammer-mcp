import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  groupSolids,
  readOrganisation,
  setCordon,
  setVisgroup,
  VmfOrganiseError,
} from "../src/vmf/organise.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck } from "../src/vmf/solid.js";
import { FIXTURES, paths } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const FLOOR = 7;
const WALL = 21;

describe("readOrganisation", () => {
  it("reports a map that has no organisation at all", () => {
    const r = readOrganisation(probe());
    expect(r.visgroups).toEqual([]);
    expect(r.groups).toEqual([]);
    expect(r.cordons).toEqual([]);
    expect(r.cordonsActive).toBe(false);
    // The probe's six brushes belong to no visgroup, which is the honest count.
    expect(r.ungroupedSolids).toBe(6);
  });

  it("reads the groups a real Hammer map declares", () => {
    // srctools cannot do this one: its writer emits "groupid" and its parser looks for
    // "group", so Solid.group_id comes back None for every brush. Measured on this very
    // file, 11/08/2026: ten "groupid" lines, zero group memberships read.
    if (!existsSync(paths.tttSource)) return;
    const source = readFileSync(paths.tttSource, "utf8");
    const r = readOrganisation(source);
    const counted = r.groups.reduce((t, g) => t + g.solidCount, 0);
    expect(counted).toBe((source.match(/"groupid"/g) ?? []).length);
    expect(counted).toBeGreaterThan(0);
  });

  it("says when an id is used by an object and declared nowhere", () => {
    // Hammer opens such a file and drops the membership without a word, so the map a
    // mapper reopens is not the map they saved.
    // Built by putting a brush in a visgroup and then deleting the declaration, which is
    // exactly the state a hand-edited file or a bad merge leaves behind.
    const added = setVisgroup(probe(), { ids: [FLOOR] }, { name: "Ghost" });
    const orphaned = added.text.replace(/visgroups\n\{[\s\S]*?\n\}\n/, "");
    expect(orphaned).not.toBe(added.text);
    expect(orphaned).toContain(`"visgroupid" "${added.visgroupId}"`);
    const r = readOrganisation(orphaned);
    expect(r.warnings.join(" ")).toMatch(/declared nowhere/);
  });
});

describe("setVisgroup", () => {
  it("creates the visgroup and puts the selected brushes in it", () => {
    const r = setVisgroup(probe(), { ids: [FLOOR, WALL] }, { name: "North tenement" });
    expect(r.created).toBe(true);
    expect(r.solidsChanged).toBe(2);

    const after = readOrganisation(r.text);
    expect(after.visgroups).toHaveLength(1);
    expect(after.visgroups[0]!.name).toBe("North tenement");
    expect(after.visgroups[0]!.solidCount).toBe(2);
    expect(after.warnings).toEqual([]);
  });

  it("writes both halves, because a membership without a declaration is dropped", () => {
    const r = setVisgroup(probe(), { ids: [FLOOR] }, { name: "Roof" });
    expect(r.text).toContain('"name" "Roof"');
    expect(r.text).toContain(`"visgroupid" "${r.visgroupId}"`);
    // Once in the declaration, once on the brush.
    expect((r.text.match(new RegExp(`"visgroupid" "${r.visgroupId}"`, "g")) ?? [])).toHaveLength(
      2,
    );
  });

  it("adds to an existing visgroup rather than making a second one of the same name", () => {
    const first = setVisgroup(probe(), { ids: [FLOOR] }, { name: "Shell" });
    const second = setVisgroup(first.text, { ids: [WALL] }, { name: "Shell" });
    expect(second.created).toBe(false);
    expect(second.visgroupId).toBe(first.visgroupId);
    expect(readOrganisation(second.text).visgroups).toHaveLength(1);
    expect(readOrganisation(second.text).visgroups[0]!.solidCount).toBe(2);
  });

  it("keeps a brush in both visgroups when it belongs to two", () => {
    // The normal case for a mapper -- "north tenement" and "trigger brushes" are not
    // exclusive -- and the one that catches a reader taking only the first visgroupid of
    // an editor block. Nothing else in this file puts a brush in two.
    const first = setVisgroup(probe(), { ids: [FLOOR] }, { name: "Shell" });
    const second = setVisgroup(first.text, { ids: [FLOOR] }, { name: "Roof" });
    expect(second.created).toBe(true);
    expect(second.visgroupId).not.toBe(first.visgroupId);

    const after = readOrganisation(second.text);
    expect(after.visgroups).toHaveLength(2);
    expect(after.visgroups.map((v) => v.solidCount)).toEqual([1, 1]);
    expect(after.ungroupedSolids).toBe(5);

    // And taking it out of one leaves it in the other.
    const removed = setVisgroup(second.text, { ids: [FLOOR] }, { name: "Shell", remove: true });
    const left = readOrganisation(removed.text);
    expect(left.visgroups.find((v) => v.name === "Shell")!.solidCount).toBe(0);
    expect(left.visgroups.find((v) => v.name === "Roof")!.solidCount).toBe(1);
  });

  it("writes nothing when the brushes are already in it", () => {
    const first = setVisgroup(probe(), { ids: [FLOOR] }, { name: "Shell" });
    const again = setVisgroup(first.text, { ids: [FLOOR] }, { name: "Shell" });
    expect(again.unchanged).toBe(true);
    expect(again.text).toBe(first.text);
  });

  it("takes brushes out again", () => {
    const added = setVisgroup(probe(), { ids: [FLOOR, WALL] }, { name: "Shell" });
    const removed = setVisgroup(added.text, { ids: [FLOOR] }, { name: "Shell", remove: true });
    expect(removed.solidsChanged).toBe(1);
    expect(readOrganisation(removed.text).visgroups[0]!.solidCount).toBe(1);
  });

  it("refuses to remove from a visgroup that does not exist", () => {
    expect(() =>
      setVisgroup(probe(), { ids: [FLOOR] }, { name: "Nothing", remove: true }),
    ).toThrow(VmfOrganiseError);
  });

  it("refuses an empty selector and an empty name", () => {
    expect(() => setVisgroup(probe(), {}, { name: "x" })).toThrow(VmfOrganiseError);
    expect(() => setVisgroup(probe(), { ids: [FLOOR] }, { name: "  " })).toThrow(
      VmfOrganiseError,
    );
  });

  it("leaves the geometry untouched", () => {
    const before = read(probe());
    const after = read(setVisgroup(probe(), { ids: [FLOOR] }, { name: "Shell" }).text);
    expect(after).toHaveLength(before.length);
    for (const b of before) {
      expect(after.find((s) => s.id === b.id)!.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });
});

describe("groupSolids", () => {
  it("declares the group and puts every selected brush in it", () => {
    const r = groupSolids(probe(), { ids: [FLOOR, WALL] });
    expect(r.solidsChanged).toBe(2);
    expect(r.groupId).not.toBeNull();

    const after = readOrganisation(r.text);
    expect(after.groups).toHaveLength(1);
    expect(after.groups[0]!.solidCount).toBe(2);
    expect(after.warnings).toEqual([]);
  });

  it("moves a brush out of its old group rather than putting it in two", () => {
    // A solid carries one groupid. Writing a second would leave Hammer reading whichever
    // came first and the tool reporting the other.
    const first = groupSolids(probe(), { ids: [FLOOR, WALL] });
    const second = groupSolids(first.text, { ids: [WALL, 28] });
    const after = readOrganisation(second.text);
    const counts = after.groups.map((g) => g.solidCount).sort();
    expect(counts).toEqual([1, 2]);
    expect((second.text.match(/"groupid"/g) ?? [])).toHaveLength(3);
  });

  it("says so when asked for a group of one", () => {
    const r = groupSolids(probe(), { ids: [FLOOR] });
    expect(r.warnings.join(" ")).toMatch(/group of one/);
  });

  it("takes brushes out of their group", () => {
    const grouped = groupSolids(probe(), { ids: [FLOOR, WALL] });
    const loose = groupSolids(grouped.text, { ids: [FLOOR] }, { ungroup: true });
    expect(loose.solidsChanged).toBe(1);
    expect(readOrganisation(loose.text).groups[0]!.solidCount).toBe(1);
  });

  it("refuses an empty selector", () => {
    expect(() => groupSolids(probe(), {})).toThrow(VmfOrganiseError);
  });
});

describe("setCordon", () => {
  it("writes a cordon a reader gets back unchanged", () => {
    const r = setCordon(probe(), { mins: [-512, -512, -512], maxs: [512, 512, 512] });
    const after = readOrganisation(r.text);
    expect(after.cordons).toHaveLength(1);
    expect(after.cordons[0]!.mins).toEqual([-512, -512, -512]);
    expect(after.cordons[0]!.maxs).toEqual([512, 512, 512]);
    expect(after.cordonsActive).toBe(true);
  });

  it("replaces the cordon rather than adding a second one", () => {
    const first = setCordon(probe(), { mins: [-512, -512, -512], maxs: [512, 512, 512] });
    const second = setCordon(first.text, { mins: [0, 0, 0], maxs: [128, 128, 128] });
    const after = readOrganisation(second.text);
    expect(after.cordons).toHaveLength(1);
    expect(after.cordons[0]!.maxs).toEqual([128, 128, 128]);
  });

  it("says out loud what an active cordon does to a compile", () => {
    // This is the one piece of a map's organisation that changes what ships, and it does
    // it silently: vbsp does not warn that three quarters of the map was not handed to it.
    const r = setCordon(probe(), { mins: [0, 0, 0], maxs: [128, 128, 128] });
    expect(r.warnings.join(" ")).toMatch(/will not be in the map/);

    const off = setCordon(probe(), { mins: [0, 0, 0], maxs: [128, 128, 128] }, { active: false });
    expect(off.warnings).toEqual([]);
    expect(readOrganisation(off.text).cordonsActive).toBe(false);
  });

  it("refuses a box with no volume", () => {
    expect(() => setCordon(probe(), { mins: [0, 0, 0], maxs: [0, 128, 128] })).toThrow(
      VmfOrganiseError,
    );
  });

  it("leaves the geometry untouched", () => {
    const before = read(probe());
    const after = read(setCordon(probe(), { mins: [-512, -512, -512], maxs: [512, 512, 512] }).text);
    expect(after).toHaveLength(before.length);
  });
});

describe("the file around an organisation edit", () => {
  it("keeps the comments and blank lines a reserialiser would drop", () => {
    const source = `// hand-written\n${probe()}\n\n// trailing\n`;
    const r = setVisgroup(source, { ids: [FLOOR] }, { name: "Shell" });
    expect(r.text.startsWith("// hand-written")).toBe(true);
    expect(r.text.endsWith("// trailing\n")).toBe(true);
  });

  it("survives a round trip through every one of them", () => {
    let text = probe();
    text = setVisgroup(text, { ids: [FLOOR, WALL] }, { name: "Shell" }).text;
    text = groupSolids(text, { ids: [FLOOR, WALL] }).text;
    text = setCordon(text, { mins: [-512, -512, -512], maxs: [512, 512, 512] }).text;

    const r = readOrganisation(text);
    expect(r.visgroups[0]!.solidCount).toBe(2);
    expect(r.groups[0]!.solidCount).toBe(2);
    expect(r.cordons).toHaveLength(1);
    expect(r.warnings.filter((w) => w.includes("declared nowhere"))).toEqual([]);

    // And the geometry is still exactly the geometry.
    for (const b of read(probe())) {
      expect(read(text).find((s) => s.id === b.id)!.volume, `solid ${b.id}`).toBe(b.volume);
    }
  });
});
