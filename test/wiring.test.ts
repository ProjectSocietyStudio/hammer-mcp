import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { readEntityReportTool, validateIoTool } from "../src/tools/wiring.js";
import { applyVmfOps } from "../src/vmf/edit.js";
import { checkWiring, entityReport, parseConnection, readConnections } from "../src/vmf/wiring.js";
import type { ClassSchema } from "../src/vmf/wiring.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");

/** ESC, written as an escape: an invisible character in a test is one nobody notices. */
const ESC = "\u001b";

/** The probe with a button wired to a door, both named, plus one wire that goes nowhere. */
const WIRED = ((): string => {
  const withEntities = applyVmfOps(probe(), [
    {
      op: "add",
      keyvalues: { classname: "func_button", targetname: "button_a", origin: "0 0 32" },
    },
    {
      op: "add",
      keyvalues: { classname: "func_door", targetname: "door_a", origin: "64 0 32" },
    },
  ]).text;
  return applyVmfOps(withEntities, [
    {
      op: "addOutput",
      match: { classname: "func_button" },
      output: "OnPressed",
      value: `door_a${ESC}Open${ESC}${ESC}0${ESC}-1`,
    },
    {
      op: "addOutput",
      match: { classname: "func_button" },
      output: "OnPressed",
      value: `door_that_is_not_here${ESC}Open${ESC}${ESC}0${ESC}-1`,
    },
  ]).text;
})();

describe("parseConnection", () => {
  it("reads the form Hammer writes today", () => {
    const c = parseConnection(`door_a${ESC}Open${ESC}${ESC}1.5${ESC}-1`)!;
    expect(c.target).toBe("door_a");
    expect(c.input).toBe("Open");
    expect(c.delay).toBe(1.5);
    expect(c.timesToFire).toBe(-1);
  });

  it("reads the comma form Source used before the Orange Box", () => {
    // Hammer still opens those files, so a reader that only knows one separator reports a
    // pre-2007 map as having no wiring at all.
    const c = parseConnection("door_a,Open,,0,-1")!;
    expect(c.target).toBe("door_a");
    expect(c.input).toBe("Open");
  });

  it("refuses a value that is not a connection", () => {
    expect(parseConnection("just_a_name")).toBeNull();
    expect(parseConnection("")).toBeNull();
  });
});

describe("readConnections", () => {
  it("finds every output and counts what each one resolves to", () => {
    const { connections } = readConnections(WIRED);
    expect(connections).toHaveLength(2);
    const good = connections.find((c) => c.target === "door_a")!;
    expect(good.fromClassname).toBe("func_button");
    expect(good.output).toBe("OnPressed");
    expect(good.input).toBe("Open");
    expect(good.resolved).toBe(1);

    const bad = connections.find((c) => c.target === "door_that_is_not_here")!;
    expect(bad.resolved).toBe(0);
  });

  it("says so when a value cannot be read as a connection", () => {
    const broken = WIRED.replace(/"OnPressed" "door_a[^"]*"/, '"OnPressed" "nonsense"');
    expect(broken).not.toBe(WIRED);
    const { malformed } = readConnections(broken);
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.rule).toBe("malformed-connection");
  });

  it("finds nothing in a map with no wiring, rather than failing", () => {
    expect(readConnections(probe()).connections).toEqual([]);
  });
});

