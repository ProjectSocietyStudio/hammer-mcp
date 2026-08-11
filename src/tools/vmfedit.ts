import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { applyVmfOps } from "../vmf/edit.js";
import type { VmfOp } from "../vmf/edit.js";
import { CONFIRM, resolveInput } from "./paths.js";

const MATCH = z
  .object({
    id: z.number().int().optional().describe("Hammer's own id, shown in its entity report."),
    index: z.number().int().optional().describe("Position among entity blocks, 0-based."),
    classname: z.string().optional(),
    targetname: z.string().optional(),
  })
  .describe(
    "Which entities to act on. Every given field must match. Prefer id: it survives an " +
      "edit that adds or removes entities, where index does not.",
  );

const OP = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    keyvalues: z
      .record(z.string())
      .describe("Must include classname. id is assigned here, never passed in."),
  }),
  z.object({
    op: z.literal("update"),
    match: MATCH,
    set: z.record(z.string()).optional(),
    unset: z.array(z.string()).optional(),
  }),
  z.object({ op: z.literal("remove"), match: MATCH }),
  z.object({
    op: z.literal("addOutput"),
    match: MATCH,
    output: z.string().describe("Output name, e.g. OnTrigger."),
    value: z
      .string()
      .describe("target,input,parameter,delay,timesToFire -- comma-separated, as Hammer writes it."),
  }),
  z.object({
    op: z.literal("removeOutput"),
    match: MATCH,
    output: z.string(),
    valueContains: z
      .string()
      .optional()
      .describe("Only remove outputs whose value contains this, e.g. a target name."),
  }),
]);

export const editVmf = defineTool({
  name: "edit_vmf",
  description:
    "Edits a .vmf in place by splicing byte ranges of the original file: everything not " +
    "touched stays byte-identical, so a one-entity change is a one-entity diff. Adds, " +
    "updates and removes entities, and adds or removes their outputs. Never reserialises " +
    "the file: comments, blank lines and hand-written indentation would be lost silently. " +
    "Cannot create brush geometry: choosing planes and texture axes without a visual check " +
    "produces maps that compile and are wrong. Run read_vmf_lint after editing.",
  realm: "map",
  guarded: true,
  /**
   * A mapper's source file is usually the only copy of days of work. `guarded` refuses the
   * call without `confirm:true`, but that gate is ours and an agent satisfies it by itself;
   * this asks the client for a human as well.
   */
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    ops: z.array(OP).min(1),
    dryRun: z
      .boolean()
      .default(false)
      .describe("Compute the result and report it without writing anything."),
    backup: z
      .boolean()
      .default(true)
      .describe("Write <file>.bak beside the map before changing it."),
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    dryRun: z.boolean(),
    written: z.boolean(),
    backupPath: z.string().nullable(),
    unchanged: z
      .boolean()
      .describe("True when the ops produced the exact same bytes. Nothing is written then."),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    entitiesBefore: z.number(),
    entitiesAfter: z.number(),
    outcomes: z.array(
      z.object({
        op: z.string(),
        matched: z.number(),
        ids: z.array(z.number().nullable()),
        warnings: z.array(z.string()),
      }),
    ),
    warnings: z.array(z.string()),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    if (!existsSync(path)) throw new Error(`${path} does not exist`);
    if (!args.dryRun) assertWritable(path, ctx.config);

    const before = readFileSync(path, "utf8");
    const result = applyVmfOps(before, args.ops as unknown as VmfOp[]);

    // An op list that changes nothing writes nothing -- including no backup. Rewriting a
    // file with identical bytes still moves its mtime, and a mapper's build tooling
    // watches mtimes.
    const shouldWrite = !args.dryRun && !result.unchanged;
    let backupPath: string | null = null;
    if (shouldWrite && args.backup) {
      backupPath = `${path}.bak`;
      assertWritable(backupPath, ctx.config);
      copyFileSync(path, backupPath);
    }
    if (shouldWrite) writeFileSync(path, result.text, "utf8");

    ctx.audit.record({
      kind: "vmf_edit",
      data: {
        path,
        ops: args.ops.length,
        written: shouldWrite,
        entitiesBefore: result.entitiesBefore,
        entitiesAfter: result.entitiesAfter,
      },
    });

    return {
      path,
      dryRun: args.dryRun,
      written: shouldWrite,
      backupPath,
      unchanged: result.unchanged,
      bytesBefore: Buffer.byteLength(before),
      bytesAfter: Buffer.byteLength(result.text),
      entitiesBefore: result.entitiesBefore,
      entitiesAfter: result.entitiesAfter,
      outcomes: result.outcomes,
      warnings: result.warnings,
      note:
        "Untouched bytes are preserved exactly. Run read_vmf_lint on the result before " +
        "compiling: this tool checks the file's shape, not whether the keyvalues it wrote " +
        "are ones the class accepts -- read_fgd_class answers that.",
    };
  },
});

export const vmfEditTools = [editVmf];
