import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ToolContext } from "../src/mcp/registry.js";
import { runCompile } from "../src/tools/compile.js";
import { hollowSolidsTool } from "../src/tools/hollow.js";
import { VmfBuildError } from "../src/vmf/build.js";
import { hollowSolid } from "../src/vmf/hollow.js";
import { checkVmfSolids } from "../src/vmf/solid.js";
import type { SolidCheck } from "../src/vmf/solid.js";
import { ctx as sharedCtx, FIXTURES, has } from "./support/env.js";

const PROBE = join(FIXTURES, "hmcp_probe.vmf");
const probe = (): string => readFileSync(PROBE, "utf8");
const read = (text: string): SolidCheck[] => checkVmfSolids("x", text).solids;
const solid = (id: number): SolidCheck => read(probe()).find((s) => s.id === id)!;

/** The probe's floor: 576 x 576 x 32. */
const FLOOR = 7;

describe("hollowSolid: the conservation law", () => {
  it("makes walls that sum to the outer volume less the room inside", () => {
    // Exact, not approximate. A mitre computed with the wrong sign does not give a
    // slightly wrong shell: it gives walls that overlap, or a gap between them.
    const r = hollowSolid(solid(FLOOR), { thickness: 8 });
    expect(r.walls).toHaveLength(6);
    expect(r.shellVolume).toBeCloseTo(r.outerVolume - r.innerVolume, 3);
  });

  it("holds that at several thicknesses", () => {
    for (const thickness of [1, 4, 8, 15]) {
      const r = hollowSolid(solid(FLOOR), { thickness });
      expect(r.shellVolume, `thickness ${thickness}`).toBeCloseTo(
        r.outerVolume - r.innerVolume,
        3,
      );
    }
  });

  it("keeps the outer surface where it was when hollowing inward", () => {
    const before = solid(FLOOR);
    const r = hollowSolid(before, { thickness: 8, direction: "in" });
    expect(r.outerVolume).toBeCloseTo(before.volume, 3);
    expect(r.innerVolume).toBeLessThan(before.volume);
  });

  it("keeps the inner surface where it was when hollowing outward", () => {
    const before = solid(FLOOR);
    const r = hollowSolid(before, { thickness: 8, direction: "out" });
    expect(r.innerVolume).toBeCloseTo(before.volume, 3);
    expect(r.outerVolume).toBeGreaterThan(before.volume);
  });

  it("refuses walls too thick to leave a room", () => {
    // The floor is 32 units deep, so 16-unit walls meet in the middle.
    expect(() => hollowSolid(solid(FLOOR), { thickness: 20 })).toThrow(/no room inside/);
  });

  it("refuses a thickness that is not a thickness", () => {
    expect(() => hollowSolid(solid(FLOOR), { thickness: 0 })).toThrow(VmfBuildError);
    expect(() => hollowSolid(solid(FLOOR), { thickness: -8 })).toThrow(VmfBuildError);
  });
});

