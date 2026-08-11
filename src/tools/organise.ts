import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeGuarded } from "../fs/write.js";
import { defineTool } from "../mcp/registry.js";
import { groupSolids, readOrganisation, setCordon, setVisgroup } from "../vmf/organise.js";
import type { SolidSelector } from "../vmf/select.js";
import { checkVmfSolids } from "../vmf/solid.js";
import type { Vec3 } from "../vmf/solid.js";
import { BACKUP, BACKUP_PATH, CONFIRM, DRY_RUN, resolveInput } from "./paths.js";

const Vec = z.tuple([z.number(), z.number(), z.number()]);

const SELECTOR = {
  solidIds: z.array(z.number()).optional(),
  owner: z.string().optional().describe("'world', or a brush entity classname."),
  material: z.string().optional().describe("Brushes carrying this on at least one face."),
  within: z.object({ mins: Vec, maxs: Vec }).optional(),
};

const selectorFrom = (args: {
  solidIds?: number[];
  owner?: string;
  material?: string;
  within?: { mins: [number, number, number]; maxs: [number, number, number] };
}): SolidSelector => ({
  ...(args.solidIds !== undefined ? { ids: args.solidIds } : {}),
  ...(args.owner !== undefined ? { owner: args.owner } : {}),
  ...(args.material !== undefined ? { material: args.material } : {}),
  ...(args.within !== undefined
    ? { within: { mins: args.within.mins, maxs: args.within.maxs } }
    : {}),
});

/** Refuses to write when an organisation edit moved geometry, which it never should. */
function assertGeometryUntouched(path: string, before: string, after: string): void {
  const b = checkVmfSolids(path, before);
  const a = checkVmfSolids(path, after);
  if (a.solidCount !== b.solidCount) {
    throw new Error(
      `refusing to write: an organisation edit changed the solid count from ${b.solidCount} ` +
        `to ${a.solidCount}. It never should.`,
    );
  }
  for (const x of b.solids) {
    if (x.id === null) continue;
    const y = a.solids.find((s) => s.id === x.id);
    if (!y || y.volume !== x.volume) {
      throw new Error(`refusing to write: solid ${x.id} changed shape. It never should.`);
    }
  }
}

const VisgroupNode: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    id: z.number(),
    name: z.string(),
    color: z.string(),
    solidCount: z.number(),
    entityCount: z.number(),
    children: z.array(VisgroupNode),
  }),
);

export const readMapOrganisationTool = defineTool({
  name: "read_map_organisation",
  description:
    "Visgroups, groups and the cordon of a .vmf, with what belongs to each. None of it " +
    "reaches the compiled map -- a visgroup hides a brush from the editor and not from " +
    "vbsp -- which is why it was invisible here and why it matters at scale: on a map with " +
    "two thousand brushes, 'the north tenement' has to be a name that lives in the file or " +
    "every selection is a bounding box someone typed from memory. Membership is counted " +
    "from the objects rather than from the declarations, so an id used by a brush and " +
    "declared nowhere is reported -- Hammer drops those silently when it opens the file.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
  },
  outputSchema: {
    path: z.string(),
    visgroups: z.array(VisgroupNode),
    groups: z.array(z.object({ id: z.number(), solidCount: z.number() })),
    cordons: z.array(
      z.object({ name: z.string(), active: z.boolean(), mins: Vec, maxs: Vec }),
    ),
    /** With this on, a compile ships only what the cordon box contains. */
    cordonsActive: z.boolean(),
    ungroupedSolids: z.number(),
    warnings: z.array(z.string()),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    return { path, ...readOrganisation(readFileSync(path, "utf8")) };
  },
});

