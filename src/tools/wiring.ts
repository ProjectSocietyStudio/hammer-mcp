import { readFileSync } from "node:fs";
import type { Config } from "../config.js";
import { z } from "zod";
import { gameBlock } from "../games/resolve.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { readEntityLump, wirableFromLump, withOutputsSplit } from "../bsp/entities.js";
import { checkEntityWiring, connectionsOf, entityRows } from "../entity/wiring.js";
import type {
  ClassSchema,
  EntityRow,
  EntityRowFilter,
  WirableEntity,
} from "../entity/wiring.js";
import { readEntities } from "../vmf/edit.js";
import { entityReport, wirableEntities } from "../vmf/wiring.js";
import { writeGuarded } from "../fs/write.js";
import { setMapProperties, writePortal } from "../vmf/portals.js";
import { checkVmfSolids } from "../vmf/solid.js";
import {
  BACKUP,
  BACKUP_PATH,
  CONFIRM,
  DRY_RUN,
  GAME,
  GAME_BLOCK,
  magicOf,
  resolveInput,
  resolveVmfInput,
} from "./paths.js";
import { fgdContext } from "./vmf.js";

/**
 * Opens a path that may be either format, and hands back the two things both tools need.
 *
 * The dispatch is the first four bytes, not the extension: a `.bsp` renamed is still a
 * compiled map, and this server's whole reason for reading by offset is that guessing
 * wrong about a 1.13 GB file is not a recoverable mistake. The VMF branch reads the file
 * whole because a VMF is source and that is what source is for; the BSP branch reads lump
 * 0 and nothing else.
 */
function openEitherFormat(
  given: string,
  config: Config,
): {
  path: string;
  format: "vmf" | "bsp";
  entities: WirableEntity[];
  rows: (filter: EntityRowFilter) => EntityRow[];
} {
  const path = resolveInput(given, config);
  if (magicOf(path) === "VBSP") {
    const lump = readEntityLump(path);
    const split = withOutputsSplit(lump.entities);
    return {
      path,
      format: "bsp",
      entities: wirableFromLump(lump.entities),
      rows: (filter) => entityRows(split, filter),
    };
  }
  const source = readFileSync(path, "utf8");
  const { entities } = readEntities(source);
  return {
    path,
    format: "vmf",
    entities: wirableEntities(source),
    rows: (filter) => entityReport(source, filter),
  };
}