describe("checkWiring", () => {
  const schemas = new Map<string, ClassSchema>([
    ["func_button", { inputs: new Set(["lock", "unlock"]), outputs: new Set(["onpressed"]) }],
    ["func_door", { inputs: new Set(["open", "close"]), outputs: new Set(["onopen"]) }],
  ]);

  it("finds the wire that fires into nothing", () => {
    // No compiler mentions this. The output fires, nothing has that name, and the map runs
    // exactly as if the wire were not there.
    const r = checkWiring(WIRED, schemas);
    const errors = r.findings.filter((f) => f.rule === "unknown-target");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.target).toBe("door_that_is_not_here");
    expect(r.unresolvedTargets).toEqual(["door_that_is_not_here"]);
  });

  it("accepts a wire whose target and input both exist", () => {
    const r = checkWiring(WIRED, schemas);
    expect(r.findings.filter((f) => f.target === "door_a")).toEqual([]);
  });

  it("finds an input the target's class does not have", () => {
    const wrong = WIRED.replace(`door_a${ESC}Open`, `door_a${ESC}Detonate`);
    expect(wrong).not.toBe(WIRED);
    const r = checkWiring(wrong, schemas);
    const found = r.findings.filter((f) => f.rule === "unknown-input");
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toMatch(/no input called Detonate/);
  });

  it("finds an output the firing class does not have", () => {
    // Dead at the near end rather than the far one: the wire never fires at all.
    const wrong = WIRED.replace('"OnPressed"', '"OnPushed"');
    const r = checkWiring(wrong, schemas);
    expect(r.findings.some((f) => f.rule === "unknown-output")).toBe(true);
  });

  it("calls a runtime target unresolvable rather than broken", () => {
    // !activator is resolved by the engine when the map runs. Reporting it as a fault
    // would bury the real ones under every well-written trigger in the map.
    const runtime = WIRED.replace("door_that_is_not_here", "!activator");
    const r = checkWiring(runtime, schemas);
    expect(r.findings.filter((f) => f.rule === "unknown-target")).toEqual([]);
    const warned = r.findings.filter((f) => f.rule === "runtime-target");
    expect(warned).toHaveLength(1);
    expect(warned[0]!.severity).toBe("warning");
  });

  it("treats an empty output set as a schema, not as a missing one", () => {
    // A class the FGD defines with no outputs is a class where every output is wrong. The
    // size > 0 guard suppressed exactly those findings, which are the ones that matter most.
    const silent = new Map<string, ClassSchema>([
      ["func_button", { inputs: new Set(["lock"]), outputs: new Set() }],
      ["func_door", { inputs: new Set(["open"]), outputs: new Set() }],
    ]);
    const r = checkWiring(WIRED, silent);
    expect(r.findings.filter((f) => f.rule === "unknown-output").length).toBeGreaterThan(0);

    // And the same for a class with no inputs at all.
    const deaf = new Map<string, ClassSchema>([
      ["func_button", { inputs: new Set(), outputs: new Set(["onpressed"]) }],
      ["func_door", { inputs: new Set(), outputs: new Set(["onopen"]) }],
    ]);
    expect(checkWiring(WIRED, deaf).findings.filter((f) => f.rule === "unknown-input").length)
      .toBeGreaterThan(0);
  });

  it("softens an unresolved target to a warning when the map has instances", () => {
    // An instance's entities are not in this file, and its names are rewritten by fixup, so
    // an output aimed at one resolves in the compiled map and resolves nowhere here.
    // Calling that broken would fill the report with the map's best-organised parts.
    const withInstance = applyVmfOps(WIRED, [
      {
        op: "add",
        keyvalues: {
          classname: "func_instance",
          file: "instances/room.vmf",
          origin: "0 0 0",
          targetname: "room",
        },
      },
    ]).text;

    const plain = checkWiring(WIRED, schemas).findings.filter((f) => f.rule === "unknown-target");
    expect(plain[0]!.severity, "no instance: still an error").toBe("error");

    const r = checkWiring(withInstance, schemas);
    const soft = r.findings.filter((f) => f.rule === "unknown-target");
    expect(soft).toHaveLength(1);
    expect(soft[0]!.severity).toBe("warning");
    expect(soft[0]!.message).toMatch(/fixup/);
    expect(r.warnings.join(" ")).toMatch(/func_instance/);
  });

  it("does not judge a class it has no schema for", () => {
    // Absence of a definition is not evidence of a fault, and reporting one would bury
    // every real finding under the custom entities a mod adds.
    const r = checkWiring(WIRED, new Map());
    expect(r.findings.filter((f) => f.rule === "unknown-input")).toEqual([]);
    expect(r.findings.filter((f) => f.rule === "unknown-output")).toEqual([]);
    // The unresolved target is still found: that one needs no schema.
    expect(r.findings.filter((f) => f.rule === "unknown-target")).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/no FGD schema loaded/);
  });
});

