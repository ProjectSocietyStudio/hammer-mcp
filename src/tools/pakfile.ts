/**
 * Getting files back out of a compiled map.
 *
 * `read_pakfile` has always said what a map carries. Nothing could take any of it out, so
 * a cubemap, a soundscript or a custom material that exists only inside a `.bsp` was
 * readable by unpacking the map by hand and no other way -- which is how this repository
 * ended up extracting one with a Python one-liner in a scratch directory on 14/08/2026,
 * to check what `cubemap2hdr` would accept.
 *
 * The extraction itself is the sidecar's, beside the listing, because both are the same
 * ZIP and two readers of one format is two answers to one question.
 */
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { CONFIRM, resolveInput } from "./paths.js";

interface ExtractReply {
  path: string;
  into: string;
  matched: number;
  written: Array<{ name: string; path: string; bytes: number }>;
  refused: Array<{ name: string; why: string }>;
  skippedOverLimit: number;
}

export const runPakfileExtract = defineTool({
  name: "run_pakfile_extract",
  description:
    "Extracts files from a compiled map's embedded pakfile (lump 40, a plain ZIP) into a " +
    "directory. read_pakfile lists what is in there; this is what gets it out -- a packed " +
    "cubemap to convert, a soundscript to read, a custom material to inspect. Refuses an " +
    "entry whose name would escape the destination rather than sanitising it, and never " +
    "overwrites unless told to. Needs the Python sidecar; see health.",
  realm: "map",
  guarded: true,
  inputSchema: {
    bsp: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    into: z.string().describe("Directory to write into. Created if it is not there."),
    pattern: z
      .string()
      .optional()
      .describe(
        "Glob over the in-map path, case-insensitive: `materials/maps/*/c*.vtf` for the " +
          "cubemaps. Absent extracts everything, up to `limit`.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .default(200)
      .describe("How many files to write. A production map packs ten thousand."),
    overwrite: z
      .boolean()
      .default(false)
      .describe("Replace files that are already there. Off by default."),
    confirm: CONFIRM,
  },
  outputSchema: {
    bsp: z.string(),
    into: z.string(),
    /** Entries the pattern matched, whether or not they were written. */
    matched: z.number(),
    written: z.array(z.object({ name: z.string(), path: z.string(), bytes: z.number() })),
    /**
     * Entries deliberately not written, each with the reason.
     *
     * Reported rather than silently dropped: "extracted 197 of 200" with no list is a
     * caller looking for three files that are not there and no way to find out why.
     */
    refused: z.array(z.object({ name: z.string(), why: z.string() })),
    skippedOverLimit: z.number(),
    count: z.number(),
    bytes: z.number(),
    note: z.string(),
  },
  handler: async (args, ctx) => {
    const bsp = resolveInput(args.bsp, ctx.config);
    const into = assertWritable(resolveInput(args.into, ctx.config), ctx.config);

    const r = await callSidecar<ExtractReply>(
      "pakfile_extract",
      {
        path: bsp,
        into,
        ...(args.pattern === undefined ? {} : { pattern: args.pattern }),
        limit: args.limit,
        overwrite: args.overwrite,
      },
      ctx.config,
      300_000,
    );

    ctx.audit.record({
      kind: "file_write",
      data: { path: into, from: bsp, written: r.written.length, created: true },
    });

    const bytes = r.written.reduce((t, f) => t + f.bytes, 0);
    return {
      bsp,
      into: r.into,
      matched: r.matched,
      written: r.written,
      refused: r.refused,
      skippedOverLimit: r.skippedOverLimit,
      count: r.written.length,
      bytes,
      note:
        `These are copies: editing one changes nothing in the map. run_pack is what puts a ` +
        `file back in, under the in-map path it should have.` +
        (r.skippedOverLimit > 0
          ? ` ${r.skippedOverLimit} more matched and were not written -- raise limit or ` +
            `narrow the pattern.`
          : ``),
    };
  },
});

export const pakfileTools = [runPakfileExtract];