export const readEntityReportTool = defineTool({
  name: "read_entity_report",
  description:
    "Hammer's Entity Report: every entity with its keyvalues, filterable by classname, " +
    "targetname or the presence of a key. Takes a .vmf or a compiled .bsp -- on a map with " +
    "no source this is not a convenience, it is the only way to ask. read_vmf counts " +
    "entities by classname and read_bsp_entities gives a histogram; neither answers 'which " +
    "entity has spawnflags 512', which is the question the report exists for and how a " +
    "mapper finds the one door of forty that was left locked. A compiled entity has no " +
    "Hammer id and owns no solids inline, so id is null and solidCount is 0 there.",
  realm: "map",
  inputSchema: {
    path: z
      .string()
      .describe("Path to the .vmf or .bsp, absolute or relative to the repo root."),
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
    /** Which of the two the path turned out to be. */
    format: z.enum(["vmf", "bsp"]),
  },
  handler: (args, ctx) => {
    const { path, format, rows: report } = openEitherFormat(args.path, ctx.config);
    const filter = {
      ...(args.classname !== undefined ? { classname: args.classname } : {}),
      ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
      ...(args.hasKey !== undefined ? { hasKey: args.hasKey } : {}),
      ...(args.keyValue !== undefined ? { keyValue: args.keyValue } : {}),
    };
    const rows = report(filter);
    const all = report({});
    const byClassname: Record<string, number> = {};
    for (const e of all) byClassname[e.classname] = (byClassname[e.classname] ?? 0) + 1;

    return {
      path,
      matched: rows.length,
      returned: Math.min(rows.length, args.limit),
      entities: rows.slice(0, args.limit),
      byClassname,
      format,
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
    path: z
      .string()
      .describe("Path to the .vmf or .bsp, absolute or relative to the repo root."),
    game: GAME,
    limit: z.number().int().min(1).max(500).default(100),
  },
  outputSchema: {
    game: GAME_BLOCK,
    path: z.string(),
    /** Which of the two the path turned out to be. */
    format: z.enum(["vmf", "bsp"]),
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
    const { path, format, entities } = openEitherFormat(args.path, ctx.config);
    const { game, from, binDir, fgd } = fgdContext(ctx.config, args.game);

    // Only the classes this map actually uses, and only those on either end of a wire.
    // Loading the whole FGD to judge nine connections would cost seconds and answer the
    // same question.
    const { connections } = connectionsOf(entities);
    const byName = new Map<string, Set<string>>();
    for (const e of entities) {
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
    const unknownClasses: string[] = [];
    for (const classname of wanted) {
      // A class the FGD does not define makes fgd_class raise, and letting that through
      // aborted the whole call -- which contradicts the one thing this tool promises about
      // unknown classes. A mod's custom entity is the normal case, not a failure.
      let reply: { inputs?: string[]; outputs?: string[] };
      try {
        reply = (await callSidecar(
          "fgd_class",
          { binDir, fgd, classname },
          ctx.config,
          120_000,
        )) as { inputs?: string[]; outputs?: string[] };
      } catch {
        unknownClasses.push(classname);
        continue;
      }
      if (!reply.inputs && !reply.outputs) {
        unknownClasses.push(classname);
        continue;
      }
      schemas.set(classname.toLowerCase(), {
        inputs: new Set((reply.inputs ?? []).map((s) => s.toLowerCase())),
        outputs: new Set((reply.outputs ?? []).map((s) => s.toLowerCase())),
      });
    }

    const report = checkEntityWiring(entities, schemas);
    const errors = report.findings.filter((f) => f.severity === "error");
    const warns = report.findings.filter((f) => f.severity === "warning");

    // On a compiled map an output is recognised by its name and by its value parsing as a
    // connection. Now that the FGD is loaded, say what that convention missed rather than
    // leaving the caller to assume it missed nothing.
    const missed: string[] = [];
    if (format === "bsp") {
      const seen = new Set(connections.map((c) => `${c.fromClassname}/${c.output}`.toLowerCase()));
      for (const e of entities) {
        const schema = schemas.get(e.classname.toLowerCase());
        if (!schema) continue;
        for (const [key] of e.connections) {
          if (!schema.outputs.has(key.toLowerCase())) continue;
          if (!seen.has(`${e.classname}/${key}`.toLowerCase())) missed.push(`${e.classname}.${key}`);
        }
      }
    }

    return {
      game: gameBlock(game, from),
      path,
      format,
      connectionCount: report.connections.length,
      classesChecked: schemas.size,
      errorCount: errors.length,
      warningCount: warns.length,
      findings: [...errors, ...warns].slice(0, args.limit),
      unresolvedTargets: report.unresolvedTargets,
      warnings: [
        ...report.warnings,
        ...(format === "bsp"
          ? [
              `This is a compiled map. vbsp flattened every connections block into ordinary ` +
                `keyvalues, so the ${report.connections.length} output(s) judged here were ` +
                `recognised by name and by parsing, then checked against the FGD. What a ` +
                `compiled map cannot tell you at all: which brush was func_detail, where the ` +
                `hints were, what the visgroups held.`,
            ]
          : []),
        ...(missed.length > 0
          ? [
              `${missed.length} keyvalue(s) are outputs according to the FGD and were not ` +
                `read as connections: ${missed.slice(0, 8).join(", ")}. Their values do not ` +
                `parse as one, which usually means the map stores something else under that ` +
                `name -- but it is said rather than dropped.`,
            ]
          : []),
        ...(unknownClasses.length > 0
          ? [
              `${unknownClasses.length} class(es) are not in this game's FGD and were not ` +
                `judged: ${unknownClasses.slice(0, 8).join(", ")}. A mod's own entities are ` +
                `the normal case for that.`,
            ]
          : []),
      ],
      nextStep:
        errors.length === 0
          ? "Every wire this could judge resolves. What the map does when it runs is still " +
            "for the engine to say."
          : "Each error is a wire that fires into nothing. No compiler will mention any of " +
            "them, which is why they are here.",
    };
  },
});



const Vec = z.tuple([z.number(), z.number(), z.number()]);

export const writePortalTool = defineTool({
  name: "write_portal",
  description:
    "Places an areaportal, an areaportal window or an occluder: the two brush entities " +
    "read_map_geometry has counted since the beginning and nothing has ever placed. They " +
    "are the runtime half of visibility. An areaportal seals a doorway and the engine " +
    "opens and closes it as the player moves, culling everything beyond it while it is " +
    "shut -- the strongest tool Source has and the fussiest, because vbsp refuses the whole " +
    "map if the brush does not fill its opening exactly. An occluder hides what is behind " +
    "it per frame on the CPU: it never fails a compile and it costs time whether or not it " +
    "saves any. The brush is written through the same path as every other, and gets the " +
    "tool material without which the entity is a solid wall the player walks into.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    classname: z
      .enum(["func_areaportal", "func_areaportalwindow", "func_occluder"])
      .describe("What to place. A window fades rather than sealing."),
    mins: Vec,
    maxs: Vec,
    targetname: z.string().optional(),
    keyvalues: z.record(z.string(), z.string()).optional(),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    entityId: z.number(),
    solidId: z.number(),
    classname: z.string(),
    /** Thinnest side, in units. A portal is a sheet; a box this solid is usually a mistake. */
    thickness: z.number(),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const beforeReport = checkVmfSolids(path, before);

    const result = writePortal(
      before,
      args.classname,
      args.mins as [number, number, number],
      args.maxs as [number, number, number],
      {
        ...(args.targetname !== undefined ? { targetname: args.targetname } : {}),
        ...(args.keyvalues !== undefined ? { keyvalues: args.keyvalues } : {}),
      },
    );

    // The oracle: the brush must read back as a brush, in the entity, and nothing else in
    // the map may have moved.
    const afterReport = checkVmfSolids(path, result.text);
    const made = afterReport.solids.find((s) => s.id === result.solidId);
    if (!made || !made.valid) {
      throw new Error(
        `refusing to write: the brush this made is not a valid one. ` +
          (made?.findings ?? [])
            .filter((f) => f.severity === "error")
            .map((f) => f.message)
            .join(" | "),
      );
    }
    if (made.owner !== args.classname) {
      throw new Error(
        `refusing to write: the brush ended up in ${made.owner} rather than in the ` +
          `${args.classname} it was written for. A brush in the world is a solid wall.`,
      );
    }
    if (afterReport.solidCount !== beforeReport.solidCount + 1) {
      throw new Error(
        `refusing to write: the solid count went from ${beforeReport.solidCount} to ` +
          `${afterReport.solidCount}, and one brush was added.`,
      );
    }
    for (const b of beforeReport.solids) {
      if (b.id === null) continue;
      const a = afterReport.solids.find((s) => s.id === b.id);
      if (!a || a.volume !== b.volume) {
        throw new Error(`refusing to write: solid ${b.id} changed. It never should.`);
      }
    }

    const write = writeGuarded(path, result.text, ctx.config, {
      dryRun: args.dryRun,
      backup: args.backup,
    });
    return {
      path,
      written: write.written,
      backupPath: write.backupPath,
      entityId: result.entityId,
      solidId: result.solidId,
      classname: result.classname,
      thickness: result.thickness,
      warnings: result.warnings,
      nextStep:
        args.classname === "func_occluder"
          ? "Compile and measure. An occluder that hides nothing still costs its test against " +
            "every prop, every frame."
          : "Compile. If the brush does not seal its opening exactly, vbsp stops with " +
            "'areaportal brush doesn't touch two areas' and read_compile_log says which.",
    };
  },
});

export const setMapPropertiesTool = defineTool({
  name: "set_map_properties",
  description:
    "Sets the keyvalues that really live on worldspawn: the sky, the detail sprites, the " +
    "prop fade width. Ordinary keyvalues on an ordinary entity, so this is edit_vmf with a " +
    "shorter name -- except that detailvbsp and detailmaterial come as a pair, and setting " +
    "one without the other gives a map whose grass either has no sprites or has sprites " +
    "with no material, which vbsp mentions neither of. Fog is NOT here: Source reads " +
    "fogenable, fogstart, fogend and fogcolor from an env_fog_controller, and writing them " +
    "to worldspawn gives a file that parses and no fog in game. Create the controller with " +
    "edit_vmf.",
  realm: "map",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    skyname: z.string().optional(),
    detailvbsp: z.string().optional().describe("Which sprites go on which material."),
    detailmaterial: z.string().optional().describe("The sprite sheet itself."),
    maxpropscreenwidth: z.string().optional(),
    dryRun: DRY_RUN,
    backup: BACKUP,
    confirm: CONFIRM,
  },
  outputSchema: {
    path: z.string(),
    written: z.boolean(),
    backupPath: BACKUP_PATH,
    unchanged: z.boolean(),
    changed: z.record(
      z.string(),
      z.object({ from: z.string().nullable(), to: z.string() }),
    ),
    warnings: z.array(z.string()),
    nextStep: z.string(),
  },
  handler: (args, ctx) => {
    const path = resolveVmfInput(args.path, ctx.config);
    const before = readFileSync(path, "utf8");
    const result = setMapProperties(before, {
      ...(args.skyname !== undefined ? { skyname: args.skyname } : {}),
      ...(args.detailvbsp !== undefined ? { detailvbsp: args.detailvbsp } : {}),
      ...(args.detailmaterial !== undefined ? { detailmaterial: args.detailmaterial } : {}),
      ...(args.maxpropscreenwidth !== undefined
        ? { maxpropscreenwidth: args.maxpropscreenwidth }
        : {}),
    });

    const b = checkVmfSolids(path, before);
    const a = checkVmfSolids(path, result.text);
    if (a.solidCount !== b.solidCount) {
      throw new Error("refusing to write: setting a map property changed the geometry");
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
      changed: result.changed,
      warnings: result.warnings,
      nextStep:
        "A sky that is not packed is a sky the player does not have. " +
        "read_map_dependencies after the next compile.",
    };
  },
});

export const wiringTools = [
  readEntityReportTool,
  validateIoTool,
  writePortalTool,
  setMapPropertiesTool,
];
