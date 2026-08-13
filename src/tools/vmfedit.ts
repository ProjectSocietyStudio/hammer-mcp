import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { applyVmfOps } from "../vmf/edit.js";
import type { VmfOp } from "../vmf/edit.js";
import { DEFAULT_GRID, DEFAULT_SKYNAME, emptyVmf } from "../vmf/skeleton.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

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
    "Does not create brush geometry -- that is write_vmf_solid, which has the checks that " +
    "job needs. Run read_vmf_lint after editing.",
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
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    dryRun: z.boolean(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
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

    const before = readFileSync(path, "utf8");
    const result = applyVmfOps(before, args.ops as unknown as VmfOp[]);

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });
    const shouldWrite = write.written;
    const backupPath = write.backupPath;

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
      // `?? false`, and not for tidiness. `dryRun` is optional with no default, so a
      // caller who simply leaves it out hands the handler `undefined` -- while this
      // tool's output schema declares `dryRun` a required boolean. The SDK validates
      // the result and turns the whole call into `Output validation error: Required at
      // dryRun`, *after* the file has been written. The error is survivable; the retry
      // it invites is not, because it applies every operation a second time.
      dryRun: args.dryRun ?? false,
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

export const writeVmf = defineTool({
  name: "write_vmf",
  description:
    "Creates an empty .vmf: Hammer's File > New. The map every other writer here assumes " +
    "already exists -- write_vmf_solid reads its target before writing and refuses a file " +
    "with no `world` block, so neither an absent nor an empty file is a place to start. " +
    "Writes worldspawn with a skyname, because a map without one renders whatever sky the " +
    "engine loaded last. REFUSES to overwrite: a map is hours of work and this tool's whole " +
    "job is the first second of it.",
  realm: "map",
  guarded: true,
  inputSchema: {
    path: z.string().describe("Where to create the .vmf, absolute or relative to the repo root."),
    skyname: z
      .string()
      .default(DEFAULT_SKYNAME)
      .describe("worldspawn's skyname. read_game_content lists what the game has."),
    gridSpacing: z
      .number()
      .int()
      .min(1)
      .max(1024)
      .default(DEFAULT_GRID)
      .describe("The grid an editor opens the file showing. Cosmetic; nothing compiles from it."),
    dryRun: DRY_RUN,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    dryRun: z.boolean(),
    written: z.boolean(),
    bytes: z.number(),
    skyname: z.string(),
    note: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    // Refused rather than backed up. `edit_vmf` backs up because it is editing something
    // it was pointed at on purpose; this one would be replacing a map with an empty one,
    // and no flag makes that a thing a caller meant.
    if (existsSync(path)) {
      throw new Error(
        `${path} already exists. write_vmf only creates: delete the file yourself if you ` +
          `really mean to start over, or use edit_vmf and the geometry writers to change it.`,
      );
    }

    const text = emptyVmf({ skyname: args.skyname, gridSpacing: args.gridSpacing });
    const write = writeGuarded(path, text, ctx.config, { dryRun: args.dryRun });

    ctx.audit.record({
      kind: "file_write",
      data: { path, bytes: Buffer.byteLength(text), written: write.written, created: true },
    });

    return {
      path,
      dryRun: args.dryRun ?? false,
      written: write.written,
      bytes: Buffer.byteLength(text),
      skyname: args.skyname,
      note:
        "Empty: no geometry, no entities, and therefore not sealed. write_vmf_solid adds " +
        "brushes, edit_vmf adds entities, read_vmf_leak says when it holds. A map with no " +
        "info_player_start has no seed for the room pass, so read_vmf_rooms and the room " +
        "rules will report that they checked nothing.",
    };
  },
});

export const vmfEditTools = [editVmf, writeVmf];
