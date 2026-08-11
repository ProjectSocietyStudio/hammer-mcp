import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { LUMP_SPECS } from "../bsp/geometry.js";
import { luaEntityClasses } from "../lua/entities.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

const FINDING = z.object({
  severity: z.string(),
  rule: z.string(),
  message: z.string(),
  entity_id: z.number().optional(),
  entity_ids: z.array(z.number()).optional(),
  brush_id: z.number().optional(),
  side_id: z.number().optional(),
  classname: z.string().optional(),
  key: z.string().optional(),
  output: z.string().optional(),
  input: z.string().optional(),
  target: z.string().optional(),
  scale: z.number().optional(),
});

/**
 * The FGDs to check a map against, as paths relative to `gmodBin`.
 *
 * The game's own is always there. The Hammer++ compilers add five classes of their own --
 * `func_detail_illusionary`, `func_detail_blocker`, `func_nobevel`, `light_directional`,
 * `light_projected` -- and without their FGD a map that uses them gets an
 * `unknown-classname` for each, which is the same false positive the repo's Lua classes
 * once produced.
 *
 * Included only when the file is really there, and always reported back as `fgdsLoaded`:
 * a schema that silently widens is a lint that silently stops catching things.
 *
 * `hammerplusplus_fgd.fgd`, shipped with the editor, is deliberately not here. It mostly
 * redeclares existing classes to add editor helpers, so merging it would change the
 * accepted keyvalues of entities the game already defines.
 */
const OPTIONAL_FGDS = ["win64/toolsplusplus.fgd"];

function fgdNames(config: { gmodBin: string }): string[] {
  return [
    "garrysmod.fgd",
    ...OPTIONAL_FGDS.filter((rel) => existsSync(join(config.gmodBin, rel))),
  ];
}

const COUNTS = z.object({
  entities: z.number(),
  brushes: z.number(),
  worldBrushes: z.number(),
  entityBrushes: z.number(),
  brushSides: z.number(),
  displacements: z.number(),
});

export const readFgdClass = defineTool({
  name: "read_fgd_class",
  description:
    "What the game's own FGD declares for an entity class: every keyvalue with its type " +
    "and default, every input, every output. This is the schema Hammer enforces, so it " +
    "answers 'does this class accept that key' without guessing from the wiki. Called " +
    "with no classname it lists the classes, optionally filtered by prefix. Reads " +
    "garrysmod.fgd from the GMod install, not a generic multi-game database. Needs the " +
    "Python sidecar and the GMod bin directory; see health.",
  realm: "map",
  inputSchema: {
    classname: z.string().optional().describe("Exact class, e.g. logic_relay."),
    prefix: z.string().optional().describe("When listing: keep classes starting with this."),
    limit: z.number().int().min(1).max(2000).default(200),
  },
  outputSchema: {
    classCount: z.number(),
    toleratedHelpers: z.record(z.number()),
    classname: z.string().optional(),
    type: z.string().optional(),
    description: z.string().nullable().optional(),
    keyvalues: z
      .array(
        z.object({
          name: z.string(),
          type: z.string(),
          display: z.string().nullable(),
          default: z.string().nullable(),
          choices: z.array(z.array(z.string())).optional(),
        }),
      )
      .optional(),
    inputs: z.array(z.string()).optional(),
    outputs: z.array(z.string()).optional(),
    classnames: z.array(z.string()).optional(),
    matched: z.number().optional(),
    returned: z.number().optional(),
  },
  handler: async (args, ctx) =>
    callSidecar(
      "fgd_class",
      {
        binDir: ctx.config.gmodBin,
        fgd: fgdNames(ctx.config),
        ...(args.classname ? { classname: args.classname } : {}),
        ...(args.prefix ? { prefix: args.prefix } : {}),
        limit: args.limit,
      },
      ctx.config,
      120_000,
    ),
});

export const readVmf = defineTool({
  name: "read_vmf",
  description:
    "Entities, outputs and brush counts of a .vmf, reported without judgement. Use it to " +
    "see what a map source contains; use read_vmf_lint to find what is wrong with it. " +
    "Unlike a compiled .bsp, a VMF keeps Hammer ids, so anything reported here can be " +
    "found again in the editor. Needs the Python sidecar; see health.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    classname: z.string().optional().describe("Restrict the entity list to one class."),
    limit: z.number().int().min(1).max(2000).default(200),
  },
  outputSchema: {
    path: z.string(),
    counts: COUNTS,
    histogram: z.record(z.number()),
    matched: z.number(),
    returned: z.number(),
    entities: z.array(
      z.object({
        id: z.number(),
        classname: z.string(),
        targetname: z.string().nullable(),
        origin: z.array(z.number()).nullable(),
        solidCount: z.number(),
        keyvalues: z.record(z.string()),
        outputs: z.array(
          z.object({
            output: z.string(),
            target: z.string(),
            input: z.string(),
            params: z.string(),
            delay: z.number(),
            times: z.number(),
          }),
        ),
      }),
    ),
  },
  handler: async (args, ctx) =>
    callSidecar(
      "vmf_read",
      {
        path: resolveInput(args.path, ctx.config),
        ...(args.classname ? { classname: args.classname } : {}),
        limit: args.limit,
      },
      ctx.config,
      300_000,
    ),
});

