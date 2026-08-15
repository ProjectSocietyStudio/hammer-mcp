import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { checkVmfSolids } from "../vmf/solid.js";
import { moveVertices } from "../vmf/vertex.js";
import type { VertexMove } from "../vmf/vertex.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput, resolveVmfInput } from "./paths.js";

const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const moveVerticesTool = defineTool({
  name: "move_vertices",
  description:
    "Moves named corners of one brush: Hammer's vertex manipulation tool. The last thing " +
    "between an assembly of cut boxes and an arbitrary convex shape -- it is what pulls a " +
    "wall out to meet a street that does not run square. Corners are named by position, " +
    "as read_vmf_solids reports them. It refuses far more than it accepts, and that is " +
    "parity with the editor rather than a shortfall: moving one corner moves it on every " +
    "face that shares it, three of them on a box, so a diagonal pull leaves each of those " +
    "faces with a point off its own plane. Hammer shows that as a red invalid solid and " +
    "will not build it either. Moves that work are the ones keeping every face flat: a " +
    "whole edge, or a whole face. Texture axes are left alone, as Hammer leaves them.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    solidId: z.number().describe("Hammer id of the brush. read_vmf_solids lists the corners."),
    moves: z
      .array(z.object({ from: Vec, to: Vec }))
      .min(1)
      .describe("Corners to move, each named by where it is now."),
    tolerance: z
      .number()
      .optional()
      .describe(
        "How close a coordinate must be to a real corner to name it. Default 0.5, because " +
          "corners read back through JSON are rounded and exact equality would make the " +
          "tool unusable from outside.",
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
    solidId: z.number(),
    moved: z.number(),
    volumeBefore: z.number(),
    volumeAfter: z.number(),
    minsAfter: Vec,
    maxsAfter: Vec,
    /** Worst distance from a corner to the plane of a face it belongs to, after the move. */
    planarityError: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const beforeReport = checkVmfSolids(path, before);

    const result = moveVertices(
      before,
      args.solidId,
      args.moves as VertexMove[],
      args.tolerance ?? 0.5,
    );

    // The oracle, run before the file is touched: the reshaped brush must still be one,
    // and nothing else may have moved.
    const afterReport = checkVmfSolids(path, result.text);
    if (afterReport.solidCount !== beforeReport.solidCount) {
      throw new Error(
        `refusing to write: the solid count changed from ${beforeReport.solidCount} to ` +
          `${afterReport.solidCount}. Moving corners never adds or removes a brush.`,
      );
    }
    const reshaped = afterReport.solids.find((s) => s.id === args.solidId);
    if (!reshaped || !reshaped.valid) {
      throw new Error(
        `refusing to write: solid ${args.solidId} is not a valid brush after the move. ` +
          (reshaped?.findings ?? [])
            .filter((f) => f.severity === "error")
            .map((f) => f.message)
            .join(" | "),
      );
    }
    for (const b of beforeReport.solids) {
      if (b.id === null || b.id === args.solidId) continue;
      const a = afterReport.solids.find((s) => s.id === b.id);
      if (!a || a.volume !== b.volume) {
        throw new Error(
          `refusing to write: solid ${b.id} was not named and changed anyway. That is a bug ` +
            `in this tool, not in the map.`,
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
      solidId: result.solidId,
      moved: result.moved,
      volumeBefore: result.volumeBefore,
      volumeAfter: result.volumeAfter,
      minsAfter: result.minsAfter as unknown as [number, number, number],
      maxsAfter: result.maxsAfter as unknown as [number, number, number],
      planarityError: result.worstPlanarityError,
      warnings: result.warnings,
      nextStep:
        "Reshaping a brush that was part of the hull can open the map along the edge that " +
        "moved. Compile and read_leak: every check here is about one brush, and sealing is " +
        "a property of all of them together.",
    };
  },
});

export const vertexTools = [moveVerticesTool];
