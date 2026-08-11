import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { checkNavFreshness, NavFormatError, readNavHeader } from "../src/bsp/nav.js";
import { loadConfig } from "../src/config.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readNav } from "../src/tools/compile.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const REPO = join(FIXTURES, "..", "..", "..");
const config = loadConfig(REPO);
const ctx = { config, audit: { record: () => undefined } } as unknown as ToolContext;

const MAPS = join(REPO, "srcds/garrysmod/maps");
const CONSTRUCT_NAV = join(MAPS, "gm_construct.nav");
const CONSTRUCT_BSP = join(MAPS, "gm_construct.bsp");
const hasNav = existsSync(CONSTRUCT_NAV) && existsSync(CONSTRUCT_BSP);

const scratch = mkdtempSync(join(tmpdir(), "hammer-nav-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("nav mesh header", () => {
  it.skipIf(!hasNav)("decodes the shipped meshes", () => {
    const h = readNavHeader(CONSTRUCT_NAV);
    expect(h.version).toBe(16);
    expect(h.isAnalyzed).toBe(true);
    // Recorded byte-for-byte from the file, and matched against the real .bsp below.
    expect(h.savedBspSize).toBe(36735656);
  });

  it.skipIf(!hasNav)("calls a mesh fresh when it matches its map", () => {
    const r = checkNavFreshness(CONSTRUCT_NAV, CONSTRUCT_BSP);
    expect(r.actualBspSize).toBe(r.savedBspSize);
    expect(r.verdict).toBe("fresh");
  });

  it.skipIf(!hasNav)("calls a mesh stale when the map has changed under it", () => {
    // The negative control, and the whole point of the tool: a stale nav is invisible
    // in game except as Nextbots that refuse to path, with a silent console. A checker
    // that always answered "fresh" would look identical on every map that is fine.
    const nav = join(scratch, "changed.nav");
    const bsp = join(scratch, "changed.bsp");
    copyFileSync(CONSTRUCT_NAV, nav);
    writeFileSync(bsp, Buffer.alloc(1024)); // a map of a different size
    const r = checkNavFreshness(nav, bsp);
    expect(r.matchesBsp).toBe(false);
    expect(r.verdict).toBe("stale");
  });

  it.skipIf(!hasNav)("says it cannot tell when there is no map to compare", () => {
    const r = checkNavFreshness(CONSTRUCT_NAV, null);
    expect(r.verdict).toBe("unknown");
    expect(r.matchesBsp).toBeNull();
  });

  it("refuses a file that is not a nav mesh", () => {
    const bogus = join(scratch, "bogus.nav");
    writeFileSync(bogus, Buffer.from("not a nav file at all"));
    expect(() => readNavHeader(bogus)).toThrow(NavFormatError);
    expect(() => readNavHeader(bogus)).toThrow(/0xFEEDFACE/);
  });
});

describe("read_nav", () => {
  it.skipIf(!hasNav)("accepts the .bsp and finds the mesh beside it", async () => {
    const out = (await readNav.handler({ path: CONSTRUCT_BSP }, ctx)) as {
      verdict: string;
      areaCount: number | null;
    };
    expect(out.verdict).toBe("fresh");
    // Indicative rather than proven, and the tool's own docs say so.
    expect(out.areaCount).toBeGreaterThan(0);
    expect(() => z.object(readNav.outputSchema!).parse(out)).not.toThrow();
  });
});
