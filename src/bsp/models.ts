import { LUMP_MODELS, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader } from "./header.js";

/**
 * One `dmodel_t`: 48 bytes, little-endian.
 *
 * mins[3] maxs[3] origin[3] as floats, then headnode, firstface and numfaces as int32.
 */
export const MODEL_BYTES = 48;

/**
 * Hammer units to metres.
 *
 * One unit is one inch. Not a convention we chose: it is the ratio that makes the
 * world model of `rp_nycity_day` come out at the 802 m the vehicles spec measured by
 * hand, and it is what the Valve dimensions tables assume throughout.
 */
export const METRES_PER_UNIT = 0.0254;

export interface BspModel {
  index: number;
  mins: [number, number, number];
  maxs: [number, number, number];
  origin: [number, number, number];
  headnode: number;
  firstFace: number;
  faceCount: number;
}

export interface ModelLump {
  header: BspHeader;
  models: BspModel[];
}

/**
 * Reads lump 14.
 *
 * Model 0 is the world; every other model is a brush entity's geometry, which is what a
 * `func_*` entity's `model` key (`*N`) points at. Reading this lump is how you learn a
 * map's real extent -- entity origins only tell you where things were placed, not how
 * far the world goes.
 */
export function readModels(path: string): ModelLump {
  const header = readHeader(path);
  const lump = requireLump(header, LUMP_MODELS);
  const raw = readAt(path, lump.offset, lump.length);

  const count = Math.floor(raw.length / MODEL_BYTES);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const models: BspModel[] = [];

  for (let i = 0; i < count; i++) {
    const at = i * MODEL_BYTES;
    const f = (o: number): number => view.getFloat32(at + o, true);
    models.push({
      index: i,
      mins: [f(0), f(4), f(8)],
      maxs: [f(12), f(16), f(20)],
      origin: [f(24), f(28), f(32)],
      headnode: view.getInt32(at + 36, true),
      firstFace: view.getInt32(at + 40, true),
      faceCount: view.getInt32(at + 44, true),
    });
  }

  return { header, models };
}

export interface MapExtents {
  mins: [number, number, number];
  maxs: [number, number, number];
  /** Width, depth and height in Hammer units. */
  sizeUnits: [number, number, number];
  sizeMetres: [number, number, number];
  /** Longest horizontal side, the number people mean by "how big is the map". */
  spanUnits: number;
  spanMetres: number;
  /** Ground area of the bounding box, in square metres. */
  areaSquareMetres: number;
}

/** Bounding box of the world model, which is model 0. */
export function worldExtents(lump: ModelLump): MapExtents {
  const world = lump.models[0];
  if (!world) {
    throw new Error(`${lump.header.path}: lump 14 holds no world model`);
  }
  const size: [number, number, number] = [
    world.maxs[0] - world.mins[0],
    world.maxs[1] - world.mins[1],
    world.maxs[2] - world.mins[2],
  ];
  const metres = size.map((u) => u * METRES_PER_UNIT) as [number, number, number];
  const round = (n: number): number => Math.round(n * 10) / 10;

  return {
    mins: world.mins,
    maxs: world.maxs,
    sizeUnits: size,
    sizeMetres: metres.map(round) as [number, number, number],
    spanUnits: Math.max(size[0], size[1]),
    spanMetres: round(Math.max(metres[0], metres[1])),
    areaSquareMetres: Math.round(metres[0] * metres[1]),
  };
}
