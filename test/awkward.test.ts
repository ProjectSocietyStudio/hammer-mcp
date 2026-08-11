import { describe, expect, it } from "vitest";
import { clipSolids } from "../src/vmf/clip.js";
import { applyVmfOps } from "../src/vmf/edit.js";
import { alignFaces, resolveFaces, setFaceMaterial, setSmoothingGroups } from "../src/vmf/face.js";
import { hollowSolid } from "../src/vmf/hollow.js";
import { setLightmapScale } from "../src/vmf/lightmap.js";
import { deleteSolids, transformSolids } from "../src/vmf/modify.js";
import { groupSolids, readOrganisation, setCordon, setVisgroup } from "../src/vmf/organise.js";
import { reclassSolids } from "../src/vmf/reclass.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck } from "../src/vmf/solid.js";
import { rotation, translation } from "../src/vmf/transform.js";
import { moveVertices } from "../src/vmf/vertex.js";
import { AWKWARD_CENTRED, AWKWARD_OFFSET, AWKWARD_VMF } from "./support/awkward.js";

const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const byId = (text: string, id: number): SolidCheck | undefined =>
  read(text).find((s) => s.id === id);

/**
 * Every write path, against a legal `.vmf` Hammer would never produce.
 *
 * Three rounds of review turned up six faults in this repository's write path, and all six
 * were the same shape: a rule written for the file Hammer happens to produce. The tests
 * could not see any of them, because they all ran on the canonical probe. This file is the
 * standing check that they cannot come back -- and it is deliberately shallow, one
 * assertion per writer, because its job is coverage of a *shape* rather than of behaviour.
 */
