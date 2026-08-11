import { readFileSync } from "node:fs";
import { z } from "zod";
import { gameBlock } from "../games/resolve.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { checkWiring, entityReport, readConnections } from "../vmf/wiring.js";
import type { ClassSchema } from "../vmf/wiring.js";
import { GAME, GAME_BLOCK, resolveInput } from "./paths.js";
import { fgdContext } from "./vmf.js";

export const readEntityReportTool = defineTool({
  name: "read_entity_report",
  description:
    "Hammer's Entity Report: every entity of a .vmf with its keyvalues, filterable by " +
    "classname, targetname or the presence of a key. read_vmf counts entities by classname " +
    "and read_bsp_entities reads a compiled map; neither answers 'which entity has " +
    "spawnflags 512', which is the question the report exists for and how a mapper finds " +
    "the one door of forty that was left locked.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    classname: z.string().optional().describe("Substring, case-insensitive."),
    targetname: z.string().optional().describe("Substring, case-insensitive."),
    hasKey: z.string().optional().describe("Only entities carrying this keyvalue."),
    keyValue: z.string().optional().describe("With hasKey: the exact value it must have."),
    limit: z.number().int().min(1).max(2000).default(200),
  },
  outputSchema: {
    path: z.string(),
    matched: z.number(),
    returned: z.number(),
    entities: z.array(
      z.object({
        id: z.number().nullable(),
        index: z.number(),
        classname: z.string(),
        targetname: z.string().nullable(),
        origin: z.string().nullable(),
        keyvalues: z.record(z.string(), z.string()),
        solidCount: z.number(),
        outputCount: z.number(),
      }),
    ),
    /** Every classname in the map, with how many there are. */
    byClassname: z.record(z.string(), z.number()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const rows = entityReport(source, {
      ...(args.classname !== undefined ? { classname: args.classname } : {}),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.hasKey !== undefined ? { hasKey: args.hasKey } : {}),
      ...(args.keyValue !== undefined ? { keyValue: args.keyValue } : {}),
    });
    const all = entityReport(source);
    const byClassname: Record<string, number> = {};
    for (const e of all) byClassname[e.classname] = (byClassname[e.classname] ?? 0) + 1;

    return {
      path,
      matched: rows.length,
      returned: Math.min(rows.length, args.limit),
      entities: rows.slice(0, args.limit),
      byClassname,
    };
  },
});

export const validateIoTool = defineTool({
  name: "validate_io",
  description:
    "Checks a map's entity wiring against the game's own FGD. read_fgd_class has been able " +
    "to say what inputs a class has since the beginning and nothing has ever used it to " +
    "judge a map, so an output aimed at an entity that does not exist, or at an input its " +
    "class does not have, passes every check here and every check vbsp makes -- and then " +
    "does nothing in game. That is the quietest failure a map has. Targets the engine " +
    "resolves at runtime (!activator, !self, !player) are reported as unresolvable rather " +
    "than as broken, and a class with no FGD schema is not judged at all: absence of a " +
    "definition is not evidence of a fault. Needs the Python sidecar and the game's FGD.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    game: GAME,
    limit: z.number().int().min(1).max(500).default(100),
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string(),
    connectionCount: z.number(),
    /** Classes whose schema was loaded, so it is clear what was judged. */
    classesChecked: z.number(),
    errorCount: z.number(),
    warningCount: z.number(),
    findings: z.array(
      z.object({
        severity: z.string(),
        rule: z.string(),
        message: z.string(),
        fromId: z.number().nullable(),
        output: z.string(),
        target: z.string(),
      }),
    ),
    unresolvedTargets: z.array(z.string()),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: async (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const { game, from, binDir, fgd } = fgdContext(ctx.config, args.game);

    // Only the classes this map actually uses, and only those on either end of a wire.
    // Loading the whole FGD to judge nine connections would cost seconds and answer the
    // same question.
    const rows = entityReport(source);
    const { connections } = readConnections(source);
    const byName = new Map<string, Set<string>>();
    for (const e of rows) {
      if (!e.targetname) continue;
      const key = e.targetname.toLowerCase();
      byName.set(key, (byName.get(key) ?? new Set<string>()).add(e.classname));
    }
    const wanted = new Set<string>();
    for (const c of connections) {
      wanted.add(c.fromClassname);
      for (const cls of byName.get(c.target.toLowerCase()) ?? []) wanted.add(cls);
    }

    const schemas = new Map<string, ClassSchema>();
    for (const classname of wanted) {
      const reply = (await callSidecar(
        "fgd_class",
        { binDir, fgd, classname },
        ctx.config,
        120_000,
      )) as { inputs?: string[]; outputs?: string[] };
      if (!reply.inputs && !reply.outputs) continue;
      schemas.set(classname.toLowerCase(), {
        inputs: new Set((reply.inputs ?? []).map((s) => s.toLowerCase())),
        outputs: new Set((reply.outputs ?? []).map((s) => s.toLowerCase())),
      });
    }

    const report = checkWiring(source, schemas);
    const errors = report.findings.filter((f) => f.severity === "error");
    const warns = report.findings.filter((f) => f.severity === "warning");

    return {
      game: gameBlock(game, from),
      path,
      connectionCount: report.connections.length,
      classesChecked: schemas.size,
      errorCount: errors.length,
      warningCount: warns.length,
      findings: [...errors, ...warns].slice(0, args.limit),
      unresolvedTargets: report.unresolvedTargets,
      warnings: report.warnings,
      nextStep:
        errors.length === 0
          ? "Every wire this could judge resolves. What the map does when it runs is still " +
            "for the engine to say."
          : "Each error is a wire that fires into nothing. No compiler will mention any of " +
            "them, which is why they are here.",
    };
  },
});

export const wiringTools = [readEntityReportTool, validateIoTool];
