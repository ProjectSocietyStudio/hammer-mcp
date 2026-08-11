import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { clipSolids } from "../vmf/clip.js";
import type { SolidSelector } from "../vmf/select.js";
import { checkVmfSolids, planeFromPoints } from "../vmf/solid.js";
import type { Plane, Vec3 } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const clipSolidsTool = defineTool({
  name: "clip_solids",
  description:
    "Cuts brushes with a plane, keeping the front, the back, or both. This is Hammer's " +
    "clip tool, the most-used one in the editor and the one that unlocks every shape that " +
    "is not an assembly of boxes. A face that survives keeps its own material, texture " +
    "axes, lightmap scale and smoothing groups -- the side block is copied, not rebuilt. A " +
    "face that no longer bounds anything is dropped rather than left redundant. The new " +
    "face gets its axes from vbsp's base-axis table and inherits the material of the " +
    "largest face kept, which is what Hammer does. Keeping both halves is the check: their " +
    "volumes must sum to the original, and the tool refuses to write if they do not.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidIds: z.array(z.number()).optional().describe("Hammer ids of the brushes to cut."),
    owner: z.string().optional().describe("'world', or a brush entity classname."),
    material: z.string().optional().describe("Brushes carrying this on at least one face."),
    within: z
      .object({ mins: Vec, maxs: Vec })
      .optional()
      .describe("Brushes lying entirely inside this box."),
    plane: z
      .union([
        z.object({
          point: Vec.describe("A point the plane passes through."),
          normal: Vec.describe("Which way the plane faces. 'front' is this direction."),
        }),
        z.object({
          points: z
            .tuple([Vec, Vec, Vec])
            .describe("Three points on the plane, in the order a .vmf states a face."),
        }),
      ])
      .describe("The cutting plane, as a point and a normal or as three points."),
    keep: z
      .enum(["front", "back", "both"])
      .describe("'front' is the side the normal points towards. 'both' leaves two brushes."),
    cutMaterial: z
      .string()
      .optional()
      .describe("Material for the new face. Default: the material of the largest face kept."),
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
    solids: z.array(
      z.object({
        id: z.number(),
        owner: z.string(),
        volumeBefore: z.number(),
        volumeAfter: z.number(),
        otherId: z.number().nullable(),
        volumeOther: z.number(),
        facesDropped: z.number(),
        removed: z.boolean(),
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

    let plane: Plane;
    if ("points" in args.plane) {
      const [a, b, c] = args.plane.points as [Vec3, Vec3, Vec3];
      const p = planeFromPoints(a, b, c);
      if (!p) throw new Error("those three points are collinear, so they state no plane");
      plane = p;
    } else {
      const n = args.plane.normal as Vec3;
      const pt = args.plane.point as Vec3;
      plane = { normal: n, dist: n[0] * pt[0] + n[1] * pt[1] + n[2] * pt[2] };
    }

    const selector: SolidSelector = {
      ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
      ...(args.owner !== undefined ? { owner: args.owner } : {}),
      ...(args.material !== undefined ? { material: args.material } : {}),
      ...(args.within !== undefined
        ? {
            within: {
              mins: args.within.mins as Vec3,
              maxs: args.within.maxs as Vec3,
            },
          }
        : {}),
    };

    const beforeReport = checkVmfSolids(path, before);
    const result = clipSolids(before, selector, plane, {
      keep: args.keep,
      ...(args.cutMaterial !== undefined ? { cutMaterial: args.cutMaterial } : {}),
    });

    // The oracle, run before the file is touched. Two claims, not one: every piece is
    // still a brush, and no volume appeared or vanished.
    const afterReport = checkVmfSolids(path, result.text);
    const touched = new Set<number>();
    for (const s of result.solids) {
      touched.add(s.id);
      if (s.otherId !== null) touched.add(s.otherId);
    }
    const broken = afterReport.solids.filter((s) => s.id !== null && touched.has(s.id) && !s.valid);
    if (broken.length > 0) {
      throw new Error(
        `refusing to write: ${broken.length} of the pieces this cut would make are not ` +
          `valid brushes. ` +
          broken
            .flatMap((s) => s.findings.filter((f) => f.severity === "error").map((f) => f.message))
            .join(" | "),
      );
    }
    if (args.keep === "both") {
      for (const s of result.solids) {
        if (s.removed || s.otherId === null) continue;
        const sum = s.volumeAfter + s.volumeOther;
        const drift = Math.abs(sum - s.volumeBefore) / Math.max(s.volumeBefore, 1);
        if (drift > 1e-4) {
          throw new Error(
            `refusing to write: cutting solid ${s.id} produced pieces of ${s.volumeAfter} ` +
              `and ${s.volumeOther}, which sum to ${sum} where the original was ` +
              `${s.volumeBefore}. Keeping both halves must conserve volume.`,
          );
        }
      }
    }
    // Nothing that was not selected may have changed shape.
    for (const b of beforeReport.solids) {
      if (b.id === null || touched.has(b.id)) continue;
      const a = afterReport.solids.find((s) => s.id === b.id);
      if (!a || a.volume !== b.volume) {
        throw new Error(
          `refusing to write: solid ${b.id} was not selected and changed anyway. That is a ` +
            `bug in this tool, not in the map.`,
        );
      }
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
      unchanged: result.unchanged,
    });

    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      unchanged: result.unchanged,
      matched: result.matched,
      solids: result.solids,
      solidsBefore: beforeReport.solidCount,
      solidsAfter: afterReport.solidCount,
      warnings: result.warnings,
      nextStep:
        "A cut through a wall of the hull opens the map. Compile and read_leak: sealing is " +
        "a property of the whole map, and nothing offline can rule it out.",
    };
  },
});

export const clipTools = [clipSolidsTool];
