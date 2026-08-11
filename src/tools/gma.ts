import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { readGma, readGmaEntry } from "../gma/read.js";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { CONFIRM, resolveInput } from "./paths.js";

const Entry = z.object({
  path: z.string(),
  size: z.number(),
  crc: z.number(),
  offset: z.number(),
});

export const readGmaTool = defineTool({
  name: "read_gma",
  description:
    "Reads a Garry's Mod addon archive: who made it, what it contains, and where each " +
    "file sits inside it. A .gma is how the Workshop ships everything, maps included, so " +
    "without this a Workshop map has to be unpacked by hand before any tool here can look " +
    "at it. Reads the header and the index only -- never a file's contents -- so it is " +
    "instant on an archive of any size.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .gma, absolute or relative to the repo root."),
    match: z
      .string()
      .optional()
      .describe("Only entries whose path contains this, case-insensitively."),
    limit: z.number().optional().describe("Maximum entries to return. Default 200."),
  },
  outputSchema: {
    path: z.string(),
    name: z.string(),
    author: z.string(),
    description: z.string(),
    version: z.number(),
    addonVersion: z.number(),
    steamId: z.string(),
    timestamp: z.number(),
    requiredContent: z.array(z.string()),
    entryCount: z.number(),
    /** Sum of the entries. Below fileBytes: the header and index are not counted. */
    contentBytes: z.number(),
    fileBytes: z.number(),
    byExtension: z.record(z.string(), z.number()),
    matched: z.number(),
    returned: z.number(),
    truncated: z.boolean(),
    entries: z.array(Entry),
  },
  handler: (args, ctx) => {
    const archive = readGma(resolveInput(args.path, ctx.config));
    const needle = args.match?.toLowerCase();
    const matched = needle
      ? archive.entries.filter((e) => e.path.toLowerCase().includes(needle))
      : archive.entries;
    const limit = args.limit ?? 200;

    const byExtension: Record<string, number> = {};
    for (const e of archive.entries) {
      const dot = e.path.lastIndexOf(".");
      const ext = dot > 0 ? e.path.slice(dot + 1).toLowerCase() : "(none)";
      byExtension[ext] = (byExtension[ext] ?? 0) + 1;
    }

    return {
      path: archive.path,
      name: archive.name,
      author: archive.author,
      description: archive.description,
      version: archive.version,
      addonVersion: archive.addonVersion,
      steamId: archive.steamId,
      timestamp: archive.timestamp,
      requiredContent: archive.requiredContent,
      entryCount: archive.entries.length,
      contentBytes: archive.contentBytes,
      fileBytes: archive.fileBytes,
      byExtension,
      matched: matched.length,
      returned: Math.min(matched.length, limit),
      truncated: matched.length > limit,
      entries: matched.slice(0, limit),
    };
  },
});

export const runGmaExtractTool = defineTool({
  name: "run_gma_extract",
  description:
    "Extracts files from a .gma by offset, without reading the rest. `match` is required: " +
    "unpacking a gigabyte of materials to reach one .bsp is the thing this exists to " +
    "avoid. Refuses an entry whose path would escape the destination directory.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Path to the .gma."),
    match: z
      .string()
      .describe("Only entries whose path contains this, case-insensitively. Required."),
    destination: z.string().describe("Directory to write into. Created if absent."),
    flatten: z
      .boolean()
      .optional()
      .describe("Write basenames only, instead of recreating the addon's directories."),
    limit: z.number().optional().describe("Refuse to extract more than this many. Default 64."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    destination: z.string(),
    extracted: z.array(z.object({ path: z.string(), bytes: z.number(), wroteTo: z.string() })),
    totalBytes: z.number(),
    matched: z.number(),
  },
  handler: (args, ctx) => {
    const archive = readGma(resolveInput(args.path, ctx.config));
    const needle = args.match.toLowerCase();
    const matched = archive.entries.filter((e) => e.path.toLowerCase().includes(needle));
    const limit = args.limit ?? 64;
    if (matched.length === 0) {
      throw new Error(
        `nothing in ${archive.name} matches ${JSON.stringify(args.match)}. ` +
          `read_gma lists what is there.`,
      );
    }
    if (matched.length > limit) {
      throw new Error(
        `${matched.length} entries match ${JSON.stringify(args.match)}, over the limit of ` +
          `${limit}. Narrow the match, or raise the limit deliberately.`,
      );
    }

    const destination = assertWritable(resolveInput(args.destination, ctx.config), ctx.config);
    mkdirSync(destination, { recursive: true });

    const extracted: Array<{ path: string; bytes: number; wroteTo: string }> = [];
    let totalBytes = 0;
    for (const entry of matched) {
      const relative = args.flatten ? entry.path.split("/").pop()! : entry.path;
      const target = resolve(destination, relative);
      // An archive is untrusted input: a path of `../../etc/thing` inside one would
      // otherwise write wherever it liked.
      if (target !== destination && !target.startsWith(destination + "/")) {
        throw new Error(
          `refusing to extract ${JSON.stringify(entry.path)}: it resolves outside the ` +
            `destination directory.`,
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readGmaEntry(archive, entry));
      extracted.push({ path: entry.path, bytes: entry.size, wroteTo: target });
      totalBytes += entry.size;
    }

    return {
      path: archive.path,
      destination,
      extracted,
      totalBytes,
      matched: matched.length,
    };
  },
});

export const gmaTools = [readGmaTool, runGmaExtractTool];
