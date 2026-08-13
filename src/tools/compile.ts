import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { clip } from "@projectsociety/mcp-core";
import { z } from "zod";
import { parseCompileLog } from "../compile/log.js";
import { locateLeak, readPointfile } from "../compile/leak.js";
import { ToolchainError, compilerExe, runCompiler, toWindowsPath } from "../compile/wine.js";
import { readEntityLump } from "../bsp/entities.js";
import { checkNavFreshness } from "../bsp/nav.js";
import { parseEntityText } from "../bsp/entities.js";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { gameBlock, gameFor } from "../games/resolve.js";
import { CONFIRM, GAME, GAME_BLOCK, resolveInput } from "./paths.js";

const FINDING = z.object({
  severity: z.string(),
  rule: z.string(),
  message: z.string(),
  line: z.string(),
});

/**
 * Stock by default, on purpose and not out of caution.
 *
 * The Hammer++ compilers are faster and cull more, which is exactly why they must not be
 * the default: the only way to know whether they changed something they should not have
 * on a 1.13 GB map is to recompile the same source with the stock chain and compare.
 * A default nobody chose would remove that comparison without anyone noticing.
 */
const TOOLCHAIN = z
  .enum(["stock", "plusplus"])
  .default("stock")
  .describe(
    "Which compilers to drive. 'plusplus' is the Hammer++ rebuild: much faster vvis, and " +
      "flags the stock chain does not have. Requires them installed; see health.",
  );

const STAGE_RESULT = z.object({
  stage: z.string(),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  timedOut: z.boolean(),
  findings: z.array(FINDING),
  clean: z.boolean(),
  stdoutTail: z.string(),
});