describe("the awkward fixture itself", () => {
  it("is a map the reader understands", () => {
    const solids = read(AWKWARD_VMF);
    expect(solids).toHaveLength(2);
    for (const s of solids) {
      expect(s.valid, `solid ${s.id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(true);
    }
  });

  it("has the four equal wall distances that hid a fault", () => {
    // The reason an origin-centred box is here: matching a side to its measurement by
    // plane distance alone gave all four of these one answer.
    const centred = byId(AWKWARD_VMF, AWKWARD_CENTRED)!;
    const walls = centred.sides.filter((s) => Math.abs(s.plane!.normal[2]) < 0.1);
    expect(walls).toHaveLength(4);
    expect(new Set(walls.map((w) => w.plane!.dist))).toHaveLength(1);
  });

  it("carries no side ids at all, and keys that share lines", () => {
    expect(read(AWKWARD_VMF).flatMap((s) => s.sides).every((s) => s.id === null)).toBe(true);
    expect(AWKWARD_VMF.split("\n")).toHaveLength(1);
  });
});

describe("every writer, on a file it was not written for", () => {
  it("edit_vmf changes a keyvalue and keeps the ones beside it", () => {
    const r = applyVmfOps(AWKWARD_VMF, [
      { op: "update", match: { classname: "info_player_start" }, set: { origin: "0 0 64" } },
    ]);
    expect(r.text).toContain('"origin" "0 0 64"');
    expect(r.text).toContain('"classname" "info_player_start"');
    expect(read(r.text)).toHaveLength(2);
  });

  it("edit_vmf unsets a keyvalue without taking its neighbours", () => {
    const r = applyVmfOps(AWKWARD_VMF, [
      { op: "update", match: { classname: "info_player_start" }, unset: ["origin"] },
    ]);
    expect(r.text).not.toContain('"origin" "0 0 16"');
    // Both neighbours on that line survive, which is the whole point.
    expect(r.text).toContain('"classname" "info_player_start"');
    expect(r.text).toContain('"targetname" "awkward_spawn"');
  });

  it("delete_solids removes the brush and leaves the world standing", () => {
    const r = deleteSolids(AWKWARD_VMF, { ids: [AWKWARD_OFFSET] });
    expect(r.matched).toBe(1);
    expect(r.text).toContain("worldspawn");
    expect(r.text).toContain('"skyname" "sky_day01_01"');
    expect(read(r.text)).toHaveLength(1);
  });

  it("transform_solids moves one brush and not the other", () => {
    const before = byId(AWKWARD_VMF, AWKWARD_CENTRED)!;
    const r = transformSolids(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, translation([0, 0, 512]));
    const after = byId(r.text, AWKWARD_CENTRED)!;
    expect(after.mins[2]).toBeCloseTo(before.mins[2]! + 512);
    expect(byId(r.text, AWKWARD_OFFSET)!.volume).toBe(byId(AWKWARD_VMF, AWKWARD_OFFSET)!.volume);
  });

  it("transform_solids turns a brush whose walls share a distance", () => {
    const r = transformSolids(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, rotation([0, 0, 1], 45, [0, 0, 0]));
    const after = byId(r.text, AWKWARD_CENTRED)!;
    expect(after.valid, after.findings.map((f) => f.message).join(" | ")).toBe(true);
  });

  it("clip_solids cuts a brush with no side ids", () => {
    const before = byId(AWKWARD_VMF, AWKWARD_CENTRED)!;
    const r = clipSolids(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, { normal: [1, 0, 0], dist: 0 }, {
      keep: "both",
    });
    const piece = r.solids[0]!;
    expect(piece.volumeAfter + piece.volumeOther).toBeCloseTo(before.volume, 3);
    for (const s of read(r.text)) expect(s.valid, `solid ${s.id}`).toBe(true);
  });

  it("set_face_material finds the four walls separately", () => {
    // The fault this exists for: by distance alone, all four resolved to the first, and
    // only one face was changed where four should have been.
    const r = setFaceMaterial(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED], facing: "side" }, "BRICK/WALL");
    expect(r.changed).toHaveLength(4);
    const walls = byId(r.text, AWKWARD_CENTRED)!.sides.filter((s) => s.material === "BRICK/WALL");
    expect(walls).toHaveLength(4);
  });

  it("resolveFaces tells the six faces of the centred box apart", () => {
    const faces = resolveFaces(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED] });
    expect(faces).toHaveLength(6);
    const normals = faces.map((f) => f.side.plane!.normal.map((n) => Math.round(n)).join(" "));
    expect(new Set(normals).size).toBe(6);
  });

  it("align_faces realigns without an id to go on", () => {
    const r = alignFaces(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED] }, { mode: "world" });
    expect(r.changed.length).toBeGreaterThan(0);
    for (const s of read(r.text)) {
      expect(s.findings.filter((f) => f.rule === "texture-axis-along-normal")).toEqual([]);
    }
  });

  it("set_smoothing_groups writes the mask on every wall", () => {
    const r = setSmoothingGroups(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED], facing: "side" }, [3]);
    expect(r.changed).toHaveLength(4);
    expect(r.groups).toBe(4);
  });

  it("set_lightmap_scale picks the faces the selector meant", () => {
    // A count alone proves nothing here: with the wrong side matched, the splices still
    // land on the right blocks and six faces still change. The `facing` selector is what
    // discriminates, because it is read from the measurement rather than from the block --
    // and the four walls of an origin-centred box share a plane distance.
    const all = setLightmapScale(AWKWARD_VMF, 32, { solidIds: [AWKWARD_CENTRED] });
    expect(all.changed).toHaveLength(6);

    const walls = setLightmapScale(AWKWARD_VMF, 32, {
      solidIds: [AWKWARD_CENTRED],
      facing: "side",
    });
    expect(walls.changed).toHaveLength(4);

    const floors = setLightmapScale(AWKWARD_VMF, 32, {
      solidIds: [AWKWARD_CENTRED],
      facing: "up",
    });
    expect(floors.changed).toHaveLength(1);

    // And the luxel bill is measured from each face's own extent, so a 256-unit cube's
    // faces all cost the same and none of them reports another's.
    for (const c of walls.changed) expect(c.areaUnits).toBe(walls.changed[0]!.areaUnits);
  });

  it("move_vertices reshapes a brush read from planes alone", () => {
    const centred = byId(AWKWARD_VMF, AWKWARD_CENTRED)!;
    const top = centred.vertices.filter((v) => v[2] === 128);
    expect(top).toHaveLength(4);
    const east = top.filter((v) => v[0] === 128);
    const r = moveVertices(
      AWKWARD_VMF,
      AWKWARD_CENTRED,
      east.map((v) => ({ from: v, to: [v[0], v[1], 64] as [number, number, number] })),
    );
    expect(r.moved).toBe(2);
    expect(byId(r.text, AWKWARD_CENTRED)!.valid).toBe(true);
  });

  it("set_solid_class moves a brush between world and entity", () => {
    const r = reclassSolids(AWKWARD_VMF, [AWKWARD_OFFSET], {
      to: "entity",
      classname: "func_detail",
    });
    const owners = read(r.text).map((s) => s.owner).sort();
    expect(owners).toEqual(["func_detail", "world"]);
  });

  it("hollow makes walls whose volumes still sum to the shell", () => {
    const centred = byId(AWKWARD_VMF, AWKWARD_CENTRED)!;
    const h = hollowSolid(centred, { thickness: 16 });
    expect(h.walls).toHaveLength(6);
    expect(h.shellVolume).toBeCloseTo(h.outerVolume - h.innerVolume, 3);
  });

  it("set_visgroup names a selection and reads it back", () => {
    const r = setVisgroup(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, { name: "Middle" });
    const org = readOrganisation(r.text);
    expect(org.visgroups).toHaveLength(1);
    expect(org.visgroups[0]!.solidCount).toBe(1);
    expect(org.warnings.filter((w) => w.includes("declared nowhere"))).toEqual([]);
  });

  it("group_solids and its undo leave the editor colour alone", () => {
    // The colour shares a line with everything else in that editor block, which is what
    // made removing a membership take it.
    const grouped = groupSolids(AWKWARD_VMF, { ids: [AWKWARD_CENTRED, AWKWARD_OFFSET] });
    expect(readOrganisation(grouped.text).groups[0]!.solidCount).toBe(2);

    const loose = groupSolids(grouped.text, { ids: [AWKWARD_CENTRED] }, { ungroup: true });
    expect(loose.solidsChanged).toBe(1);
    // The colour shares its line with the membership, so a line-wide cut would take it.
    const colours = loose.text.match(/"color" "0 180 220"/g) ?? [];
    expect(colours, "both editor colours survive").toHaveLength(2);
  });

  it("set_cordon writes a box the reader recovers", () => {
    const r = setCordon(AWKWARD_VMF, { mins: [-512, -512, -512], maxs: [512, 512, 512] });
    const org = readOrganisation(r.text);
    expect(org.cordons).toHaveLength(1);
    expect(org.cordons[0]!.maxs).toEqual([512, 512, 512]);
  });

  it("nothing any of them wrote changed the geometry it was not asked about", () => {
    // The property that ties the file together: an edit aimed at one brush leaves the
    // other exactly as it was, byte for byte in its own measurements.
    const before = byId(AWKWARD_VMF, AWKWARD_OFFSET)!;
    const edits = [
      setFaceMaterial(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED] }, "BRICK/WALL").text,
      alignFaces(AWKWARD_VMF, { solidIds: [AWKWARD_CENTRED] }, { mode: "world" }).text,
      setVisgroup(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, { name: "Middle" }).text,
      transformSolids(AWKWARD_VMF, { ids: [AWKWARD_CENTRED] }, translation([0, 0, 8])).text,
    ];
    for (const text of edits) {
      const after = byId(text, AWKWARD_OFFSET)!;
      expect(after.volume).toBe(before.volume);
      expect(after.mins).toEqual(before.mins);
      expect(after.sides.map((s) => s.material)).toEqual(before.sides.map((s) => s.material));
    }
  });
});