export const setVisgroupTool = defineTool({
  name: "set_visgroup",
  description:
    "Puts brushes in a named visgroup, creating it if it does not exist, or takes them " +
    "out. This is what gives a selector a durable name: once 'north tenement' is in the " +
    "file, every later call can say owner or ids without a bounding box typed from memory. " +
    "Both halves are written -- the declaration in the visgroups block and the membership " +
    "in each brush's editor block -- because Hammer drops a membership whose visgroup is " +
    "not declared, without a word, the next time it opens the map. A brush may be in " +
    "several visgroups at once, which is the normal case and not an error.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    name: z.string().describe("Visgroup name, as Hammer's tree shows it."),
    remove: z.boolean().optional().describe("Take the brushes out instead of putting them in."),
    color: z.string().optional().describe("Editor colour, 'r g b'. Default '255 255 255'."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    visgroupId: z.number(),
    created: z.boolean(),
    solidsChanged: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setVisgroup(before, selectorFrom(args), {
      name: args.name,
      ...(args.remove !== undefined ? { remove: args.remove } : {}),
      ...(args.color !== undefined ? { color: args.color } : {}),
    });
    assertGeometryUntouched(path, before, result.text);

    // The membership and the declaration have to agree, and the reader is what says so.
    const after = readOrganisation(result.text);
    const orphaned = after.warnings.filter((w) => w.includes("declared nowhere"));
    if (orphaned.length > 0) {
      throw new Error(`refusing to write: ${orphaned.join(" ")}`);
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
      visgroupId: result.visgroupId,
      created: result.created,
      solidsChanged: result.solidsChanged,
      warnings: result.warnings,
      nextStep:
        "A visgroup changes nothing about the compiled map. Its value is that later calls " +
        "can name it instead of describing a box.",
    };
  },
});

export const groupSolidsTool = defineTool({
  name: "group_solids",
  description:
    "Puts brushes in one Hammer group, or takes them out of theirs. A group has no name: " +
    "Hammer treats its members as one thing when you click any of them, and that is all it " +
    "is. A solid carries exactly one group id, so grouping a brush that is already grouped " +
    "moves it rather than adding a second id, which Hammer would read as whichever came " +
    "first. Note that srctools cannot read this back: its writer emits 'groupid' and its " +
    "parser looks for 'group', so the sidecar reports no group membership on any map.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    ungroup: z.boolean().optional().describe("Take the brushes out of their group instead."),
    ...SELECTOR,
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    groupId: z.number().nullable(),
    solidsChanged: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = groupSolids(before, selectorFrom(args), {
      ...(args.ungroup !== undefined ? { ungroup: args.ungroup } : {}),
    });
    assertGeometryUntouched(path, before, result.text);

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
      groupId: result.groupId,
      solidsChanged: result.solidsChanged,
      warnings: result.warnings,
      nextStep: "read_map_organisation shows what each group now holds.",
    };
  },
});

export const setCordonTool = defineTool({
  name: "set_cordon",
  description:
    "Sets the cordon box and whether it is on. The only piece of a map's organisation that " +
    "changes what compiles: with the cordon on, vbsp is handed only what the box contains " +
    "and everything outside it is simply not in the map. It is how a mapper tests one room " +
    "of a city without waiting for the city, and it is also how a map ships with three " +
    "quarters of itself missing -- vbsp does not warn, because from its point of view " +
    "nothing is wrong. Setting it always reports whether it is active.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    mins: Vec,
    maxs: Vec,
    name: z.string().optional().describe("Default 'cordon'."),
    active: z.boolean().optional().describe("Default true. False leaves the box and turns it off."),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    name: z.string(),
    active: z.boolean(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setCordon(
      before,
      { mins: args.mins as Vec3, maxs: args.maxs as Vec3 },
      {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.active !== undefined ? { active: args.active } : {}),
      },
    );
    assertGeometryUntouched(path, before, result.text);

    // Read it back: a cordon this tool writes and its own reader cannot recover is a
    // cordon Hammer will not recover either.
    const after = readOrganisation(result.text);
    if (after.cordons.length !== 1) {
      throw new Error(
        `refusing to write: the cordon this produced reads back as ${after.cordons.length} ` +
          `cordons rather than one`,
      );
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
      name: result.name,
      active: result.active,
      warnings: result.warnings,
      nextStep: result.active
        ? "Turn it off before the compile that ships, or the map is only what is in the box."
        : "The box is set and switched off, so the next compile takes the whole map.",
    };
  },
});

export const organiseTools = [
  readMapOrganisationTool,
  setVisgroupTool,
  groupSolidsTool,
  setCordonTool,
];