export const runCompile = defineTool({
  name: "run_compile",
  description:
    "Compiles a .vmf with vbsp, vvis and vrad under wine, and returns each stage's " +
    "findings rather than its raw output. Takes minutes to hours: vvis on a large map " +
    "is the slow part, and -fast exists for iteration. Stops at the first stage that " +
    "fails, because vvis and vrad results are meaningless after a leak. Run " +
    "read_vmf_lint first -- it catches before the compile most of what makes one fail.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    vmf: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    fast: z
      .boolean()
      .default(true)
      .describe("vvis -fast and vrad -fast: minutes instead of hours, dev quality only."),
    hdr: z.boolean().default(false).describe("vrad -both, for an HDR and an LDR lightmap set."),
    stages: z
      .array(z.enum(["vbsp", "vvis", "vrad"]))
      .default(["vbsp", "vvis", "vrad"])
      .describe("Stages to run, in order. vbsp alone is enough to check a map seals."),
    toolchain: TOOLCHAIN,
    cull: z
      .boolean()
      .default(false)
      .describe(
        "Hammer++ only. Culls unreferenced planes, vertices, brushes and brush sides " +
          "even when no limit is reached yet. Measured on ttt_traps: -20.5% PLANES, " +
          "-12.8% VERTEXES, -10.5% file size. Changes no geometry; read_map_geometry " +
          "before and after is the check.",
      ),
    game: GAME,
    timeoutMinutes: z.number().int().min(1).max(600).default(60),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    vmf: z.string(),
    toolchain: z.string(),
    game: GAME_BLOCK,
    bsp: z.string(),
    bspExists: z.boolean(),
    bspBytes: z.number().nullable(),
    stages: z.array(STAGE_RESULT),
    leaked: z.boolean(),
    pointfile: z.string().nullable(),
    ok: z.boolean(),
  },
  handler: async (args, ctx) => {
    const chain = args.toolchain;
    // Checked before anything touches the disk: this is an inconsistency between two
    // arguments, and it stays true whether or not the map exists.
    if (args.cull && chain !== "plusplus") {
      // Refused rather than dropped: the stock vbsp accepts unknown flags in silence, so
      // a stock compile with cull would report success and have culled nothing.
      throw new Error(`cull is a Hammer++ flag; pass toolchain: "plusplus" to use it`);
    }

    const vmf = resolveInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    if (extname(vmf).toLowerCase() !== ".vmf") throw new Error(`${vmf} is not a .vmf`);

    // The compilers write the .bsp beside the source, so that is a write we own.
    const bsp = join(dirname(vmf), `${basename(vmf, ".vmf")}.bsp`);
    assertWritable(bsp, ctx.config);

    const { game: profile, from } = gameFor(ctx.config, args.game);
    // Refused rather than attempted: a compile against a game whose toolchain we cannot
    // locate fails deep inside wine, with a message about a missing DLL.
    if (profile.unusableForCompile) {
      throw new ToolchainError(`cannot compile against ${profile.id}: ${profile.unusableForCompile}`);
    }
    const game = toWindowsPath(profile.gameDir ?? ctx.config.gmodGameDir);
    const target = toWindowsPath(vmf);
    const timeoutMs = args.timeoutMinutes * 60_000;

    // The four go together: they cull the same way in four lumps, and read_map_geometry
    // reports each one separately, so nothing here is hidden behind a single number.
    const cull = args.cull
      ? ["-cullverts", "-cullplanes", "-cullbrushes", "-cullbrushsides"]
      : [];

    const plans: Record<string, { exe: string; argv: string[] }> = {
      vbsp: { exe: compilerExe("vbsp", chain), argv: [...cull, "-game", game, target] },
      vvis: {
        exe: compilerExe("vvis", chain),
        argv: [...(args.fast ? ["-fast"] : []), "-game", game, target],
      },
      vrad: {
        exe: compilerExe("vrad", chain),
        argv: [
          ...(args.fast ? ["-fast"] : []),
          ...(args.hdr ? ["-both"] : []),
          "-game",
          game,
          target,
        ],
      },
    };

    const stages: Array<z.infer<typeof STAGE_RESULT>> = [];
    let leaked = false;

    for (const stage of args.stages) {
      const plan = plans[stage]!;
      ctx.audit.record({ kind: "compile_start", data: { stage, vmf, toolchain: chain } });
      const run = await runCompiler(ctx.config, plan.exe, plan.argv, timeoutMs, chain, profile);
      const report = parseCompileLog(`${run.stdout}\n${run.stderr}`);
      ctx.audit.record({
        kind: "compile_end",
        data: {
          stage,
          toolchain: chain,
          exitCode: run.code,
          clean: report.clean,
          ms: run.durationMs,
        },
      });

      stages.push({
        stage,
        exitCode: run.code,
        durationMs: run.durationMs,
        timedOut: run.timedOut,
        findings: report.findings,
        clean: report.clean,
        stdoutTail: clip(run.stdout.split(/\r?\n/).slice(-40).join("\n"), 4000),
      });

      if (report.leaked) leaked = true;
      // Carrying on past a failed stage wastes an hour of vvis on a map that already
      // cannot produce meaningful visibility.
      if (!report.clean || run.timedOut) break;
    }

    const pointfile = join(dirname(vmf), `${basename(vmf, ".vmf")}.lin`);
    const bspExists = existsSync(bsp);

    return {
      vmf,
      toolchain: chain,
      game: gameBlock(profile, from),
      bsp,
      bspExists,
      bspBytes: bspExists ? statSync(bsp).size : null,
      stages,
      leaked,
      pointfile: existsSync(pointfile) ? pointfile : null,
      ok: stages.every((s) => s.clean && !s.timedOut) && bspExists,
    };
  },
});

export const readCompileLog = defineTool({
  name: "read_compile_log",
  description:
    "Turns compiler output into structured findings, each with what the message actually " +
    "means. Use it on a log someone else produced, or on one from an editor. Several " +
    "Source messages name the wrong thing -- a leak gives no location, a displacement " +
    "error always prints brush id 0 -- so each finding carries the correction.",
  realm: "map",
  inputSchema: {
    text: z.string().describe("Raw compiler output."),
  },
  outputSchema: {
    findings: z.array(FINDING),
    bySeverity: z.record(z.number()),
    byRule: z.record(z.number()),
    clean: z.boolean(),
    leaked: z.boolean(),
  },
  handler: (args) => {
    const r = parseCompileLog(args.text);
    return {
      findings: r.findings,
      bySeverity: r.bySeverity,
      byRule: r.byRule,
      clean: r.clean,
      leaked: r.leaked,
    };
  },
});

