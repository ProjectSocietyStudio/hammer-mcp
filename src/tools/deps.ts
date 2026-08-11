import { z } from "zod";
import { gameBlock, gameFor } from "../games/resolve.js";
import { defineTool } from "../mcp/registry.js";
import { callSidecar } from "../sidecar/client.js";
import { GAME, GAME_BLOCK, resolveInput } from "./paths.js";

const MissingAsset = z.object({
  path: z.string(),
  kind: z.string().describe("material, texture, model, detail-config, nodegraph-name-mismatch, ..."),
  referencedBy: z.string(),
});

export const readMapDependenciesTool = defineTool({
  name: "read_map_dependencies",
  description:
    "Every asset a compiled map references, and where each will come from at runtime: " +
    "packed inside the map, found in the game's own content, or missing. Missing is the " +
    "purple checkerboard -- the only failure on this list a mapper never sees at home, " +
    "because they have the files. The walk is recursive on purpose: it follows VMT patch " +
    "and include chains, $bottommaterial and $fallbackmaterial, a model's own material " +
    "list, the skybox's six sides and the detail sprite config. Resolving one level gives " +
    "a short, plausible, wrong answer. Also separates what is packed but never reached " +
    "into three groups, because 'unreferenced' is not 'safe to delete': vrad's own output " +
    "(.vhv, cubemaps) is referenced by the engine and named by no file. Needs the Python " +
    "sidecar; see health.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .bsp, absolute or relative to the repo root."),
    game: GAME,
    limit: z.number().optional().describe("Maximum entries per list. Default 300."),
  },
  outputSchema: {
    path: z.string(),
    game: GAME_BLOCK,
    /** Materials named by the map's own texture table, tool materials excluded. */
    materialCount: z.number(),
    /** Models named by a brush or point entity. */
    modelCount: z.number(),
    /** Models placed as prop_static, which live in the GAME_LUMP and no other reader here sees. */
    staticPropModelCount: z.number(),
    staticPropError: z.string().nullable(),
    gameMounted: z.boolean(),
    gameError: z.string().nullable(),
    resolved: z.number(),
    bySource: z.record(z.string(), z.number()).describe("How many resolved as packed, and as game."),
    missing: z.array(MissingAsset),
    missingCount: z.number(),
    missingTruncated: z.boolean(),
    /** Packed, reached by nothing, and not explainable: the real dead weight. */
    packedUnreferenced: z.array(z.string()),
    packedUnreferencedCount: z.number(),
    /** Packed and referenced by the engine itself: .vhv, built cubemaps. Never delete these. */
    engineOwnedCount: z.number(),
    /** Packed under a prefix this walk does not follow: sound, scripts, particles. */
    notWalkedCount: z.number(),
    notWalked: z.array(z.string()),
    /** Models with no .phy. A prop with no collision hull is a choice, not an error. */
    optionalAbsent: z.array(z.string()),
    caveat: z.string(),
  },
  handler: async (args, ctx) => {
    const { game, from } = gameFor(ctx.config, args.game);
    const reply = await callSidecar<Record<string, unknown>>(
      "map_dependencies",
      {
        path: resolveInput(args.path, ctx.config),
        gameDir: game.gameDir ?? ctx.config.gmodGameDir,
        limit: args.limit ?? 300,
      },
      ctx.config,
      600_000,
    );

    return {
      ...reply,
      game: gameBlock(game, from),
      caveat:
        "An asset resolved as `game` ships only if the player has that game mounted -- a " +
        "Counter-Strike texture is fine on a machine with CS:S and a checkerboard on one " +
        "without, so `game` is not the same answer as `packed`. And `packedUnreferenced` " +
        "means this walk did not reach it, which is weaker than unused: sounds, particles " +
        "and scripts are counted separately under notWalked precisely because they are not " +
        "followed. Nothing here is a delete list.",
    };
  },
});

export const depsTools = [readMapDependenciesTool];