describe("entityReport", () => {
  it("lists every entity with its keyvalues", () => {
    const rows = entityReport(probe());
    expect(rows.length).toBeGreaterThan(0);
    const light = rows.find((r) => r.classname === "light")!;
    expect(light.origin).toBe("0 0 192");
    expect(light.keyvalues["_light"]).toBe("255 255 255 400");
    // classname, targetname and origin are columns of their own, not keyvalues.
    expect(light.keyvalues["classname"]).toBeUndefined();
    expect(light.keyvalues["origin"]).toBeUndefined();
  });

  it("filters by classname and by targetname", () => {
    expect(entityReport(probe(), { classname: "light" })).toHaveLength(1);
    expect(entityReport(probe(), { classname: "nothing_here" })).toEqual([]);
    expect(entityReport(probe(), { targetname: "hmcp_probe" })).toHaveLength(1);
  });

  it("finds the one entity carrying a key, which is what the report is for", () => {
    // "Which of the forty doors was left locked" is the question, and no other tool here
    // can answer it.
    const rows = entityReport(probe(), { hasKey: "_light" });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.classname).toBe("light");

    expect(entityReport(probe(), { hasKey: "_light", keyValue: "255 255 255 400" })).toHaveLength(1);
    expect(entityReport(probe(), { hasKey: "_light", keyValue: "wrong" })).toEqual([]);
  });

  it("counts the outputs and the solids each entity carries", () => {
    const rows = entityReport(WIRED, { classname: "func_button" });
    expect(rows[0]!.outputCount).toBe(2);
    expect(rows[0]!.solidCount).toBe(0);
  });
});

describe("read_entity_report", () => {
  it("reports the whole map's classnames alongside the filtered rows", () => {
    const r = readEntityReportTool.handler(
      { path: PROBE, classname: "light", limit: 200 } as never,
      ctx,
    ) as unknown as { matched: number; byClassname: Record<string, number> };
    expect(r.matched).toBe(1);
    // The histogram is of the map, not of the filter: a filter that matches one entity
    // still has to say what else is in there.
    expect(Object.keys(r.byClassname).length).toBeGreaterThan(1);
  });
});

describe("validate_io against the real FGD", () => {
  const ready = has.sidecar && has.fgd;

  it.skipIf(!ready)(
    "reads func_button's real outputs and func_door's real inputs",
    async () => {
      const { writeFileSync, mkdtempSync } = await import("node:fs");
      const { tmpdir } = await import("node:os");
      const dir = mkdtempSync(join(tmpdir(), "hammer-io-"));
      const file = join(dir, "wired.vmf");
      writeFileSync(file, WIRED);

      const r = (await validateIoTool.handler({ path: file, limit: 100 } as never, ctx)) as unknown as {
        connectionCount: number;
        classesChecked: number;
        errorCount: number;
        findings: Array<{ rule: string; target: string }>;
      };

      expect(r.connectionCount).toBe(2);
      expect(r.classesChecked, "both classes are in the game's FGD").toBeGreaterThanOrEqual(2);
      // The wire to nothing is found, and the wire to the door is not.
      const missing = r.findings.filter((f) => f.rule === "unknown-target");
      expect(missing).toHaveLength(1);
      expect(missing[0]!.target).toBe("door_that_is_not_here");
      expect(r.findings.filter((f) => f.target === "door_a")).toEqual([]);
    },
    180_000,
  );
});