export const readLeak = defineTool({
  name: "read_leak",
  description:
    "Turns a leak into a location. vbsp says only 'leaked!' and writes a .lin pointfile " +
    "beside the map: this reads it and names the entities nearest to where the path " +
    "starts, which is the entity that can see the void. Pass the .lin, or the .vmf or " +
    ".bsp beside it. Both ends of the path are correlated, because vbsp does not " +
    "guarantee which end holds the entity -- on a two-point pointfile it was the last. " +
    "No pointfile is an ANSWER, not an error: it returns leaked:false, and `compiled` " +
    "tells a map that did not leak from one nothing has compiled here.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .lin pointfile, or the .vmf/.bsp it sits beside."),
    limit: z.number().int().min(1).max(50).default(5),
  },
  outputSchema: {
    pointfile: z.string(),
    /**
     * False when there is no pointfile, which is the answer and not a failure.
     *
     * This tool used to pass `readPointfile`'s throw straight through, so confirming that
     * a map was sealed came back as `read_leak failed: <map>.lin does not exist`. A caller
     * that treats a tool error as a broken step reads a sealed map as a broken step, and
     * one did, while building `hmcp_bodega` on 13/08/2026.
     */
    leaked: z.boolean(),
    /** Whether anything compiled this map here at all -- what tells the two no-leaks apart. */
    compiled: z.boolean(),
    note: z.string(),
    pointCount: z.number().optional(),
    start: z.array(z.number()).optional(),
    end: z.array(z.number()).optional(),
    spanUnits: z.number().optional(),
    correlatedAgainst: z.string().nullable().optional(),
    nearestToStart: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ).optional(),
    nearestToEnd: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ).optional(),
    leakingEntity: z
      .object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
        atEnd: z.boolean(),
      })
      .nullable()
      .optional(),
    points: z.array(z.object({ point: z.array(z.number()), index: z.number() })).optional(),
  },
  handler: async (args, ctx) => {
    const given = resolveInput(args.path, ctx.config);
    const stem = join(dirname(given), basename(given, extname(given)));
    const pointfile = extname(given).toLowerCase() === ".lin" ? given : `${stem}.lin`;
    const bsp = `${stem}.bsp`;
    const vmf = `${stem}.vmf`;

    // No pointfile is an answer, not a failure. vbsp writes one when it leaks and not
    // otherwise, so what is missing here is the leak -- and a caller asking "did this
    // leak?" should be told no, rather than handed an error to interpret.
    //
    // The .bsp is what removes the hedge this message used to carry. A compile that
    // produced a .bsp and no pointfile did not leak; nothing beside the map at all means
    // nothing has compiled it here, which is a different answer and used to read as the
    // same one.
    if (!existsSync(pointfile)) {
      const compiled = existsSync(bsp);
      return {
        pointfile,
        leaked: false,
        compiled,
        note: compiled
          ? `No pointfile beside this map, and ${bsp} is there. vbsp writes a .lin when it ` +
            `leaks and does not otherwise, so the compile that produced that .bsp did not leak.`
          : `No pointfile and no .bsp beside this map: nothing here has compiled it, so there ` +
            `is nothing to say about whether it leaks. run_compile with stages ["vbsp"] ` +
            `answers that, and read_vmf_leak answers it without a compiler at all.`,
        leakingEntity: null,
      };
    }

    const points = readPointfile(pointfile);

    // Entities come from whichever companion file exists: the .bsp if the map compiled
    // far enough to produce one, otherwise the .vmf through the sidecar.
    let entities;
    let correlatedAgainst: string | null = null;

    if (existsSync(bsp)) {
      entities = readEntityLump(bsp).entities;
      correlatedAgainst = bsp;
    } else if (existsSync(vmf)) {
      const reply = await callSidecar<{
        entities: Array<{
          id: number;
          classname: string;
          targetname: string | null;
          origin: number[] | null;
        }>;
      }>("vmf_read", { path: vmf, limit: 2000 }, ctx.config, 300_000);
      entities = reply.entities
        .filter((e) => e.origin)
        .map((e, i) => ({
          index: i,
          id: e.id,
          classname: e.classname,
          ...(e.targetname ? { targetname: e.targetname } : {}),
          origin: e.origin as [number, number, number],
          keyvalues: [],
          connections: [],
          solidCount: 0,
          start: 0,
          end: 0,
        }));
      correlatedAgainst = vmf;
    } else {
      entities = parseEntityText("");
    }

    return {
      ...locateLeak(pointfile, points, entities, args.limit),
      leaked: true,
      compiled: existsSync(bsp),
      correlatedAgainst,
      note:
        `${pointfile} is there, so the last compile leaked. The path runs from an entity ` +
        `that can see the void to the void itself; leakingEntity is this toolkit's best ` +
        `guess at which end holds the entity, and both ends are reported because vbsp does ` +
        `not guarantee it.`,
    };
  },
});



