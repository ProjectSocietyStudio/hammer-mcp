import { z } from "zod";
import { BUILTIN_PROFILES, findProfile, reportMap } from "../report/budget.js";
import { defineTool } from "../mcp/registry.js";
import { resolveInput } from "./paths.js";

const Criterion = z.object({
  id: z.string(),
  what: z.string(),
  verdict: z.enum(["pass", "warn", "fail", "skipped"]),
  value: z.number().nullable(),
  unit: z.string(),
  warnAt: z.number().nullable(),
  failAt: z.number().nullable(),
  direction: z.enum(["over", "under"]),
  message: z.string(),
});

export const readMapReportTool = defineTool({
  name: "read_map_report",
  description:
    "Judges a compiled map against a budget profile and returns a verdict per criterion, " +
    "not just numbers. This is the tool that gives an agent a stopping condition: every " +
    "other reader here answers 'how much', this one answers 'is that enough'. Covers lump " +
    "fill against vbsp's ceilings, entity count against the edict budget, LIGHTING against " +
    "MAX_MAP_LIGHTING, whether vvis ran at all, how finely the world is split, and whether " +
    "cubemaps and HDR exist. Limits come from Valve's headers; thresholds come from the " +
    "profile and each one states its own provenance, including when it was simply chosen. " +
    "A criterion nothing calibrates reports 'skipped' with the reason rather than a " +
    "confident verdict about nothing.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    profile: z
      .string()
      .optional()
      .describe(
        "Budget profile id. 'source-stock' (default) asks only whether the map will " +
          "compile and load. 'gmod-darkrp' adds what a live DarkRP city needs.",
      ),
    verdicts: z
      .array(z.enum(["pass", "warn", "fail", "skipped"]))
      .optional()
      .describe("Return only these verdicts. Omit for all of them."),
  },
  outputSchema: {
    path: z.string(),
    profile: z.object({ id: z.string(), description: z.string() }),
    overall: z.enum(["pass", "warn", "fail", "skipped"]),
    summary: z.object({
      pass: z.number(),
      warn: z.number(),
      fail: z.number(),
      skipped: z.number(),
    }),
    criteria: z.array(Criterion),
    /** Set when `verdicts` hid some criteria, so a short list never reads as a short map. */
    filteredOut: z.number().optional(),
  },
  handler: (args, ctx) => {
    const id = args.profile ?? "source-stock";
    const profile = findProfile(id);
    if (!profile) {
      // Never fall back to the default: a source-stock answer returned to someone who
      // asked for gmod-darkrp looks exactly like a correct one.
      throw new Error(
        `unknown budget profile ${JSON.stringify(id)}; known: ` +
          BUILTIN_PROFILES.map((p) => p.id).join(", "),
      );
    }

    const report = reportMap(resolveInput(args.path, ctx.config), profile);
    const wanted = args.verdicts;
    const criteria = wanted ? report.criteria.filter((c) => wanted.includes(c.verdict)) : report.criteria;

    return {
      path: report.path,
      profile: report.profile,
      overall: report.overall,
      summary: report.summary,
      criteria,
      ...(criteria.length === report.criteria.length
        ? {}
        : { filteredOut: report.criteria.length - criteria.length }),
    };
  },
});

export const reportTools = [readMapReportTool];
