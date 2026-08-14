import { readFileSync } from "node:fs";
import { IMAGE_KEY } from "@projectsociety/mcp-core";
import { z } from "zod";
import { defineTool } from "../mcp/registry.js";
import { encodePng } from "../render/png.js";
import { frameBox, render } from "../render/raster.js";
import { contactSheet } from "../render/sheet.js";
import type { Tile } from "../render/sheet.js";
import { anglesTowards } from "../render/camera.js";
import type { Camera } from "../render/camera.js";
import { buildScene } from "../space/scene.js";
import type { Scene } from "../space/scene.js";
import { eyeAt } from "../space/measure.js";
import { findRooms } from "../space/rooms.js";
import { pointInSolid } from "../space/trace.js";
import { voxelise } from "../space/voxel.js";
import { readEntities } from "../vmf/edit.js";
import type { Vec3 } from "../vmf/solid.js";
import { resolveInput } from "./paths.js";
import { seedsFor } from "./scene.js";

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
    lookAt: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Aim at this point instead of giving angles. Overrides `angles`."),
    lookAtEntity: z
      .string()
      .optional()
      .describe("Aim at this targetname's origin. Overrides `angles` and `lookAt`."),
    stand: z
      .boolean()
      .default(false)
      .describe(
        "Put the eye where a standing player's would be: drop to the floor under `origin` " +
          "and rise to eye height. Use this rather than guessing a z.",
      ),
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
    // Standing first, then any explicit lift, then the aim -- in that order, because a
    // camera aimed before it is moved points at the wrong thing. This is the same fix #55
    // made to `measure_vmf_clearance`, carried to the tool that shows the result: a point on
    // the floor puts the eye in the floor, and the picture is the inside of a slab.
    if (args.stand) {
      const stood = eyeAt(scene, origin);
      if (stood[2] !== origin[2]) {
        notes.push(
          `Stood up: the eye moved from z ${Math.round(origin[2])} to ${Math.round(stood[2])}, ` +
            `which is Source's own eye height above the floor under that point.`,
        );
      }
      origin = stood;
    }
    if (args.eyeHeight !== 0) origin = [origin[0], origin[1], origin[2] + args.eyeHeight];

    const target = args.lookAtEntity
      ? (originOf(source, args.lookAtEntity) ??
        (() => {
          throw new Error(
            `no entity named ${JSON.stringify(args.lookAtEntity)} has an origin in ${path}. ` +
              `read_entity_report lists what the map does have.`,
          );
        })())
      : ((args.lookAt as unknown as Vec3 | undefined) ?? null);
    if (target) angles = anglesTowards(origin, target);

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

/** How many frames a sheet carries before it stops being readable at a result's size. */
const MAX_TILES = 9;