export const runPack = defineTool({
  name: "run_pack",
  description:
    "Packs files into a compiled .bsp with bspzip, so custom assets ship with the map " +
    "instead of appearing as purple checkerboards on every client that lacks them. " +
    "Takes explicit pairs of in-game path and source file. With auto:true it also derives " +
    "the list from the map itself, via read_map_dependencies: every asset the map " +
    "references that resolves from a LOOSE file in the game's content tree rather than " +
    "from a VPK. Those are the ones that ship broken -- they work at home because they " +
    "are on that disk. VPK content is never packed: every player who owns the game has it. " +
    "The derived list is returned, so what was packed is visible rather than inferred. " +
    "Verifies afterwards by re-reading the pakfile: bspzip reports success whether or not " +
    "anything was added.",
  realm: "local",
  guarded: true,
  meta: { "anthropic/requiresUserInteraction": true },
  inputSchema: {
    bsp: z.string().describe("Target .bsp. It is rewritten in place."),
    files: z
      .array(
        z.object({
          internal: z
            .string()
            .describe("Path inside the map, e.g. materials/foo/bar.vmt."),
          source: z.string().describe("File on disk to pack."),
        }),
      )
      .optional()
      .describe("Explicit pairs. Required unless auto is set; combined with it otherwise."),
    auto: z
      .boolean()
      .optional()
      .describe(
        "Derive the list from the map: assets it references that sit loose in the game's " +
          "content tree rather than in a VPK. Needs the Python sidecar.",
      ),
    exclude: z
      .array(z.string())
      .optional()
      .describe(
        "Substrings of in-game paths auto should skip. For the occasional stock file that " +
          "ships loose -- Garry's Mod keeps detail.vbsp in its own root -- which auto " +
          "would otherwise pack harmlessly but pointlessly.",
      ),
    toolchain: TOOLCHAIN,
    game: GAME,
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    bsp: z.string(),
    toolchain: z.string(),
    game: GAME_BLOCK,
    requested: z.number(),
    /** Pairs auto mode derived from the map, whether or not any were also given by hand. */
    derived: z.array(z.object({ internal: z.string(), source: z.string() })),
    autoNote: z.string().optional(),
    filesBefore: z.number(),
    filesAfter: z.number(),
    added: z.number(),
    bytesBefore: z.number(),
    bytesAfter: z.number(),
    exitCode: z.number().nullable(),
    ok: z.boolean(),
    missingSources: z.array(z.string()),
    stdoutTail: z.string(),
  },
  handler: async (args, ctx) => {
    const { game: packProfile, from: packFrom } = gameFor(ctx.config, args.game);
    const bsp = assertWritable(resolveInput(args.bsp, ctx.config), ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);

    const derived: Array<{ internal: string; source: string }> = [];
    let autoNote: string | undefined;
    if (args.auto) {
      const deps = await callSidecar<{
        loose: Array<{ path: string; diskPath: string | null }>;
        looseCount: number;
        missingCount: number;
      }>(
        "map_dependencies",
        {
          path: bsp,
          gameDir: packProfile.gameDir ?? ctx.config.gmodGameDir,
          limit: 5000,
        },
        ctx.config,
        600_000,
      );
      const excluded: string[] = [];
      for (const entry of deps.loose) {
        if (!entry.diskPath) continue;
        if ((args.exclude ?? []).some((pat) => entry.path.includes(pat))) {
          excluded.push(entry.path);
          continue;
        }
        derived.push({ internal: entry.path, source: entry.diskPath });
      }
      autoNote =
        `${deps.looseCount} asset(s) resolve from loose files in the game tree; ` +
        `${derived.length} packed here` +
        (excluded.length > 0 ? `, ${excluded.length} excluded by request` : "") +
        `. A loose file is a candidate, not a certainty -- some games ship stock files ` +
        `loose (Garry's Mod keeps detail.vbsp in its own root). Over-packing costs ` +
        `kilobytes; under-packing ships a broken map, so this errs toward including. ` +
        (deps.missingCount > 0
          ? `${deps.missingCount} more are missing from everywhere and CANNOT be packed -- ` +
            `read_map_dependencies lists them, and packing will not fix them.`
          : `Nothing the map references is missing outright.`);
    }

    // Explicit pairs win: a caller who named a source meant that one.
    const byInternal = new Map(derived.map((f) => [f.internal, f]));
    for (const f of args.files ?? []) byInternal.set(f.internal, f);
    const files = [...byInternal.values()];
    if (files.length === 0) {
      throw new Error(
        args.auto
          ? "auto found nothing to pack: no asset this map references sits loose in the " +
            "game tree. That is the healthy answer, not a failure."
          : "no files given, and auto is not set",
      );
    }

    const missingSources = files
      .map((f) => resolveInput(f.source, ctx.config))
      .filter((p) => !existsSync(p));
    if (missingSources.length > 0) {
      throw new Error(
        `cannot pack files that do not exist: ${missingSources.slice(0, 5).join(", ")}`,
      );
    }

    const countPak = async (): Promise<number> => {
      const r = await callSidecar<{ fileCount: number }>(
        "pakfile",
        { path: bsp, limit: 1 },
        ctx.config,
        300_000,
      );
      return r.fileCount;
    };

    const filesBefore = await countPak();
    const bytesBefore = statSync(bsp).size;

    // bspzip -addlist reads pairs of lines: in-game path, then source path.
    const listPath = join(ctx.config.stateDir, "bspzip-filelist.txt");
    assertWritable(listPath, ctx.config);
    mkdirSync(dirname(listPath), { recursive: true });
    writeFileSync(
      listPath,
      files.flatMap((f) => [f.internal, resolveInput(f.source, ctx.config)]).join("\n") + "\n",
    );

    const run = await runCompiler(
      ctx.config,
      compilerExe("bspzip", args.toolchain),
      [
        "-game",
        toWindowsPath(packProfile.gameDir ?? ctx.config.gmodGameDir),
        "-addlist",
        toWindowsPath(bsp),
        toWindowsPath(listPath),
        toWindowsPath(bsp),
      ],
      600_000,
      args.toolchain,
      packProfile,
    );

    const filesAfter = await countPak();
    const bytesAfter = statSync(bsp).size;

    return {
      bsp,
      toolchain: args.toolchain,
      game: gameBlock(packProfile, packFrom),
      requested: files.length,
      derived,
      ...(autoNote !== undefined ? { autoNote } : {}),
      filesBefore,
      filesAfter,
      added: filesAfter - filesBefore,
      bytesBefore,
      bytesAfter,
      exitCode: run.code,
      // The exit code is not the oracle: what matters is that the pakfile grew by what
      // was asked for.
      ok: filesAfter - filesBefore === files.length,
      missingSources,
      stdoutTail: clip(run.stdout.split(/\r?\n/).slice(-20).join("\n"), 2000),
    };
  },
});

