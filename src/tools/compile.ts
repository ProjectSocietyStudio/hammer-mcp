import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { clip } from "@rolists/mcp-core";
import { z } from "zod";
import { parseCompileLog } from "../compile/log.js";
import { locateLeak, readPointfile } from "../compile/leak.js";
import { runCompiler, toWindowsPath } from "../compile/wine.js";
import { readEntityLump } from "../bsp/entities.js";
import { parseEntityText } from "../bsp/entities.js";
import { assertWritable } from "../fs/guard.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { resolveInput } from "./paths.js";

const FINDING = z.object({
  severity: z.string(),
  rule: z.string(),
  message: z.string(),
  line: z.string(),
});

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
    timeoutMinutes: z.number().int().min(1).max(600).default(60),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    vmf: z.string(),
    bsp: z.string(),
    bspExists: z.boolean(),
    bspBytes: z.number().nullable(),
    stages: z.array(STAGE_RESULT),
    leaked: z.boolean(),
    pointfile: z.string().nullable(),
    ok: z.boolean(),
  },
  handler: async (args, ctx) => {
    const vmf = resolveInput(args.vmf, ctx.config);
    if (!existsSync(vmf)) throw new Error(`${vmf} does not exist`);
    if (extname(vmf).toLowerCase() !== ".vmf") throw new Error(`${vmf} is not a .vmf`);

    // The compilers write the .bsp beside the source, so that is a write we own.
    const bsp = join(dirname(vmf), `${basename(vmf, ".vmf")}.bsp`);
    assertWritable(bsp, ctx.config);

    const game = toWindowsPath(ctx.config.gmodGameDir);
    const target = toWindowsPath(vmf);
    const timeoutMs = args.timeoutMinutes * 60_000;

    const plans: Record<string, { exe: string; argv: string[] }> = {
      vbsp: { exe: "vbsp.exe", argv: ["-game", game, target] },
      vvis: { exe: "vvis.exe", argv: [...(args.fast ? ["-fast"] : []), "-game", game, target] },
      vrad: {
        exe: "vrad.exe",
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
      ctx.audit.record({ kind: "compile_start", data: { stage, vmf } });
      const run = await runCompiler(ctx.config, plan.exe, plan.argv, timeoutMs);
      const report = parseCompileLog(`${run.stdout}\n${run.stderr}`);
      ctx.audit.record({
        kind: "compile_end",
        data: { stage, exitCode: run.code, clean: report.clean, ms: run.durationMs },
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
    "guarantee which end holds the entity -- on a two-point pointfile it was the last.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("The .lin pointfile, or the .vmf/.bsp it sits beside."),
    limit: z.number().int().min(1).max(50).default(5),
  },
  outputSchema: {
    pointfile: z.string(),
    pointCount: z.number(),
    start: z.array(z.number()),
    end: z.array(z.number()),
    spanUnits: z.number(),
    correlatedAgainst: z.string().nullable(),
    nearestToStart: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ),
    nearestToEnd: z.array(
      z.object({
        index: z.number(),
        id: z.number().optional(),
        classname: z.string(),
        targetname: z.string().optional(),
        origin: z.array(z.number()),
        distanceUnits: z.number(),
      }),
    ),
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
      .nullable(),
    points: z.array(z.object({ point: z.array(z.number()), index: z.number() })),
  },
  handler: async (args, ctx) => {
    const given = resolveInput(args.path, ctx.config);
    const stem = join(dirname(given), basename(given, extname(given)));
    const pointfile = extname(given).toLowerCase() === ".lin" ? given : `${stem}.lin`;
    const points = readPointfile(pointfile);

    // Entities come from whichever companion file exists: the .bsp if the map compiled
    // far enough to produce one, otherwise the .vmf through the sidecar.
    const bsp = `${stem}.bsp`;
    const vmf = `${stem}.vmf`;
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
      correlatedAgainst,
    };
  },
});



export const runPack = defineTool({
  name: "run_pack",
  description:
    "Packs files into a compiled .bsp with bspzip, so custom assets ship with the map " +
    "instead of appearing as purple checkerboards on every client that lacks them. " +
    "Takes explicit pairs of in-game path and source file -- it does not guess what a " +
    "map references. Verifies afterwards by re-reading the pakfile: bspzip reports " +
    "success whether or not anything was added.",
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
      .min(1),
    confirm: z.boolean().default(false),
  },
  outputSchema: {
    bsp: z.string(),
    requested: z.number(),
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
    const bsp = assertWritable(resolveInput(args.bsp, ctx.config), ctx.config);
    if (!existsSync(bsp)) throw new Error(`${bsp} does not exist`);

    const missingSources = args.files
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
      args.files
        .flatMap((f) => [f.internal, resolveInput(f.source, ctx.config)])
        .join("\n") + "\n",
    );

    const run = await runCompiler(
      ctx.config,
      "bspzip.exe",
      [
        "-game",
        toWindowsPath(ctx.config.gmodGameDir),
        "-addlist",
        toWindowsPath(bsp),
        toWindowsPath(listPath),
        toWindowsPath(bsp),
      ],
      600_000,
    );

    const filesAfter = await countPak();
    const bytesAfter = statSync(bsp).size;

    return {
      bsp,
      requested: args.files.length,
      filesBefore,
      filesAfter,
      added: filesAfter - filesBefore,
      bytesBefore,
      bytesAfter,
      exitCode: run.code,
      // The exit code is not the oracle: what matters is that the pakfile grew by what
      // was asked for.
      ok: filesAfter - filesBefore === args.files.length,
      missingSources,
      stdoutTail: clip(run.stdout.split(/\r?\n/).slice(-20).join("\n"), 2000),
    };
  },
});

export const compileTools = [runCompile, readCompileLog, readLeak, runPack];
