import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { checkRules } from "../rules/check.js";
import { CHECKS, parseRules, RULES_VERSION, rulesPathFor } from "../rules/schema.js";
import { buildScene } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import type { Vec3 } from "../vmf/solid.js";
import { resolveInput } from "./paths.js";

const cache = new Map<string, { source: string; scene: Scene }>();

function sceneFor(path: string): { scene: Scene; source: string } {
  const source = readFileSync(path, "utf8");
  const hit = cache.get(path);
  if (hit && hit.source === source) return { scene: hit.scene, source };
  const scene = buildScene(path, source);
  cache.set(path, { source, scene });
  return { scene, source };
}

export const checkVmfRulesTool = defineTool({
  name: "check_vmf_rules",
  description:
    "Checks a .vmf against ITS OWN rules file -- `<map>.rules.json`, a sibling of the .vmf. " +
    "'Four metres of pavement, no entrance obstructed, the view from the lobby preserved' is " +
    "a design brief, and this is the form of it a machine can check. Per map and never " +
    "global: a residential street and a warehouse have different right answers for every " +
    "number, and a shared default would be wrong for both while looking authoritative. No " +
    "rules file means NO checking, not checking against something reasonable. It REPORTS: " +
    "the writing tools do not consult it and must not, because a mapper may want a narrow " +
    "alley. Every violation carries the worst point, so render_vmf_view or render_vmf_plan " +
    "can be pointed straight at it.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    rulesPath: z
      .string()
      .optional()
      .describe("Override the sibling file. There is no search up the directory tree."),
    severity: z
      .enum(["error", "warning", "info", "all"])
      .default("all")
      .describe("Report only violations at least this severe."),
    seeds: z
      .array(z.array(z.number()).length(3))
      .optional()
      .describe("Points inside the map, for rules about rooms. Default: the spawn entities."),
    step: z.number().int().min(4).max(128).default(16),
    maxCells: z.number().int().min(1000).max(64_000_000).default(4_000_000),
    limit: z.number().int().min(1).max(500).default(100),
  },
  outputSchema: {
    path: z.string(),
    rulesPath: z.string(),
    rulesFound: z.boolean(),
    rulesChecked: z.number(),
    matchedNothing: z.array(z.string()),
    errorCount: z.number(),
    warningCount: z.number(),
    reported: z.number(),
    violations: z.array(
      z.object({
        ruleId: z.string(),
        severity: z.string(),
        what: z.string(),
        subject: z.string(),
        required: z.string(),
        measured: z.number().nullable(),
        at: z.array(z.number()).nullable(),
        message: z.string(),
        note: z.string().optional(),
      }),
    ),
    notes: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const rulesPath = args.rulesPath ? resolveInput(args.rulesPath, ctx.config) : rulesPathFor(path);

    if (!existsSync(rulesPath)) {
      // Not an error. A map without rules is the normal case, and inventing a bar to judge
      // it against would be worse than saying nothing.
      return {
        path,
        rulesPath,
        rulesFound: false,
        rulesChecked: 0,
        matchedNothing: [],
        errorCount: 0,
        warningCount: 0,
        reported: 0,
        violations: [],
        notes: [
          `No rules file at ${rulesPath}, so nothing was checked. That is the honest answer: ` +
            `there is no built-in bar, because the right width for a corridor depends on ` +
            `what the map is. Write one as JSON with {"version": ${RULES_VERSION}, "rules": ` +
            `[...]}; the checks available are ${CHECKS.join(", ")}.`,
        ],
      };
    }

    const file = parseRules(readFileSync(rulesPath, "utf8"), rulesPath);
    const { scene, source } = sceneFor(path);
    const report = checkRules(scene, source, file, {
      step: args.step,
      maxCells: args.maxCells,
      seeds: args.seeds as Vec3[] | undefined,
    });

    const order = { error: 0, warning: 1, info: 2 } as const;
    const wanted =
      args.severity === "all"
        ? report.violations
        : report.violations.filter(
            (v) => order[v.severity] <= order[args.severity as "error" | "warning" | "info"],
          );
    const sorted = [...wanted].sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      path,
      rulesPath,
      rulesFound: true,
      rulesChecked: report.checked,
      matchedNothing: report.matchedNothing,
      errorCount: report.errorCount,
      warningCount: report.warningCount,
      reported: Math.min(sorted.length, args.limit),
      violations: sorted.slice(0, args.limit).map((v) => ({
        ruleId: v.ruleId,
        severity: v.severity,
        what: v.what,
        subject: v.subject,
        required: v.required,
        measured: v.measured,
        at: v.at ? [...v.at] : null,
        message: v.message,
        ...(v.note === undefined ? {} : { note: v.note }),
      })),
      notes: report.notes,
    };
  },
});

export const rulesTools = [checkVmfRulesTool];
