/**
 * Whether the server can tell it is running an older build than the source beside it.
 *
 * This is not a hypothetical. On 13/08/2026 the declared server was a `dist/` from 01:29
 * and the sources were from 03:19: twelve tools -- the whole spatial wave -- were simply
 * not there. Every symptom pointed elsewhere. `health`, whose own description says "start
 * here when a tool reports something missing", had nothing to say about it.
 *
 * The mtime comparison lives in its own function so it can be tested against directories
 * whose timestamps this file sets, rather than against the repository's own build state,
 * which changes under the suite.
 */
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFreshness, newestMtime } from "../src/version.js";

/** Seconds since the epoch, so `utimesSync` and the assertions speak the same units. */
function stamp(dir: string, name: string, seconds: number): string {
  const path = join(dir, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x");
  utimesSync(path, seconds, seconds);
  return path;
}

function tree(): { root: string; dist: string; src: string } {
  const root = mkdtempSync(join(tmpdir(), "hmcp-fresh-"));
  const dist = join(root, "dist");
  const src = join(root, "src");
  mkdirSync(dist, { recursive: true });
  mkdirSync(src, { recursive: true });
  return { root, dist, src };
}

describe("newestMtime", () => {
  it("finds the newest file anywhere below the directory", () => {
    const { src } = tree();
    stamp(src, "a.ts", 1000);
    stamp(src, "deep/b.ts", 5000);
    stamp(src, "deep/c.ts", 3000);
    expect(newestMtime(src)).toBe(5000 * 1000);
  });

  it("is null for a directory that is not there", () => {
    const { root } = tree();
    expect(newestMtime(join(root, "absent"))).toBeNull();
  });
});

describe("buildFreshness", () => {
  it("calls a build older than its source stale", () => {
    const { dist, src } = tree();
    stamp(dist, "index.js", 1000);
    stamp(src, "index.ts", 2000);

    const f = buildFreshness(dist, src);
    expect(f.stale).toBe(true);
    expect(f.builtAt).toBe(new Date(1000 * 1000).toISOString());
    expect(f.sourceAt).toBe(new Date(2000 * 1000).toISOString());
    // The note has to name the fix, including the half a rebuild does not do: an MCP
    // client holds the tool list from the moment it connected.
    expect(f.note).toMatch(/pnpm build/);
    expect(f.note).toMatch(/reconnect/i);
  });

  it("calls a build newer than its source fresh", () => {
    const { dist, src } = tree();
    stamp(dist, "index.js", 9000);
    stamp(src, "index.ts", 2000);
    expect(buildFreshness(dist, src).stale).toBe(false);
  });

  /**
   * An installed copy has no `src/` beside its `dist/`. Answering "fresh" there would be a
   * confident claim about something that was never checked, which this repository treats as
   * worse than an admitted gap.
   */
  it("answers null, not false, when there is no source tree to compare against", () => {
    const { root, dist } = tree();
    stamp(dist, "index.js", 9000);
    const f = buildFreshness(dist, join(root, "no-src"));
    expect(f.stale).toBeNull();
    expect(f.sourceAt).toBeNull();
    expect(f.note).toMatch(/no source tree/i);
  });
});
