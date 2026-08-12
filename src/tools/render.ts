import { readFileSync } from "node:fs";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { encodePng } from "../render/png.js";
import { frameBox, render } from "../render/raster.js";
import type { Camera } from "../render/camera.js";
import { buildScene } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { pointInSolid } from "../space/trace.js";
import { readEntities } from "../vmf/edit.js";
import type { Vec3 } from "../vmf/solid.js";
import { resolveInput } from "./paths.js";

const cache = new Map<string, { source: string; scene: Scene }>();

function sceneFor(path: string): Scene {
  const source = readFileSync(path, "utf8");
  const hit = cache.get(path);
  if (hit && hit.source === source) return hit.scene;
  const scene = buildScene(path, source);
  cache.set(path, { source, scene });
  return scene;
}

/** An entity's origin, for `fromEntity`. */
function originOf(source: string, targetname: string): Vec3 | null {
  const { entities } = readEntities(source);
  const want = targetname.toLowerCase();
  for (const e of entities) {
    if ((e.targetname ?? "").toLowerCase() !== want) continue;
    const raw = e.block.entries.find((n) => n.kind === "pair" && n.key === "origin");
    if (!raw || raw.kind !== "pair") continue;
    const parts = raw.value.trim().split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!];
    }
  }
  return null;
}

export const renderVmfViewTool = defineTool({
  name: "render_vmf_view",
  description:
    "Renders a .vmf from a camera and returns the picture, so the shape of a place can be " +
    "LOOKED at rather than inferred from coordinates. Flat colour per face, one light, no " +
    "textures and no props: it shows form and occlusion -- what stands where, what hides " +
    "what, how much room there is at eye height -- and it deliberately does not show " +
    "atmosphere, which only a capture from the running game can. Camera convention is " +
    "Source's own (x forward, y left, z up; angles pitch/yaw/roll; fov horizontal), the " +
    "same one gmod-mcp's read_view reports, so a rendering and an in-game capture from the " +
    "same numbers frame the same thing. A face's colour is a stable hash of its material, " +
    "so the same wall is the same colour in two renderings an edit apart.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    origin: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Eye position. Omit with `fromEntity`, or with neither to frame the whole map."),
    angles: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Pitch, yaw, roll in degrees. Positive pitch looks down, as Source means it."),
    fromEntity: z
      .string()
      .optional()
      .describe("Stand at this targetname's origin -- an info_player_start, say."),
    eyeHeight: z
      .number()
      .default(0)
      .describe("Added to the origin's z. 64 is Source's standing eye height."),
    fov: z.number().min(10).max(150).default(90).describe("Horizontal field of view."),
    width: z.number().int().min(64).max(1024).default(480),
    height: z.number().int().min(64).max(1024).default(360),
    near: z.number().positive().default(4),
  },
  outputSchema: {
    path: z.string(),
    origin: z.array(z.number()),
    angles: z.array(z.number()),
    fov: z.number(),
    width: z.number(),
    height: z.number(),
    facesDrawn: z.number(),
    facesCulled: z.number(),
    facesBehind: z.number(),
    /** Fraction of the frame with no geometry: 1 means the camera is looking at nothing. */
    skyFraction: z.number(),
    insideSolid: z
      .boolean()
      .describe("The eye is inside a brush, so the picture is the inside of a wall."),
    brushCount: z.number(),
    notes: z.array(z.string()),
    pngBytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const scene = sceneFor(path);

    let origin: Vec3;
    let angles: Vec3;
    const notes: string[] = [];

    if (args.fromEntity) {
      const found = originOf(source, args.fromEntity);
      if (!found) {
        throw new Error(
          `no entity named ${JSON.stringify(args.fromEntity)} has an origin in ${path}. ` +
            `read_entity_report lists what the map does have.`,
        );
      }
      origin = found;
      angles = (args.angles as unknown as Vec3) ?? [0, 0, 0];
    } else if (args.origin) {
      origin = args.origin as unknown as Vec3;
      angles = (args.angles as unknown as Vec3) ?? [0, 0, 0];
    } else {
      // Nothing said: frame the whole map from above and to one side, which is the view a
      // mapper opens a strange file with.
      const framed = frameBox(scene.mins, scene.maxs, { fov: args.fov, width: args.width, height: args.height }, 45, 35);
      origin = framed.origin;
      angles = framed.angles;
      notes.push(
        `No camera given, so the whole map is framed from outside at yaw 45, pitch 35. ` +
          `Pass origin and angles, or fromEntity, to stand somewhere.`,
      );
    }
    if (args.eyeHeight !== 0) origin = [origin[0], origin[1], origin[2] + args.eyeHeight];

    const camera: Camera = {
      origin,
      angles,
      fov: args.fov,
      width: args.width,
      height: args.height,
      near: args.near,
    };

    const fb = render(scene, camera);
    const png = encodePng(fb.rgb, fb.width, fb.height);

    let sky = 0;
    for (let i = 0; i < fb.ids.length; i++) if (fb.ids[i] === -1) sky += 1;
    const skyFraction = Math.round((sky / fb.ids.length) * 1000) / 1000;

    if (skyFraction > 0.95) {
      notes.push(
        `${Math.round(skyFraction * 100)}% of the frame has no geometry. The camera is ` +
          `probably outside the map or facing away from it.`,
      );
    }
    if (scene.excluded.displacement > 0) {
      notes.push(
        `${scene.excluded.displacement} displacement brush(es) are not drawn: their flat ` +
          `quad is not the surface the game builds, so drawing it would show terrain that ` +
          `does not exist.`,
      );
    }
    notes.push(
      `Flat colour, one light, no textures, lightmaps, fog or props. This shows form and ` +
        `occlusion; it does not show what the place looks like. For that, compile it and ` +
        `capture it in game -- gmod-mcp, not this server.`,
    );

    // Asked of the engine rather than guessed from the picture. A camera inside a wall
    // renders a frame that looks empty, and so does a camera pointing at the sky; telling
    // them apart from pixel counts would be inventing a rule where there is an answer.
    const insideSolid = pointInSolid(scene, origin) !== null;
    if (insideSolid) {
      notes.push(
        `The eye is inside a brush, so this is the inside of a wall. read_vmf_nearest_surface ` +
          `says how far the nearest open space is.`,
      );
    }

    return {
      path,
      origin: [...origin],
      angles: [...angles],
      fov: args.fov,
      width: fb.width,
      height: fb.height,
      facesDrawn: fb.facesDrawn,
      facesCulled: fb.facesCulled,
      facesBehind: fb.facesBehind,
      skyFraction,
      insideSolid,
      brushCount: scene.brushes.length,
      notes,
      pngBytes: png.length,
      [IMAGE_KEY]: { data: png.toString("base64"), mimeType: "image/png" },
    };
  },
});

export const renderTools = [renderVmfViewTool];
