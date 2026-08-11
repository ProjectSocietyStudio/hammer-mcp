import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { luaEntityClasses } from "../src/lua/entities.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readFgdClass, readVmf, readVmfLint } from "../src/tools/vmf.js";
import { FIXTURES, config, ctx as sharedCtx, has, paths } from "./support/env.js";

const PROBE_VMF = join(FIXTURES, "hmcp_probe.vmf");
const ctx = sharedCtx as unknown as ToolContext;

const ready = has.sidecar && has.fgd;
const TTT = paths.tttSource;
const hasTtt = has.tttSource;

const scratch = mkdtempSync(join(tmpdir(), "hammer-lint-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Writes a copy of the probe VMF with `edit` applied, and returns its path. */
function broken(name: string, edit: (source: string) => string): string {
  const path = join(scratch, `${name}.vmf`);
  writeFileSync(path, edit(readFileSync(PROBE_VMF, "utf8")));
  return path;
}

async function lint(path: string): Promise<{
  byRule: Record<string, number>;
  findings: Array<Record<string, unknown>>;
  total: number;
}> {
  return (await readVmfLint.handler({ path, limit: 500, collapseInstances: false }, ctx)) as never;
}

describe("the repo's Lua entity classes", () => {
  it.skipIf(!has.luaEntities)("finds the scripted entities the FGD cannot know about", () => {
    // Without these the lint calls every TTT entity an unknown class. The two named
    // here are the ones it actually got wrong before this existed.
    const classes = luaEntityClasses(config);
    expect(classes.length).toBeGreaterThan(50);
    expect(classes).toContain("ttt_damageowner");
    expect(classes).toContain("ttt_traitor_button");
  });
});

describe("read_fgd_class", () => {
  it.skipIf(!ready)("reads the game's own FGD, not a generic one", async () => {
    const out = (await readFgdClass.handler({ classname: "prop_dynamic", limit: 200 }, ctx)) as {
      keyvalues: unknown[];
      inputs: string[];
      classCount: number;
    };
    expect(out.classCount).toBeGreaterThan(400);
    expect(out.inputs).toContain("SetAnimation");
    // GMod's own prop_dynamic declares far fewer keyvalues than the multi-game union
    // srctools bundles, which reports 111. Landing on the union would mean the lint
    // accepts keys this game does not have.
    expect(out.keyvalues.length).toBeLessThan(80);
    expect(() => z.object(readFgdClass.outputSchema!).parse(out)).not.toThrow();
  }, 60_000);

  it.skipIf(!ready)("knows a class that exists only in GMod", async () => {
    const out = (await readFgdClass.handler({ classname: "sent_ball", limit: 200 }, ctx)) as {
      classname: string;
    };
    expect(out.classname).toBe("sent_ball");
  }, 60_000);

  it.skipIf(!ready)("suggests near matches instead of failing blankly", async () => {
    await expect(
      readFgdClass.handler({ classname: "prop_dynamik", limit: 200 }, ctx),
    ).rejects.toThrow(/did you mean/);
  }, 60_000);
});

describe("read_vmf_lint finds faults that were put there on purpose", () => {
  it.skipIf(!ready)("is quiet on a clean map", async () => {
    // The baseline that gives the rest of this suite its meaning: a rule that fires on
    // everything would look identical to a rule that works.
    const r = await lint(PROBE_VMF);
    expect(r.byRule["unknown-classname"]).toBeUndefined();
    expect(r.byRule["bad-texture-scale"]).toBeUndefined();
    expect(r.byRule["unknown-keyvalue"]).toBeUndefined();
  }, 60_000);

  it.skipIf(!ready)("catches a mistyped classname", async () => {
    const path = broken("typo-class", (s) =>
      s.replace('"classname" "info_player_start"', '"classname" "info_player_strat"'),
    );
    const r = await lint(path);
    expect(r.byRule["unknown-classname"]).toBe(1);
    expect(
      r.findings.find((f) => f["rule"] === "unknown-classname")?.["classname"],
    ).toBe("info_player_strat");
  }, 60_000);

  it.skipIf(!ready)("catches a keyvalue the class does not have", async () => {
    const path = broken("bad-key", (s) =>
      s.replace(
        '"classname" "info_player_start"',
        '"classname" "info_player_start"\n\t"nonexistent_key" "1"',
      ),
    );
    const r = await lint(path);
    expect(r.byRule["unknown-keyvalue"]).toBe(1);
  }, 60_000);

  it.skipIf(!ready)("catches a texture scale vbsp will refuse", async () => {
    // 0.01 is below the 0.1 floor. vbsp reports this as "Bad surface extents" and names
    // a face by an index that cannot be found in Hammer, which is why catching it here
    // is worth a whole rule.
    const path = broken("bad-scale", (s) =>
      s.replace('"uaxis" "[1 0 0 0] 0.25"', '"uaxis" "[1 0 0 0] 0.01"'),
    );
    const r = await lint(path);
    expect(r.byRule["bad-texture-scale"]).toBe(1);
    const f = r.findings.find((x) => x["rule"] === "bad-texture-scale")!;
    expect(f["scale"]).toBe(0.01);
    expect(f["side_id"]).toBeGreaterThan(0);
  }, 60_000);

  it.skipIf(!ready)("catches an output aimed at nothing", async () => {
    // Appended as a whole entity block rather than spliced into an existing one:
    // editing a VMF by string surgery is exactly how you produce a file that fails to
    // parse, which tests the parser instead of the rule.
    const path = broken(
      "dangling-output",
      (s) =>
        s +
        [
          "entity",
          "{",
          '\t"id" "9001"',
          '\t"classname" "logic_auto"',
          '\t"origin" "0 0 64"',
          "\tconnections",
          "\t{",
          '\t\t"OnMapSpawn" "no_such_entity,Kill,,0,-1"',
          "\t}",
          "}",
          "",
        ].join("\n"),
    );
    const r = await lint(path);
    expect(r.byRule["output-target-missing"]).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("the Hammer++ compilers' own FGD", () => {
  const hasPlusFgd = has.plusFgd;

  it.skipIf(!ready)("says which schemas a verdict was reached against", async () => {
    // Reported rather than assumed. A lint that quietly widens its schema is a lint that
    // quietly stops catching things, and nothing in the output would show it.
    const r = (await readVmfLint.handler({ path: PROBE_VMF, limit: 5, collapseInstances: false }, ctx)) as {
      fgdsLoaded: string[];
    };
    expect(r.fgdsLoaded[0]).toBe("garrysmod.fgd");
    expect(r.fgdsLoaded.includes("win64/toolsplusplus.fgd")).toBe(hasPlusFgd);
  }, 60_000);

  it.skipIf(!ready || !hasPlusFgd)("knows the classes only Hammer++ declares", async () => {
    // func_detail_illusionary is not in garrysmod.fgd. Before this, a map built in
    // Hammer++ collected one unknown-classname per use of it -- the same false positive
    // the repo's Lua entities used to produce, from a different missing source.
    const path = broken("hpp-class", (s) =>
      s.replace('"classname" "info_player_start"', '"classname" "func_detail_illusionary"'),
    );
    const r = await lint(path);
    expect(r.byRule["unknown-classname"]).toBeUndefined();
  }, 60_000);

  it.skipIf(!ready)("still refuses a class no FGD declares", async () => {
    // The other half, and the one that matters: merging a second schema must not turn
    // the rule off. Without this, "no unknown-classname" above would be satisfied by a
    // lint that had simply stopped checking.
    const path = broken("hpp-typo", (s) =>
      s.replace('"classname" "info_player_start"', '"classname" "func_detail_illusory"'),
    );
    const r = await lint(path);
    expect(r.byRule["unknown-classname"]).toBe(1);
  }, 60_000);
});

describe("read_vmf_lint on a real Hammer-written map", () => {
  it.skipIf(!ready || !hasTtt)("does not accuse the Lua entities it now knows", async () => {
    // Before the repo's Lua classes were fed in, this map produced 11 unknown-classname
    // errors, all of them wrong: ttt_damageowner and ttt_traitor_button are defined in
    // gamemodes/terrortown/entities/entities/.
    const r = await lint(TTT);
    expect(r.byRule["unknown-classname"]).toBeUndefined();
    expect(r.total).toBeLessThan(20);
  }, 120_000);

  it.skipIf(!ready || !hasTtt)("counts what the compiler will have to fit", async () => {
    const out = (await readVmf.handler({ path: TTT, limit: 5, collapseInstances: false }, ctx)) as {
      counts: { entities: number; worldBrushes: number; entityBrushes: number };
    };
    expect(out.counts.entities).toBe(66);
    expect(out.counts.worldBrushes).toBe(24);
    expect(out.counts.entityBrushes).toBe(51);
    expect(() => z.object(readVmf.outputSchema!).parse(out)).not.toThrow();
  }, 120_000);
});
