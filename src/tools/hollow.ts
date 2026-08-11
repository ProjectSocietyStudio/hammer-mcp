import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { insertSolids } from "../vmf/build.js";
import { hollowSolid, materialByNormal } from "../vmf/hollow.js";
import { deleteSolids } from "../vmf/modify.js";
import { isEmptySelector, matchesSolid } from "../vmf/select.js";
import type { SolidSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import type { Vec3 } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const hollowSolidsTool = defineTool({
  name: "hollow_solids",
  description:
    "Turns solid blocks into the walls of a room. Hammer has this and Hammer's version " +
    "overlaps at the corners: each wall spans its whole face, so two adjacent walls both " +
    "occupy the corner between them. This one mitres, because 'this point is nearer face i " +
    "than face j' turns out to be a plane, so each wall stays a single convex brush and no " +
    "two share a cubic unit. The check is exact: the walls must sum to the outer volume " +
    "less the room inside, and the tool refuses to write if they do not. Each wall keeps " +
    "the material the source brush had on that face; the inner surface and the mitres take " +
    "innerMaterial, which defaults to nodraw so a hollowed block does not become a room " +
    "with brick on the outside of its own walls.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Hammer ids of the brushes to hollow."),
    owner: z.string().optional().describe("'world', or a brush entity classname."),
    material: z.string().optional().describe("Brushes carrying this on at least one face."),
    within: z.object({ mins: Vec, maxs: Vec }).optional(),
    thickness: z.number().describe("Wall thickness, in Hammer units."),
    direction: z
      .enum(["in", "out"])
      .default("in")
      .describe("'in' keeps the outer surface where it was; 'out' keeps the inner one."),
    innerMaterial: z
      .string()
      .optional()
      .describe("Material for the faces hollowing created. Default TOOLS/TOOLSNODRAW."),
    keepSource: z
      .boolean()
      .optional()
      .describe(
        "Leave the original brush in place. Default false, because a block left inside " +
          "its own walls is still a solid block.",
      ),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    matched: z.number(),
    hollowed: z.array(
      z.object({
        id: z.number(),
        walls: z.number(),
        outerVolume: z.number(),
        innerVolume: z.number(),
        shellVolume: z.number(),
      }),
    ),
    solidsBefore: z.number(),
    solidsAfter: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");

    const selector: SolidSelector = {
      ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
      ...(args.within !== undefined
        ? { within: { mins: args.within.mins as Vec3, maxs: args.within.maxs as Vec3 } }
        : {}),
    };
    if (isEmptySelector(selector)) {
      throw new Error(
        "refusing an empty selector: it would hollow every brush in the map. Name ids, an " +
          "owner, a material or a bounding box.",
      );
    }

    const beforeReport = checkVmfSolids(path, before);
    const wanted = beforeReport.solids.filter((s) => matchesSolid(s, selector));
    if (wanted.length === 0) {
      return {
        path,
        written: false,
        backupPath: null,
        unchanged: true,
        matched: 0,
        hollowed: [],
        solidsBefore: beforeReport.solidCount,
        solidsAfter: beforeReport.solidCount,
        warnings: ["nothing matched the selector, so nothing was hollowed"],
        nextStep: "read_vmf_solids lists the ids this map has.",
      };
    }

    const inner = args.innerMaterial ?? "TOOLS/TOOLSNODRAW";
    const warnings: string[] = [];
    const hollowed: Array<{
      id: number;
      walls: number;
      outerVolume: number;
      innerVolume: number;
      shellVolume: number;
    }> = [];

    let text = before;
    for (const solid of wanted) {
      const result = hollowSolid(solid, {
        thickness: args.thickness,
        direction: args.direction,
      });
      warnings.push(...result.warnings);

      // The exact check, before anything is written. A mitre computed with the wrong sign
      // does not give a slightly wrong shell -- it gives walls that overlap or a gap.
      const expected = result.outerVolume - result.innerVolume;
      const drift = Math.abs(result.shellVolume - expected) / Math.max(expected, 1);
      if (drift > 1e-4) {
        throw new Error(
          `refusing to write: hollowing solid ${solid.id} produced walls totalling ` +
            `${Math.round(result.shellVolume)} where the shell is ` +
            `${Math.round(expected)} cubic units. The walls overlap or leave a gap.`,
        );
      }

      const faceMaterials = solid.sides
        .filter((s) => s.plane !== null)
        .map((s) => ({ normal: s.plane!.normal, material: s.material }));
      const inserted = insertSolids(
        text,
        result.walls.map((w) => w.spec),
        {
          material: inner,
          materialForFace: materialByNormal(faceMaterials, inner),
          ...(solid.owner !== "world" ? {} : {}),
        },
      );
      text = inserted.text;
      hollowed.push({
        id: solid.id ?? -1,
        walls: result.walls.length,
        outerVolume: result.outerVolume,
        innerVolume: result.innerVolume,
        shellVolume: result.shellVolume,
      });
    }

    if (args.keepSource !== true) {
      const removed = deleteSolids(text, { ids: wanted.map((s) => s.id!).filter(Boolean) });
      text = removed.text;
      warnings.push(...removed.warnings);
    }

    // Every wall must be a brush the independent checker accepts.
    const afterReport = checkVmfSolids(path, text);
    const bad = afterReport.solids.filter((s) => !s.valid);
    if (bad.length > 0) {
      throw new Error(
        `refusing to write: ${bad.length} of the walls this produced are not valid brushes. ` +
          bad
            .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
            .join(" | "),
      );
    }

    const write = writeGuarded(path, text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: text === before,
    });

    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: text === before,
      matched: wanted.length,
      hollowed,
      solidsBefore: beforeReport.solidCount,
      solidsAfter: afterReport.solidCount,
      warnings,
      nextStep:
        "A hollowed block is a room, and a room is only sealed if its walls are thick " +
        "enough and nothing else opens it. Compile and read_leak.",
    };
  },
});

export const hollowTools = [hollowSolidsTool];