interface LintReply {
  path: string;
  counts: Record<string, number>;
  toleratedHelpers: Record<string, number>;
  fgdsLoaded: string[];
  luaClassesKnown: number;
  total: number;
  bySeverity: Record<string, number>;
  byRule: Record<string, number>;
  returned: number;
  findings: Array<Record<string, unknown>>;
}

/** VMF counts, mapped onto the compiler ceilings `read_map_geometry` already sources. */
const LIMIT_FOR = new Map(
  LUMP_SPECS.filter((s) => s.limit !== undefined).map((s) => [s.name, s]),
);

export const readVmfLint = defineTool({
  name: "read_vmf_lint",
  description:
    "Checks a .vmf against the game's FGD and against what the compilers accept, before " +
    "a compile that can take forty minutes to fail. Finds unknown classes and keyvalues, " +
    "outputs aimed at nothing, inputs a target class does not answer to, texture scales " +
    "that become 'Bad surface extents', displacements on brush entities (with the real " +
    "brush id, which vbsp does not print), and counts that approach the compiler limits. " +
    "Knows the repo's Lua-defined entities, so a scripted class is not reported as " +
    "unknown. Needs the Python sidecar and the GMod bin directory; see health.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    severity: z
      .enum(["error", "warning", "info"])
      .optional()
      .describe("Keep only findings at this severity."),
    rule: z.string().optional().describe("Keep only findings from this rule."),
    limit: z.number().int().min(1).max(2000).default(200),
  },
  outputSchema: {
    path: z.string(),
    counts: COUNTS,
    nearLimit: z.array(
      z.object({
        what: z.string(),
        count: z.number(),
        limit: z.number(),
        limitName: z.string(),
        usedFraction: z.number(),
      }),
    ),
    luaClassesKnown: z.number(),
    toleratedHelpers: z.record(z.number()),
    fgdsLoaded: z.array(z.string()),
    total: z.number(),
    bySeverity: z.record(z.number()),
    byRule: z.record(z.number()),
    matched: z.number(),
    returned: z.number(),
    findings: z.array(FINDING),
  },
  handler: async (args, ctx) => {
    const reply = await callSidecar<LintReply>(
      "vmf_lint",
      {
        path: resolveInput(args.path, ctx.config),
        binDir: ctx.config.gmodBin,
        fgd: fgdNames(ctx.config),
        luaClasses: luaEntityClasses(ctx.config),
        limit: 2000,
      },
      ctx.config,
      300_000,
    );

    // The compiler ceilings live in TypeScript, next to the ones read_map_geometry uses:
    // one source for a limit, whether it is being checked before or after a compile.
    const nearLimit: Array<{
      what: string;
      count: number;
      limit: number;
      limitName: string;
      usedFraction: number;
    }> = [];
    for (const [what, lumpName] of [
      ["entities", "ENTITIES"],
      ["brushes", "BRUSHES"],
      ["brushSides", "BRUSHSIDES"],
      ["displacements", "DISPINFO"],
    ] as const) {
      const spec = LIMIT_FOR.get(lumpName);
      const count = reply.counts[what] ?? 0;
      if (!spec?.limit) continue;
      const usedFraction = Math.round((count / spec.limit) * 1000) / 1000;
      if (usedFraction >= 0.5) {
        nearLimit.push({
          what,
          count,
          limit: spec.limit,
          limitName: spec.limitName ?? lumpName,
          usedFraction,
        });
      }
    }

    let findings = reply.findings;
    if (args.severity) findings = findings.filter((f) => f["severity"] === args.severity);
    if (args.rule) findings = findings.filter((f) => f["rule"] === args.rule);

    return {
      path: reply.path,
      counts: reply.counts,
      nearLimit,
      luaClassesKnown: reply.luaClassesKnown,
      toleratedHelpers: reply.toleratedHelpers,
      fgdsLoaded: reply.fgdsLoaded,
      total: reply.total,
      bySeverity: reply.bySeverity,
      byRule: reply.byRule,
      matched: findings.length,
      returned: Math.min(findings.length, args.limit),
      findings: findings.slice(0, args.limit),
    };
  },
});

export const vmfTools = [readFgdClass, readVmf, readVmfLint];
