import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setMapPropertiesTool } from "../src/tools/wiring.js";
import { setMapProperties, VmfPortalError, writePortal } from "../src/vmf/portals.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import { entityReport } from "../src/vmf/wiring.js";
import { AWKWARD_VMF } from "./support/awkward.js";
import { FIXTURES } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string) => checkVmfSolids("x", text).solids;

describe("writePortal", () => {
  it("makes a brush entity of the right class, holding the brush", () => {
    const r = writePortal(probe(), "func_areaportal", [-64, -8, 0], [64, 8, 128]);
    const entities = entityReport(r.text, { classname: "func_areaportal" });
    expect(entities).toHaveLength(1);
    expect(entities[0]!.solidCount).toBe(1);
    expect(entities[0]!.id).toBe(r.entityId);
  });

  it("gives the brush the material without which the entity does nothing", () => {
    // An areaportal brush textured with anything else is a solid wall the player walks
    // into, and vbsp does not mention it.
    const r = writePortal(probe(), "func_areaportal", [-64, -8, 0], [64, 8, 128]);
    const made = read(r.text).find((s) => s.id === r.solidId)!;
    expect(made.sides.every((x) => x.material === "TOOLS/TOOLSAREAPORTAL")).toBe(true);
    expect(made.owner).toBe("func_areaportal");

    const occ = writePortal(probe(), "func_occluder", [-64, -8, 0], [64, 8, 128]);
    const occMade = read(occ.text).find((s) => s.id === occ.solidId)!;
    expect(occMade.sides.every((x) => x.material === "TOOLS/TOOLSOCCLUDER")).toBe(true);
  });

  it("writes a brush the independent checker accepts", () => {
    const r = writePortal(probe(), "func_areaportal", [-64, -8, 0], [64, 8, 128]);
    const made = read(r.text).find((s) => s.id === r.solidId)!;
    expect(made.valid, made.findings.map((f) => f.message).join(" | ")).toBe(true);
    expect(made.volume).toBeCloseTo(128 * 16 * 128);
  });

  it("takes the brush out of the world rather than leaving it in both", () => {
    // A brush in the world and in an entity at once is two brushes as far as vbsp is
    // concerned, and the count is the only thing that says so.
    const before = read(probe()).length;
    const r = writePortal(probe(), "func_areaportal", [-64, -8, 0], [64, 8, 128]);
    const after = read(r.text);
    expect(after).toHaveLength(before + 1);
    expect(after.filter((s) => s.owner === "world")).toHaveLength(before);
  });

  it("says what an areaportal costs if it does not fill its opening", () => {
    const r = writePortal(probe(), "func_areaportal", [-64, -8, 0], [64, 8, 128]);
    expect(r.warnings.join(" ")).toMatch(/refuses the whole map/);
  });

  it("says what an occluder costs every frame", () => {
    const r = writePortal(probe(), "func_occluder", [-64, -8, 0], [64, 8, 128]);
    expect(r.warnings.join(" ")).toMatch(/every frame/);
  });

  it("says so when the box is a room rather than a sheet", () => {
    const r = writePortal(probe(), "func_areaportal", [-64, -64, 0], [64, 64, 128]);
    expect(r.warnings.join(" ")).toMatch(/measured as a room/);
  });

  it("refuses a box with no volume", () => {
    expect(() => writePortal(probe(), "func_areaportal", [0, 0, 0], [0, 16, 16])).toThrow(
      VmfPortalError,
    );
  });

  it("carries a targetname and extra keyvalues when given them", () => {
    const r = writePortal(probe(), "func_areaportalwindow", [-64, -8, 0], [64, 8, 128], {
      targetname: "window_a",
      keyvalues: { FadeStartDist: "128", FadeDist: "512" },
    });
    const e = entityReport(r.text, { classname: "func_areaportalwindow" })[0]!;
    expect(e.targetname).toBe("window_a");
    expect(e.keyvalues["FadeDist"]).toBe("512");
  });

  it("works on a .vmf Hammer would never write", () => {
    // The awkward fixture: one line, no side ids. A hand-rolled line cut takes the world
    // with the brush here, which is exactly the fault this repository fixed once already.
    const before = read(AWKWARD_VMF).length;
    const r = writePortal(AWKWARD_VMF, "func_areaportal", [0, 0, 0], [128, 16, 128]);
    expect(r.text).toContain("worldspawn");
    const after = read(r.text);
    expect(after).toHaveLength(before + 1);
    expect(after.find((s) => s.id === r.solidId)!.valid).toBe(true);
  });
});

