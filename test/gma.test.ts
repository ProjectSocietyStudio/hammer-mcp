import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { GmaFormatError, readGma, readGmaEntry } from "../src/gma/read.js";
import type { ToolContext } from "../src/mcp/registry.js";
import { readGmaTool, runGmaExtractTool } from "../src/tools/gma.js";
import { config, ctx as sharedCtx } from "./support/env.js";

const ctx = sharedCtx as unknown as ToolContext;
const scratch = mkdtempSync(join(tmpdir(), "hammer-gma-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Writes a valid .gma, so the reader is checked against bytes this file chose. */
function buildGma(
  files: Array<{ path: string; body: string }>,
  options: { magic?: string; version?: number; truncateBy?: number } = {},
): string {
  const cstr = (s: string): Buffer => Buffer.concat([Buffer.from(s, "utf8"), Buffer.from([0])]);
  const parts: Buffer[] = [Buffer.from(options.magic ?? "GMAD", "ascii")];
  parts.push(Buffer.from([options.version ?? 3]));

  const steam = Buffer.alloc(8);
  steam.writeBigUInt64LE(76561198000000000n);
  parts.push(steam);
  const stamp = Buffer.alloc(8);
  stamp.writeBigUInt64LE(1700000000n);
  parts.push(stamp);

  // Version > 1 carries a required-content list, ended by an empty string.
  parts.push(cstr("cstrike"), cstr(""));
  parts.push(cstr("Test Addon"), cstr("A description"), cstr("An Author"));
  const addonVersion = Buffer.alloc(4);
  addonVersion.writeInt32LE(1);
  parts.push(addonVersion);

  files.forEach((f, i) => {
    const num = Buffer.alloc(4);
    num.writeUInt32LE(i + 1);
    const size = Buffer.alloc(8);
    size.writeBigInt64LE(BigInt(Buffer.byteLength(f.body)));
    const crc = Buffer.alloc(4);
    crc.writeUInt32LE(0);
    parts.push(num, cstr(f.path), size, crc);
  });
  const end = Buffer.alloc(4);
  end.writeUInt32LE(0);
  parts.push(end);

  for (const f of files) parts.push(Buffer.from(f.body, "utf8"));

  let out = Buffer.concat(parts);
  if (options.truncateBy) out = out.subarray(0, out.length - options.truncateBy);
  const path = join(scratch, `built-${Math.abs(hash(JSON.stringify([files, options])))}.gma`);
  writeFileSync(path, out);
  return path;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

const SAMPLE = [
  { path: "maps/rp_test.bsp", body: "not really a bsp, but the right length" },
  { path: "materials/test/one.vmt", body: "vmt one" },
  { path: "materials/test/two.vmt", body: "vmt two" },
];

describe("readGma", () => {
  it("reads the header, the index, and every offset", () => {
    const archive = readGma(buildGma(SAMPLE));
    expect(archive.name).toBe("Test Addon");
    expect(archive.author).toBe("An Author");
    expect(archive.description).toBe("A description");
    expect(archive.version).toBe(3);
    expect(archive.requiredContent).toEqual(["cstrike"]);
    expect(archive.entries.map((e) => e.path)).toEqual(SAMPLE.map((f) => f.path));
    expect(archive.contentBytes).toBe(
      SAMPLE.reduce((t, f) => t + Buffer.byteLength(f.body), 0),
    );
    expect(archive.fileBytes).toBeGreaterThan(archive.contentBytes);
  });

  it("computes offsets that actually address the right bytes", () => {
    // The point of the format: bodies are concatenated with no padding, so an offset is
    // the sum of the sizes before it. If that arithmetic is off by one, every extraction
    // is silently shifted -- which is why this reads each body back rather than trusting
    // the numbers.
    const archive = readGma(buildGma(SAMPLE));
    for (let i = 0; i < SAMPLE.length; i++) {
      expect(readGmaEntry(archive, archive.entries[i]!).toString("utf8")).toBe(SAMPLE[i]!.body);
    }
  });

  it("refuses anything that is not a plain GMAD archive", () => {
    expect(() => readGma(buildGma(SAMPLE, { magic: "LZMA" }))).toThrow(GmaFormatError);
    expect(() => readGma(buildGma(SAMPLE, { magic: "LZMA" }))).toThrow(/not GMAD/);
  });

  it("refuses a truncated archive instead of extracting short files", () => {
    expect(() => readGma(buildGma(SAMPLE, { truncateBy: 10 }))).toThrow(/truncated/);
  });

  it("reads a version 1 archive, which carries no required-content list", () => {
    // Not hypothetical: the field only exists from version 2, so a reader that always
    // consumes it desynchronises on every older archive and reports nonsense names.
    const path = buildGma(SAMPLE, { version: 1 });
    const raw = readFileSync(path);
    // Strip the two required-content strings a version 3 header carries.
    const cut = Buffer.concat([raw.subarray(0, 21), raw.subarray(21 + "cstrike".length + 2)]);
    const v1 = join(scratch, "v1.gma");
    writeFileSync(v1, cut);
    const archive = readGma(v1);
    expect(archive.version).toBe(1);
    expect(archive.requiredContent).toEqual([]);
    expect(archive.name).toBe("Test Addon");
  });
});

describe("read_gma", () => {
  const shape = z.object(readGmaTool.outputSchema!);

  it("counts by extension and filters by match", async () => {
    const path = buildGma(SAMPLE);
    const all = shape.parse(await readGmaTool.handler({ path }, ctx));
    expect(all.entryCount).toBe(3);
    expect(all.byExtension).toEqual({ bsp: 1, vmt: 2 });

    const maps = shape.parse(await readGmaTool.handler({ path, match: ".bsp" }, ctx));
    expect(maps.matched).toBe(1);
    expect(maps.entries[0]!.path).toBe("maps/rp_test.bsp");
    // The full inventory stays visible even when the list is filtered.
    expect(maps.entryCount).toBe(3);
  });

  it("says it truncated rather than quietly returning a short list", async () => {
    const out = shape.parse(await readGmaTool.handler({ path: buildGma(SAMPLE), limit: 1 }, ctx));
    expect(out.returned).toBe(1);
    expect(out.truncated).toBe(true);
    expect(out.matched).toBe(3);
  });
});

describe("run_gma_extract", () => {
  const shape = z.object(runGmaExtractTool.outputSchema!);

  it("extracts only what matches, by offset", async () => {
    const destination = join(scratch, "out");
    const out = shape.parse(
      await runGmaExtractTool.handler(
        { path: buildGma(SAMPLE), match: ".bsp", destination, confirm: true },
        ctx,
      ),
    );
    expect(out.extracted).toHaveLength(1);
    expect(readFileSync(out.extracted[0]!.wroteTo, "utf8")).toBe(SAMPLE[0]!.body);
    expect(existsSync(join(destination, "materials"))).toBe(false);
  });

  it("flattens when asked", async () => {
    const destination = join(scratch, "flat");
    const out = shape.parse(
      await runGmaExtractTool.handler(
        { path: buildGma(SAMPLE), match: ".bsp", destination, flatten: true, confirm: true },
        ctx,
      ),
    );
    expect(out.extracted[0]!.wroteTo).toBe(join(destination, "rp_test.bsp"));
  });

  it("refuses a path that would escape the destination", async () => {
    // An archive is untrusted input, and nothing stops one naming `../../somewhere`.
    const evil = buildGma([{ path: "../../escaped.txt", body: "no" }]);
    expect(() =>
      runGmaExtractTool.handler(
        { path: evil, match: "escaped", destination: join(scratch, "safe"), confirm: true },
        ctx,
      ),
    ).toThrow(/outside the destination/);
  });

  it("refuses a match that would unpack too much, and one that matches nothing", async () => {
    const path = buildGma(SAMPLE);
    expect(() =>
      runGmaExtractTool.handler(
        { path, match: ".", destination: join(scratch, "many"), limit: 2, confirm: true },
        ctx,
      ),
    ).toThrow(/over the limit/);
    expect(() =>
      runGmaExtractTool.handler(
        { path, match: "nothing-like-this", destination: join(scratch, "none"), confirm: true },
        ctx,
      ),
    ).toThrow(/nothing in/);
  });
});

/** The Workshop archives on this machine, if any. The reader's real corpus. */
const WORKSHOP = join(config.gmodGameDir, "..", "..", "..", "workshop", "content", "4000");
function workshopArchives(): string[] {
  if (!existsSync(WORKSHOP)) return [];
  const out: string[] = [];
  for (const dir of readdirSync(WORKSHOP)) {
    const full = join(WORKSHOP, dir);
    try {
      for (const f of readdirSync(full)) if (f.endsWith(".gma")) out.push(join(full, f));
    } catch {
      // A directory that cannot be listed is not an archive; nothing to report.
    }
  }
  return out;
}

describe("against real Workshop archives", () => {
  const archives = workshopArchives();

  it.skipIf(archives.length === 0)("reads every one on this machine without a failure", () => {
    let withMaps = 0;
    for (const path of archives) {
      const archive = readGma(path);
      expect(archive.entries.length, path).toBeGreaterThan(0);
      // The index must describe no more than the file holds, on every one of them.
      const last = archive.entries[archive.entries.length - 1]!;
      expect(last.offset + last.size, path).toBeLessThanOrEqual(archive.fileBytes);
      if (archive.entries.some((e) => e.path.endsWith(".bsp"))) withMaps++;
    }
    // Measured 11/08/2026: 56 archives on this machine, 7 of them carrying a map, the
    // largest 1143 MB and the busiest 6521 entries. Read in full, index only.
    expect(withMaps).toBeGreaterThan(0);
  });
});