export const renderVmfTourTool = defineTool({
  name: "render_vmf_tour",
  description:
    "Walks a .vmf and returns one picture of the whole place: a contact sheet of eye-height " +
    "views, one per room and one from each side of every doorway, worked out from the map " +
    "rather than from cameras you supply. This exists because of a measurement -- across " +
    "three sessions in which cold agents built the same map end to end, render_vmf_view was " +
    "called once between them, and the map that passed every check had a door painted flat " +
    "on a wall, counters that were single boxes and no skirting anywhere. None of that is " +
    "visible to any check and all of it is obvious in one look. Cameras stand where a player " +
    "would, via the same floor-finding measure_vmf_clearance uses, so no frame is the inside " +
    "of a slab. When the room pass finds nothing to walk it falls back to the spawn and an " +
    "outside view, and says so rather than returning an empty sheet.",
  realm: "map",
  inputSchema: {
    path: z.string().describe("Path to the .vmf, absolute or relative to the repo root."),
    step: z
      .number()
      .int()
      .min(4)
      .max(256)
      .default(16)
      .describe("Cell size for the room pass. Vary it if the rooms come out wrong; see building.md."),
    maxCells: z.number().int().min(1000).max(64_000_000).default(4_000_000),
    minRoomArea: z.number().default(4096).describe("Square units below which a region is not a room."),
    fov: z.number().min(10).max(150).default(90),
    width: z.number().int().min(64).max(512).default(320).describe("Per frame, not per sheet."),
    height: z.number().int().min(64).max(512).default(240),
  },
  outputSchema: {
    path: z.string(),
    /** One per frame, in the order they appear on the sheet, left to right and top down. */
    views: z.array(
      z.object({
        label: z.string(),
        origin: z.array(z.number()),
        angles: z.array(z.number()),
        skyFraction: z.number(),
        insideSolid: z.boolean(),
      }),
    ),
    roomCount: z.number(),
    portalCount: z.number(),
    columns: z.number(),
    rows: z.number(),
    /** Named rather than silently dropped: a capped sheet must say what it did not show. */
    omitted: z.array(z.string()),
    notes: z.array(z.string()),
    pngBytes: z.number(),
  },
  handler: (args, ctx) => {
    const path = resolveInput(args.path, ctx.config);
    const source = readFileSync(path, "utf8");
    const scene = sceneFor(path);
    const notes: string[] = [];

    const { seeds, note } = seedsFor(source, scene, undefined);
    if (note) notes.push(note);
    const grid = voxelise(scene, seeds, { step: args.step, maxCells: args.maxCells });
    const { rooms, portals } = findRooms(grid, { minRoomArea: args.minRoomArea });

    /** Where to stand and what to face, before anything is drawn. */
    const wanted: { label: string; from: Vec3; at: Vec3 }[] = [];

    for (const room of rooms) {
      // Along the room's longer side, from its widest point: the view that shows the most of
      // a rectangular room, which is what almost every interior is.
      const spanX = room.maxs[0] - room.mins[0];
      const spanY = room.maxs[1] - room.mins[1];
      const at: Vec3 =
        spanX >= spanY
          ? [room.maxs[0], room.centre[1], room.centre[2]]
          : [room.centre[0], room.maxs[1], room.centre[2]];
      wanted.push({
        label: `ROOM ${room.id} - ${room.floorAreaSquareMetres.toFixed(1)}m2`,
        from: room.centre,
        at,
      });
    }

    for (const portal of portals) {
      // From inside each of the two rooms, looking at the col between them. Derived from the
      // room centres rather than from a normal, which a portal does not carry: a point part
      // way from the centre to the col is inside the room by construction.
      for (const id of portal.between) {
        const room = rooms.find((r) => r.id === id);
        if (!room) continue;
        const from: Vec3 = [
          room.centre[0] + (portal.at[0] - room.centre[0]) * 0.5,
          room.centre[1] + (portal.at[1] - room.centre[1]) * 0.5,
          room.centre[2],
        ];
        wanted.push({
          label: `DOOR ${portal.between[0]}-${portal.between[1]} FROM ${id}`,
          from,
          at: portal.at,
        });
      }
    }

    if (wanted.length === 0) {
      // The room pass finding nothing is a real state and a common one -- the segmentation
      // is a fact about the voxel grid rather than about the map, and #48 is open. An empty
      // sheet would read as "there is nothing here", which is a different and wrong claim.
      notes.push(
        `The room pass found nothing to walk at step ${args.step}, so this is the spawn and ` +
          `an outside view instead. That is usually the segmentation rather than the map -- ` +
          `vary step before touching geometry.`,
      );
      const spawn = originOf(source, "") ?? null;
      const centre: Vec3 = [
        (scene.mins[0] + scene.maxs[0]) / 2,
        (scene.mins[1] + scene.maxs[1]) / 2,
        (scene.mins[2] + scene.maxs[2]) / 2,
      ];
      wanted.push({ label: "SPAWN", from: seeds[0] ?? spawn ?? centre, at: centre });
    }

    const omitted = wanted.slice(MAX_TILES).map((w) => w.label);
    if (omitted.length > 0) {
      notes.push(
        `${omitted.length} view(s) past the ${MAX_TILES} a sheet holds are named in ` +
          `\`omitted\` rather than dropped quietly. render_vmf_view takes any of them one at a time.`,
      );
    }

    const views: {
      label: string;
      origin: number[];
      angles: number[];
      skyFraction: number;
      insideSolid: boolean;
    }[] = [];
    const tiles: Tile[] = [];

    for (const w of wanted.slice(0, MAX_TILES)) {
      const origin = eyeAt(scene, w.from);
      const angles = anglesTowards(origin, [w.at[0], w.at[1], origin[2]]);
      const camera: Camera = {
        origin,
        angles,
        fov: args.fov,
        width: args.width,
        height: args.height,
        near: 4,
      };
      const fb = render(scene, camera);
      let sky = 0;
      for (let i = 0; i < fb.ids.length; i++) if (fb.ids[i] === -1) sky += 1;
      views.push({
        label: w.label,
        origin: [...origin],
        angles: [...angles],
        skyFraction: Math.round((sky / fb.ids.length) * 1000) / 1000,
        insideSolid: pointInSolid(scene, origin) !== null,
      });
      tiles.push({ label: w.label, frame: fb });
    }

    const buried = views.filter((v) => v.insideSolid).map((v) => v.label);
    if (buried.length > 0) {
      notes.push(
        `${buried.join(", ")}: the eye came out inside a brush even after standing up. ` +
          `That is a frame of the inside of a wall, not of the room.`,
      );
    }
    notes.push(
      `Flat colour, one light, no textures, lightmaps, fog or props. This shows form and ` +
        `occlusion, not what the place looks like.`,
    );

    const sheet = contactSheet(tiles);
    const png = encodePng(sheet.rgb, sheet.width, sheet.height);

    return {
      path,
      views,
      roomCount: rooms.length,
      portalCount: portals.length,
      columns: sheet.columns,
      rows: sheet.rows,
      omitted,
      notes,
      pngBytes: png.length,
      [IMAGE_KEY]: { data: png.toString("base64"), mimeType: "image/png" },
    };
  },
});

export const renderTools = [renderVmfViewTool, renderVmfTourTool];