describe("setMapProperties", () => {
  it("sets a property the map did not have", () => {
    // On the awkward fixture, which carries only a skyname. The probe has all four of the
    // keys this tool writes, so every "add" case against it is really a "replace" case and
    // proves the wrong half -- which is what the first version of this test did.
    const r = setMapProperties(AWKWARD_VMF, { maxpropscreenwidth: "-1" });
    expect(r.changed["maxpropscreenwidth"]).toEqual({ from: null, to: "-1" });
    expect(r.text).toContain('"maxpropscreenwidth" "-1"');
    expect(r.text).toContain('"classname" "worldspawn"');
  });

  it("replaces one it did, and reports what it was", () => {
    const r = setMapProperties(probe(), { skyname: "sky_night01_01" });
    expect(r.changed["skyname"]).toEqual({
      from: "sky_day01_01",
      to: "sky_night01_01",
    });
    expect((r.text.match(/"skyname"/g) ?? [])).toHaveLength(1);
  });

  it("writes nothing when the value is already there", () => {
    const again = setMapProperties(probe(), { skyname: "sky_day01_01" });
    expect(again.unchanged).toBe(true);
    expect(again.text).toBe(probe());
  });

  it("says so when detailvbsp and detailmaterial are set apart", () => {
    // One names the file saying which sprites go on which material, the other the sprite
    // sheet. Setting one alone gives grass with no sprites, and vbsp mentions neither.
    const r = setMapProperties(probe(), { detailvbsp: "detail.vbsp" });
    expect(r.warnings.join(" ")).toMatch(/come as a pair/);

    const both = setMapProperties(probe(), {
      detailvbsp: "detail.vbsp",
      detailmaterial: "detail/detailsprites",
    });
    expect(both.warnings).toEqual([]);
  });

  it("has no fog keys at all, because fog does not live on worldspawn", () => {
    // Source reads fogenable, fogstart, fogend and fogcolor from an env_fog_controller.
    // An earlier version of this offered all four here: the file parsed, the tool reported
    // a successful change, and there was no fog in game. This repository's own notes say
    // where fog lives, which is what made that worse than an omission.
    const schema = Object.keys(setMapPropertiesTool.inputSchema);
    for (const key of ["fogenable", "fogstart", "fogend", "fogcolor"]) {
      expect(schema, `${key} must not be offered here`).not.toContain(key);
    }
    expect(setMapPropertiesTool.description).toMatch(/env_fog_controller/);
  });

  it("refuses being asked for nothing", () => {
    expect(() => setMapProperties(probe(), {})).toThrow(VmfPortalError);
  });

  it("leaves the geometry alone", () => {
    const before = read(probe());
    const after = read(setMapProperties(probe(), { skyname: "sky_day01_01" }).text);
    expect(after).toHaveLength(before.length);
    for (const b of before) {
      expect(after.find((s) => s.id === b.id)!.volume).toBe(b.volume);
    }
  });

  it("works on a one-line .vmf too", () => {
    const r = setMapProperties(AWKWARD_VMF, { skyname: "sky_night01_01" });
    expect(r.changed["skyname"]).toEqual({ from: "sky_day01_01", to: "sky_night01_01" });
    expect(r.text).toContain('"classname" "worldspawn"');
  });
});