describe("hollow_solids", () => {
  const ctx = sharedCtx as unknown as ToolContext;
  const scratch = mkdtempSync(join(tmpdir(), "hammer-hollow-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  interface Reply {
    matched: number;
    hollowed: Array<{ id: number; walls: number; shellVolume: number }>;
    solidsBefore: number;
    solidsAfter: number;
    warnings: string[];
  }

  const run = (args: Record<string, unknown>): { file: string; reply: Reply } => {
    const file = join(scratch, `h${Math.round(performance.now() * 1000)}.vmf`);
    writeFileSync(file, probe());
    const reply = hollowSolidsTool.handler(
      { path: file, thickness: 8, direction: "in", backup: false, confirm: true, ...args } as never,
      ctx,
    ) as unknown as Reply;
    return { file, reply };
  };

  it("replaces one block with six walls the checker accepts", () => {
    const { file, reply } = run({ solidIds: [FLOOR] });
    expect(reply.matched).toBe(1);
    expect(reply.hollowed[0]!.walls).toBe(6);
    // Six brushes in, one removed and six added.
    expect(reply.solidsAfter).toBe(reply.solidsBefore - 1 + 6);

    for (const s of read(readFileSync(file, "utf8"))) {
      expect(s.valid, `solid ${s.id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(true);
    }
  });

  it("leaves no two walls sharing a cubic unit", () => {
    // The whole reason this mitres rather than doing what Hammer does. Overlapping world
    // brushes are legal; they cost faces vbsp has to split, and a seam that can z-fight.
    const { reply } = run({ solidIds: [FLOOR] });
    const sum = reply.hollowed[0]!.shellVolume;
    const r = hollowSolid(solid(FLOOR), { thickness: 8 });
    expect(sum).toBeCloseTo(r.outerVolume - r.innerVolume, 3);
  });

  it("keeps the source's material outside and puts nodraw on the new faces", () => {
    // Hollowing a brick room and getting brick on the inside of its own walls is what
    // Hammer does, and what a mapper then undoes by hand.
    const { file } = run({ solidIds: [FLOOR] });
    const walls = read(readFileSync(file, "utf8")).filter((s) => s.id !== FLOOR && s.volume < 3e6);
    const outward = walls.flatMap((s) =>
      s.sides.filter((x) => x.material === "DEV/DEV_MEASUREGENERIC01"),
    );
    const created = walls.flatMap((s) =>
      s.sides.filter((x) => x.material === "TOOLS/TOOLSNODRAW"),
    );
    expect(outward.length).toBeGreaterThan(0);
    expect(created.length).toBeGreaterThan(0);
  });

  it("removes the block it hollowed, unless told to keep it", () => {
    const { reply } = run({ solidIds: [FLOOR] });
    expect(reply.solidsAfter).toBe(11);

    const kept = run({ solidIds: [FLOOR], keepSource: true });
    expect(kept.reply.solidsAfter).toBe(12);
  });

  it("refuses a selector that names nothing", () => {
    expect(() => run({})).toThrow(/empty selector/);
  });

  it("reports a selector that matched nothing rather than failing", () => {
    const { reply } = run({ solidIds: [9999] });
    expect(reply.matched).toBe(0);
    expect(reply.warnings.join(" ")).toMatch(/nothing matched/);
  });
});

describe("what the compiler says about a hollowed block", () => {
  const canCompile = has.toolchain;
  const scratch = mkdtempSync(join(tmpdir(), "hammer-hollow-c-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const ctx = sharedCtx as unknown as ToolContext;

  /**
   * A single block hollowed into a room, with the probe's spawn and light inside it. This
   * is the probe built the other way round: instead of six walls placed by hand, one block
   * turned into six walls by the tool. It must seal, and it is only sealed if the mitres
   * meet exactly.
   */
  const room = (thickness: number): string => {
    const file = join(scratch, `room${thickness}.vmf`);
    // One block spanning the probe's whole extent, with everything else removed.
    const source = probe();
    const shell = join(scratch, `shell${thickness}.vmf`);
    writeFileSync(shell, source);
    hollowSolidsTool.handler(
      {
        path: shell,
        solidIds: [7, 14, 21, 28, 35, 42],
        thickness,
        direction: "in",
        backup: false,
        confirm: true,
      } as never,
      ctx,
    );
    writeFileSync(file, readFileSync(shell, "utf8"));
    return file;
  };

  it.skipIf(!canCompile)(
    "every brush of the probe hollowed still compiles, and the map still seals",
    async () => {
      const file = room(8);
      for (const s of read(readFileSync(file, "utf8"))) {
        expect(s.valid, `solid ${s.id}: ${s.findings.map((f) => f.message).join(" | ")}`).toBe(
          true,
        );
      }
      const out = (await runCompile.handler(
        {
          vmf: file,
          fast: true,
          hdr: false,
          stages: ["vbsp"],
          toolchain: "stock",
          cull: false,
          timeoutMinutes: 10,
          confirm: true,
        },
        ctx,
      )) as { ok: boolean; leaked: boolean };
      expect(out.leaked).toBe(false);
      expect(out.ok).toBe(true);
    },
    300_000,
  );
});
