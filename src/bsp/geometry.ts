import { readHeader } from "./header.js";
import type { BspHeader } from "./header.js";

/**
 * Per-lump struct size and compile-time ceiling.
 *
 * The limits come from `src/public/bspfile.h` of source-sdk-2013, read on 11/08/2026 --
 * not from the wiki, which paraphrases them and disagrees with itself between games.
 * They are vbsp's limits: a shipped map that sits near one is a map that cannot grow,
 * which is the useful thing to know before planning work on it.
 *
 * `bytes` is the on-disk size of one record. Several of these structures changed shape
 * between BSP versions, so a size is never trusted blind: `countLumps` only reports a
 * count when the lump length divides exactly by it, and says so when it does not.
 */
export interface LumpSpec {
  index: number;
  name: string;
  bytes?: number;
  limit?: number;
  limitName?: string;
}

export const LUMP_SPECS: readonly LumpSpec[] = [
  { index: 0, name: "ENTITIES", limit: 8192, limitName: "MAX_MAP_ENTITIES" },
  { index: 1, name: "PLANES", bytes: 20, limit: 65536, limitName: "MAX_MAP_PLANES" },
  { index: 2, name: "TEXDATA", bytes: 32, limit: 2048, limitName: "MAX_MAP_TEXDATA" },
  { index: 3, name: "VERTEXES", bytes: 12, limit: 65536, limitName: "MAX_MAP_VERTS" },
  { index: 4, name: "VISIBILITY" },
  { index: 5, name: "NODES", bytes: 32, limit: 65536, limitName: "MAX_MAP_NODES" },
  { index: 6, name: "TEXINFO", bytes: 72, limit: 12288, limitName: "MAX_MAP_TEXINFO" },
  { index: 7, name: "FACES", bytes: 56, limit: 65536, limitName: "MAX_MAP_FACES" },
  { index: 8, name: "LIGHTING" },
  { index: 9, name: "OCCLUSION" },
  { index: 10, name: "LEAFS", limit: 65536, limitName: "MAX_MAP_LEAFS" },
  { index: 11, name: "FACEIDS" },
  { index: 12, name: "EDGES", bytes: 4, limit: 256000, limitName: "MAX_MAP_EDGES" },
  { index: 13, name: "SURFEDGES", bytes: 4, limit: 512000, limitName: "MAX_MAP_SURFEDGES" },
  { index: 14, name: "MODELS", bytes: 48, limit: 1024, limitName: "MAX_MAP_MODELS" },
  { index: 15, name: "WORLDLIGHTS", bytes: 88, limit: 8192, limitName: "MAX_MAP_WORLDLIGHTS" },
  { index: 16, name: "LEAFFACES", bytes: 2, limit: 65536, limitName: "MAX_MAP_LEAFFACES" },
  { index: 17, name: "LEAFBRUSHES", bytes: 2, limit: 65536, limitName: "MAX_MAP_LEAFBRUSHES" },
  { index: 18, name: "BRUSHES", bytes: 12, limit: 8192, limitName: "MAX_MAP_BRUSHES" },
  { index: 19, name: "BRUSHSIDES", bytes: 8, limit: 65536, limitName: "MAX_MAP_BRUSHSIDES" },
  { index: 20, name: "AREAS", bytes: 8, limit: 256, limitName: "MAX_MAP_AREAS" },
  { index: 21, name: "AREAPORTALS", bytes: 12, limit: 1024, limitName: "MAX_MAP_AREAPORTALS" },
  { index: 22, name: "DISPINFO", bytes: 176, limit: 2048, limitName: "MAX_MAP_DISPINFO" },
  { index: 23, name: "ORIGINALFACES", bytes: 56 },
  { index: 26, name: "DISP_VERTS", bytes: 20 },
  { index: 35, name: "GAME_LUMP" },
  { index: 40, name: "PAKFILE" },
  { index: 42, name: "CUBEMAPS", bytes: 16, limit: 1024, limitName: "MAX_MAP_CUBEMAPSAMPLES" },
  { index: 43, name: "TEXDATA_STRING_DATA", limit: 256000, limitName: "MAX_MAP_TEXDATA_STRING_DATA" },
  { index: 44, name: "TEXDATA_STRING_TABLE", bytes: 4, limit: 65536 },
  { index: 45, name: "OVERLAYS", bytes: 352, limit: 512, limitName: "MAX_MAP_OVERLAYS" },
  { index: 53, name: "LIGHTING_HDR" },
  { index: 58, name: "FACES_HDR", bytes: 56 },
];

export interface LumpReport {
  index: number;
  name: string;
  bytes: number;
  megabytes: number;
  /** Records, when the struct size is known and divides the lump exactly. */
  count: number | null;
  limit?: number;
  limitName?: string;
  /** Fraction of the compile-time ceiling used, when both are known. */
  usedFraction?: number;
  /** Set when a count could not be derived, and why. */
  note?: string;
}

export interface GeometryReport {
  header: BspHeader;
  lumps: LumpReport[];
  /** Lumps at or above 80% of their ceiling: what stops this map from growing. */
  nearLimit: LumpReport[];
}

/**
 * Counts what each lump holds, and how close that is to vbsp's ceiling.
 *
 * Reads no lump body: the directory in the first 1036 bytes carries every length, so
 * this is instant on a 1 GB map.
 */
export function readGeometry(path: string): GeometryReport {
  const header = readHeader(path);
  const lumps: LumpReport[] = [];

  for (const spec of LUMP_SPECS) {
    const lump = header.lumps[spec.index];
    if (!lump || lump.length === 0) continue;

    let count: number | null = null;
    let note: string | undefined;
    if (spec.bytes !== undefined) {
      if (lump.length % spec.bytes === 0) {
        count = lump.length / spec.bytes;
      } else {
        // The struct changed shape in this BSP version. Reporting length/bytes anyway
        // would produce a plausible wrong number, which is worse than none.
        note =
          `${lump.length} bytes is not a multiple of the expected ${spec.bytes}-byte ` +
          `record; the layout differs in this BSP version`;
      }
    }

    const report: LumpReport = {
      index: spec.index,
      name: spec.name,
      bytes: lump.length,
      megabytes: Math.round((lump.length / 1048576) * 100) / 100,
      count,
      ...(spec.limit !== undefined ? { limit: spec.limit } : {}),
      ...(spec.limitName ? { limitName: spec.limitName } : {}),
      ...(note ? { note } : {}),
    };
    if (count !== null && spec.limit !== undefined) {
      report.usedFraction = Math.round((count / spec.limit) * 1000) / 1000;
      if (count > spec.limit) {
        // Measured on rp_nycity_day, which ships 1218 models against a stock ceiling
        // of 1024 and loads fine. A shipped map that exceeds a limit is evidence the
        // toolchain that built it raised that limit -- not evidence of a broken map.
        report.note =
          `exceeds the stock SDK 2013 ${spec.limitName ?? "limit"} of ${spec.limit}; ` +
          `the compilers that built this map raise it`;
      }
    }
    lumps.push(report);
  }

  return {
    header,
    lumps,
    nearLimit: lumps.filter((l) => (l.usedFraction ?? 0) >= 0.8),
  };
}