export const readNav = defineTool({
  name: "read_nav",
  description:
    "Reads a .nav mesh header and says whether it still matches its map. The engine " +
    "compares the BSP size recorded in the mesh against the map it is loading, and a " +
    "mismatch means the mesh is silently unusable -- in game that looks like Nextbots " +
    "that will not path, with nothing in the console explaining why. Recompiling a map " +
    "always invalidates its nav, so check this after any compile. Generating a new one " +
    "needs the engine (nav_generate); there is no offline generator, in this project or " +
    "anywhere public.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .nav, or the .bsp beside it."),
  },
  outputSchema: {
    path: z.string(),
    fileBytes: z.number(),
    version: z.number(),
    subVersion: z.number().nullable(),
    savedBspSize: z.number(),
    actualBspSize: z.number().nullable(),
    matchesBsp: z.boolean().nullable(),
    verdict: z.string(),
    isAnalyzed: z.boolean().nullable(),
    placeCount: z.number().nullable(),
    areaCount: z.number().nullable(),
    bsp: z.string().nullable(),
  },
  handler: (args, ctx) => {
    const given = resolveInput(args.path, ctx.config);
    const stem = join(dirname(given), basename(given, extname(given)));
    const nav = extname(given).toLowerCase() === ".nav" ? given : `${stem}.nav`;
    const bsp = `${stem}.bsp`;
    return { ...checkNavFreshness(nav, existsSync(bsp) ? bsp : null) };
  },
});

export const compileTools = [runCompile, readCompileLog, readLeak, runPack, readNav];

