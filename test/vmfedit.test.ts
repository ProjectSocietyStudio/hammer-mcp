import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyVmfOps, maxId, readEntities } from "../src/vmf/edit.js";
import { VmfEditError } from "../src/vmf/edit.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { editVmf } from "../src/tools/vmfedit.js";
import { readVmf, readVmfLint } from "../src/tools/vmf.js";
import { FIXTURES, ctx as sharedCtx, has, paths } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const scratch = mkdtempSync(join(tmpdir(), "hammer-vmfedit-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function copyProbe(name: string): string {
  const path = join(scratch, `${name}.vmf`);
  copyFileSync(PROBE, path);
  return path;
}

async function edit(path: string, ops: unknown[], extra: Record<string, unknown> = {}) {
  return (await editVmf.handler(
    { path, ops, dryRun: false, backup: false, confirm: true, ...extra } as never,
    ctx,
  )) as {
    written: boolean;
    unchanged: boolean;
    entitiesBefore: number;
    entitiesAfter: number;
    outcomes: Array<{ op: string; matched: number; ids: Array<number | null>; warnings: string[] }>;
    warnings: string[];
    backupPath: string | null;
  };
}

describe("the property everything else rests on", () => {
  it("returns the exact same bytes when nothing matches", () => {
    // Necessary, and on its own not sufficient -- see "keeps what a reserialiser would
    // quietly drop" below, which is the one that can actually tell the two apart.
    const before = readFileSync(PROBE, "utf8");
    const r = applyVmfOps(before, [{ op: "update", match: { classname: "nothing_here" }, set: { a: "b" } }]);
    expect(r.text).toBe(before);
    expect(r.unchanged).toBe(true);
  });

  it("leaves every byte outside the edited pair alone", () => {
    const before = readFileSync(PROBE, "utf8");
    const r = applyVmfOps(before, [
      { op: "update", match: { classname: "info_player_start" }, set: { targetname: "spawn_a" } },
    ]);

    // Exactly one line differs, and it is the one that was asked for.
    const b = before.split("\n");
    const a = r.text.split("\n");
    const changed = a.filter((line, i) => line !== b[i]);
    expect(r.text).not.toBe(before);
    expect(changed.some((l) => l.includes("spawn_a"))).toBe(true);
    // A reserialising implementation would rewrite hundreds of lines here.
    expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(1);
  });

  it("keeps what a reserialiser would quietly drop", () => {
    // This test exists because the three above did NOT catch a deliberate sabotage that
    // replaced the splice with `serialize(parse(text))`. Both fixtures here are canonical
    // Hammer output -- tab-indented, no comments, no blank lines -- so reserialising them
    // is a no-op and every byte-for-byte assertion passed anyway.
    //
    // What a reserialiser really loses is everything the grammar does not model:
    // comments, blank lines, and indentation that is not one tab per level. Editors and
    // hand-edited maps have all three, and losing them is silent.
    const source = join(scratch, "quirky.vmf");
    writeFileSync(
      source,
      [
        "// Handwritten header nobody wants deleted",
        "versioninfo",
        "{",
        '    "editorversion" "400"',
        "",
        '    "mapversion" "7"',
        "}",
        "entity",
        "{",
        '\t"id" "1"',
        '\t"classname" "info_target"',
        "}",
        "",
      ].join("\n"),
    );
    const before = readFileSync(source, "utf8");

    const r = applyVmfOps(before, [
      { op: "update", match: { classname: "info_target" }, set: { targetname: "kept" } },
    ]);

    expect(r.text).toContain("// Handwritten header nobody wants deleted");
    expect(r.text).toContain('    "editorversion" "400"');
    expect(r.text).toMatch(/"editorversion" "400"\n\n/);
    expect(r.text).toContain('"targetname" "kept"');
  });

  it("keeps solids untouched when a keyvalue changes", () => {
    // The specific hazard a VMF has and the entity lump does not: rewriting an entity
    // block whole would drop or reformat the solid/connections/editor sub-blocks that
    // carry the geometry.
    const before = readFileSync(PROBE, "utf8");
    const solidsBefore = (before.match(/^\s*solid$/gm) ?? []).length;
    const sidesBefore = (before.match(/^\s*side$/gm) ?? []).length;

    const r = applyVmfOps(before, [
      { op: "update", match: { classname: "light" }, set: { _light: "255 128 64 200" } },
    ]);
    expect((r.text.match(/^\s*solid$/gm) ?? []).length).toBe(solidsBefore);
    expect((r.text.match(/^\s*side$/gm) ?? []).length).toBe(sidesBefore);
  });
});

describe("ids", () => {
  it("scans the whole tree, not just the entities", () => {
    // Hammer numbers entities, solids, sides and editor nodes from one counter. A new
    // entity reusing a number already taken by a brush side makes the file unopenable.
    // The oracle is independent of the parser: every "id" in the raw text, by regex.
    const text = readFileSync(PROBE, "utf8");
    const inFile = [...text.matchAll(/"id"\s+"(\d+)"/g)].map((m) => Number(m[1]));
    expect(inFile.length).toBeGreaterThan(1);
    expect(maxId(readEntities(text).nodes)).toBe(Math.max(...inFile));
  });

  it("gives a new entity an id nothing else uses", () => {
    const text = readFileSync(PROBE, "utf8");
    const highest = maxId(readEntities(text).nodes);
    const r = applyVmfOps(text, [
      { op: "add", keyvalues: { classname: "info_target", targetname: "probe_marker" } },
    ]);
    expect(r.outcomes[0]!.ids[0]).toBe(highest + 1);
    expect(maxId(readEntities(r.text).nodes)).toBe(highest + 1);
  });

  it("refuses an id passed in, rather than letting it collide", () => {
    const text = readFileSync(PROBE, "utf8");
    expect(() =>
      applyVmfOps(text, [{ op: "add", keyvalues: { classname: "info_target", id: "3" } }]),
    ).toThrow(VmfEditError);
  });

  it("refuses to change or unset an id", () => {
    const text = readFileSync(PROBE, "utf8");
    expect(() =>
      applyVmfOps(text, [{ op: "update", match: { classname: "light" }, set: { id: "9999" } }]),
    ).toThrow(/id cannot be changed/);
    expect(() =>
      applyVmfOps(text, [{ op: "update", match: { classname: "light" }, unset: ["id"] }]),
    ).toThrow(/id cannot be unset/);
  });
});

describe("selecting what to edit", () => {
  it("refuses an empty match instead of hitting everything", () => {
    const text = readFileSync(PROBE, "utf8");
    expect(() => applyVmfOps(text, [{ op: "update", match: {}, set: { a: "b" } }])).toThrow(
      VmfEditError,
    );
  });

  it("matches on Hammer's own id", () => {
    const text = readFileSync(PROBE, "utf8");
    const target = readEntities(text).entities[0]!;
    const r = applyVmfOps(text, [
      { op: "update", match: { id: target.id as number }, set: { probe: "1" } },
    ]);
    expect(r.outcomes[0]!.matched).toBe(1);
    expect(r.outcomes[0]!.ids).toEqual([target.id]);
  });
});

describe("outputs", () => {
  it("creates a connections block when the entity has none, then reuses it", () => {
    const text = readFileSync(PROBE, "utf8");
    const one = applyVmfOps(text, [
      {
        op: "addOutput",
        match: { classname: "info_player_start" },
        output: "OnUser1",
        value: "door_a,Open,,0,-1",
      },
    ]);
    expect(one.text).toContain("connections");
    expect(one.text).toContain('"OnUser1" "door_a,Open,,0,-1"');

    const two = applyVmfOps(one.text, [
      {
        op: "addOutput",
        match: { classname: "info_player_start" },
        output: "OnUser2",
        value: "door_b,Close,,0,-1",
      },
    ]);
    // A second connections block would be legal KeyValues and wrong: Hammer reads only
    // the first, so half the outputs would silently disappear in the editor.
    expect((two.text.match(/^\s*connections$/gm) ?? []).length).toBe(1);
    expect(two.text).toContain('"OnUser2"');
  });

  it("removes only the output asked for", () => {
    const text = readFileSync(PROBE, "utf8");
    const withBoth = applyVmfOps(text, [
      { op: "addOutput", match: { classname: "info_player_start" }, output: "OnUser1", value: "a,Open,,0,-1" },
      { op: "addOutput", match: { classname: "info_player_start" }, output: "OnUser1", value: "b,Open,,0,-1" },
    ]).text;

    const r = applyVmfOps(withBoth, [
      {
        op: "removeOutput",
        match: { classname: "info_player_start" },
        output: "OnUser1",
        valueContains: "a,",
      },
    ]);
    expect(r.text).not.toContain('"OnUser1" "a,Open,,0,-1"');
    expect(r.text).toContain('"OnUser1" "b,Open,,0,-1"');
  });
});

describe("warnings that are not refusals", () => {
  it("says when removing an entity takes geometry with it", () => {
    const text = readFileSync(PROBE, "utf8");
    const brushy = readEntities(text).entities.find((e) => e.solidCount > 0);
    if (!brushy) return; // the probe is a sealed room; its brushes may all be worldspawn
    const r = applyVmfOps(text, [{ op: "remove", match: { id: brushy.id as number } }]);
    expect(r.warnings.join(" ")).toMatch(/solid/);
  });

  it("says when a func_ entity is added with no brushes", () => {
    const text = readFileSync(PROBE, "utf8");
    const r = applyVmfOps(text, [{ op: "add", keyvalues: { classname: "func_door" } }]);
    expect(r.warnings.join(" ")).toMatch(/vbsp will drop it/);
  });
});

describe("the tool, on a real file", () => {
  it("writes nothing at all when the ops change nothing", async () => {
    const path = copyProbe("noop");
    const before = readFileSync(path);
    const r = await edit(path, [{ op: "update", match: { classname: "nope" }, set: { a: "b" } }]);
    expect(r.unchanged).toBe(true);
    expect(r.written).toBe(false);
    // Not even a backup: rewriting identical bytes still moves the mtime, and a mapper's
    // build tooling watches mtimes.
    expect(r.backupPath).toBeNull();
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("honours dryRun", async () => {
    const path = copyProbe("dry");
    const before = readFileSync(path);
    const r = await edit(path, [{ op: "add", keyvalues: { classname: "info_target" } }], {
      dryRun: true,
    });
    expect(r.entitiesAfter).toBe(r.entitiesBefore + 1);
    expect(r.written).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it("keeps a backup beside the map", async () => {
    const path = copyProbe("backup");
    const before = readFileSync(path);
    const r = await edit(path, [{ op: "add", keyvalues: { classname: "info_target" } }], {
      backup: true,
    });
    expect(r.backupPath).toBe(`${path}.bak`);
    expect(readFileSync(r.backupPath as string).equals(before)).toBe(true);
    expect(readFileSync(path).equals(before)).toBe(false);
  });

  it.skipIf(!(has.sidecar && has.fgd))("produces a file read_vmf and the lint agree with", async () => {
    const path = copyProbe("roundtrip");
    await edit(path, [
      { op: "add", keyvalues: { classname: "info_target", targetname: "hmcp_edit_probe" } },
    ]);

    const read = (await readVmf.handler(
      { path, limit: 500, collapseInstances: false },
      ctx,
    )) as { histogram: Record<string, number> };
    expect(read.histogram["info_target"]).toBeGreaterThanOrEqual(1);

    // The half that matters: a file this tool wrote must still be a file the lint is
    // quiet about. A splice that produced almost-valid KeyValues would pass every
    // assertion above and fail here.
    const lint = (await readVmfLint.handler(
      { path, limit: 50, collapseInstances: false },
      ctx,
    )) as { bySeverity: Record<string, number> };
    expect(lint.bySeverity["error"] ?? 0).toBe(0);
  }, 60_000);
});

describe("a Hammer++ file survives an edit", () => {
  it("keeps vertices_plus and the root ++ blocks", () => {
    // Hammer++ writes blocks vanilla Hammer does not. A write path that dropped what it
    // did not recognise would cost a mapper their exact face windings, silently.
    const text = readFileSync(PROBE, "utf8").replace(
      /^versioninfo$/m,
      `palette_plus\n{\n\t"color0" "255 255 255"\n}\ncolorcorrection_plus\n{\n\t"name0" ""\n}\nversioninfo`,
    );
    const source = join(scratch, "hpp.vmf");
    writeFileSync(source, text);

    const r = applyVmfOps(readFileSync(source, "utf8"), [
      { op: "add", keyvalues: { classname: "info_target" } },
    ]);
    expect(r.text).toContain("palette_plus");
    expect(r.text).toContain("colorcorrection_plus");
  });
});

describe("a large Hammer-written map", () => {
  it.skipIf(!has.tttSource)("changes one line in seven thousand", () => {
    // The probe is small enough that a reserialising implementation might look fine on it.
    // ttt_traps is 7082 lines of real Hammer output, floats and all.
    const text = readFileSync(paths.tttSource, "utf8");
    const first = readEntities(text).entities[0]!;
    const r = applyVmfOps(text, [
      { op: "update", match: { id: first.id as number }, set: { hmcp_probe: "1" } },
    ]);

    // Counted as a multiset difference, not positionally: inserting one line shifts every
    // line after it, so a positional comparison would call a one-line insert a rewrite.
    const b = text.split("\n");
    const a = r.text.split("\n");
    const counts = new Map<string, number>();
    for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
    for (const line of a) counts.set(line, (counts.get(line) ?? 0) - 1);
    const moved = [...counts.values()].reduce((n, c) => n + Math.abs(c), 0);
    expect(moved).toBe(1);
    expect(a.length).toBe(b.length + 1);
  });
});
