import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { locateLeak, readPointfile } from "../src/compile/leak.js";
import { parseCompileLog } from "../src/compile/log.js";
import { ToolchainError, toWindowsPath } from "../src/compile/wine.js";
import { loadConfig } from "../src/config.js";
import type { MapEntity } from "../src/entity/model.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readLeak, runCompile } from "../src/tools/compile.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const REPO = join(FIXTURES, "..", "..", "..");
const config = loadConfig(REPO);
const ctx = { config, audit: { record: () => undefined } } as unknown as ToolContext;

const canCompile = existsSync(join(config.gmodBin, "vbsp.exe"));
const scratch = mkdtempSync(join(tmpdir(), "hammer-compile-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("Windows path conversion", () => {
  it("maps the root onto Z:", () => {
    expect(toWindowsPath("/home/x/map.vmf")).toBe("Z:\\home\\x\\map.vmf");
  });

  it("refuses a relative path", () => {
    // The failure this prevents is silent: wine resolves a relative path against its
    // own working directory, and vbsp then compiles a different file successfully.
    expect(() => toWindowsPath("maps/foo.vmf")).toThrow(ToolchainError);
  });
});

describe("compile log rules", () => {
  it("recognises a leak and marks the log unclean", () => {
    const r = parseCompileLog("Processing areas...\n**** leaked ****\nEntity light (0 0 0) leaked!");
    expect(r.leaked).toBe(true);
    expect(r.clean).toBe(false);
    expect(r.findings[0]!.message).toMatch(/not sealed/);
  });

  it("stays clean and quiet on ordinary output", () => {
    // The baseline: a parser that flagged everything would look the same as one that works.
    const r = parseCompileLog("Loading map\nProcessing areas...\nDone (2)\n4 threads");
    expect(r.findings).toHaveLength(0);
    expect(r.clean).toBe(true);
  });

  it("explains what the compiler's own message hides", () => {
    const r = parseCompileLog("Displacement found on a(n) func_detail entity!");
    expect(r.findings[0]!.rule).toBe("displacement-on-entity");
    // vbsp prints brush id 0 every time, so the message has to say where the real one is.
    expect(r.findings[0]!.message).toMatch(/always 0/);
  });

  it("does not call the skybox cubemap notice a missing material", () => {
    // First-match-wins is what makes this work: the line matches the generic
    // "Can't load" rule too, whose advice -- pack the asset -- is wrong here, because
    // nothing is missing. vbsp simply could not build a placeholder.
    const r = parseCompileLog(
      "Can't load skybox file skybox/sky_day01_01 to build the default cubemap!",
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.rule).toBe("cubemap-size-mismatch");
    expect(r.findings[0]!.severity).toBe("info");
  });

  it("still reports a genuinely missing material", () => {
    const r = parseCompileLog("Material foo/bar not found.");
    expect(r.findings[0]!.rule).toBe("material-missing");
  });
});

describe("pointfile correlation", () => {
  const entity = (index: number, classname: string, origin: [number, number, number]): MapEntity =>
    ({
      index,
      classname,
      origin,
      keyvalues: [],
      connections: [],
      solidCount: 0,
      start: 0,
      end: 0,
    }) as MapEntity;

  it("names the entity sitting on an endpoint, whichever end it is", () => {
    // Measured, not assumed: vbsp put the entity on the SECOND point of a two-point
    // pointfile. Correlating only the first named a light 232 units away and missed
    // the actual cause.
    const path = join(scratch, "two.lin");
    writeFileSync(path, "-144 -144 304\n0 0 2000\n");
    const report = locateLeak(path, readPointfile(path), [
      entity(0, "light", [0, 0, 192]),
      entity(1, "info_player_start", [0, 0, 2000]),
    ]);
    expect(report.leakingEntity?.classname).toBe("info_player_start");
    expect(report.leakingEntity?.atEnd).toBe(true);
    expect(report.leakingEntity?.distanceUnits).toBe(0);
    expect(report.nearestToStart[0]!.classname).toBe("light");
  });

  it("reports no culprit when no entity is on either end", () => {
    // The negative control: without it, a correlation that always named its closest
    // entity would look exactly like one that identifies the cause.
    const path = join(scratch, "far.lin");
    writeFileSync(path, "0 0 0\n1000 1000 1000\n");
    const report = locateLeak(path, readPointfile(path), [
      entity(0, "light", [5000, 5000, 5000]),
    ]);
    expect(report.leakingEntity).toBeNull();
  });

  it("says a missing pointfile probably means no leak", () => {
    expect(() => readPointfile(join(scratch, "absent.lin"))).toThrow(/did not leak/);
  });
});

describe("compiling for real, under wine", () => {
  const sealed = join(scratch, "sealed.vmf");
  const leaky = join(scratch, "leaky.vmf");

  if (canCompile) {
    copyFileSync(join(FIXTURES, "hmcp_probe.vmf"), sealed);
    // The most common real cause of a leak, and it touches no geometry: an entity
    // placed outside the sealed hull.
    writeFileSync(
      leaky,
      readFileSync(sealed, "utf8").replace(
        /("classname" "info_player_start"[\s\S]{0,200}?"origin" ")[^"]*(")/,
        "$10 0 2000$2",
      ),
    );
  }

  it.skipIf(!canCompile)("compiles the sealed probe without error", async () => {
    const r = (await runCompile.handler(
      { vmf: sealed, fast: true, hdr: false, stages: ["vbsp"], timeoutMinutes: 10, confirm: true },
      ctx,
    )) as { ok: boolean; leaked: boolean; bspExists: boolean; pointfile: string | null };
    expect(r.leaked).toBe(false);
    expect(r.bspExists).toBe(true);
    expect(r.pointfile).toBeNull();
    expect(r.ok).toBe(true);
  }, 300_000);

  it.skipIf(!canCompile)("detects the leak and locates its cause", async () => {
    const compiled = (await runCompile.handler(
      { vmf: leaky, fast: true, hdr: false, stages: ["vbsp"], timeoutMinutes: 10, confirm: true },
      ctx,
    )) as { ok: boolean; leaked: boolean; pointfile: string | null };
    expect(compiled.leaked).toBe(true);
    expect(compiled.ok).toBe(false);
    expect(compiled.pointfile).not.toBeNull();

    const located = (await readLeak.handler({ path: leaky, limit: 3 }, ctx)) as {
      leakingEntity: { classname: string; distanceUnits: number } | null;
    };
    expect(located.leakingEntity?.classname).toBe("info_player_start");
    expect(located.leakingEntity?.distanceUnits).toBeLessThan(16);
  }, 300_000);
});
