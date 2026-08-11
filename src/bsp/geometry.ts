import { LUMP_NAMES, readHeader } from "./header.js";
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
  bytes?: number;
  /**
   * Record size per lump version, for structs whose shape changed between them.
   *
   * `dleaf_t` is the case this exists for: version 0 carries an inline
   * `CompressedLightCube` and measures 56 bytes, version 1 moved that lighting into its
   * own lump and measures 32. Hard-coding either counts every map of the other version
   * wrongly -- and since practically every modern map is version 1, hard-coding 32 passes
   * every test anyone is likely to run.
   *
   * A version absent from this table yields no count and says so, rather than falling
   * back to whichever size happens to be listed.
   */
  bytesByVersion?: Readonly<Record<number, number>>;
  limit?: number;
  limitName?: string;
}

export const LUMP_SPECS: readonly LumpSpec[] = [
  { index: 0, limit: 8192, limitName: "MAX_MAP_ENTITIES" },
  { index: 1, bytes: 20, limit: 65536, limitName: "MAX_MAP_PLANES" },
  { index: 2, bytes: 32, limit: 2048, limitName: "MAX_MAP_TEXDATA" },
  { index: 3, bytes: 12, limit: 65536, limitName: "MAX_MAP_VERTS" },
  { index: 4 },
  { index: 5, bytes: 32, limit: 65536, limitName: "MAX_MAP_NODES" },
  { index: 6, bytes: 72, limit: 12288, limitName: "MAX_MAP_TEXINFO" },
  { index: 7, bytes: 56, limit: 65536, limitName: "MAX_MAP_FACES" },
  { index: 8 },
  { index: 9 },
  { index: 10, bytesByVersion: { 0: 56, 1: 32 }, limit: 65536, limitName: "MAX_MAP_LEAFS" },
  { index: 11 },
  { index: 12, bytes: 4, limit: 256000, limitName: "MAX_MAP_EDGES" },
  { index: 13, bytes: 4, limit: 512000, limitName: "MAX_MAP_SURFEDGES" },
  { index: 14, bytes: 48, limit: 1024, limitName: "MAX_MAP_MODELS" },
  { index: 15, bytes: 88, limit: 8192, limitName: "MAX_MAP_WORLDLIGHTS" },
  { index: 16, bytes: 2, limit: 65536, limitName: "MAX_MAP_LEAFFACES" },
  { index: 17, bytes: 2, limit: 65536, limitName: "MAX_MAP_LEAFBRUSHES" },
  { index: 18, bytes: 12, limit: 8192, limitName: "MAX_MAP_BRUSHES" },
  { index: 19, bytes: 8, limit: 65536, limitName: "MAX_MAP_BRUSHSIDES" },
  { index: 20, bytes: 8, limit: 256, limitName: "MAX_MAP_AREAS" },
  { index: 21, bytes: 12, limit: 1024, limitName: "MAX_MAP_AREAPORTALS" },
  { index: 22, bytes: 176, limit: 2048, limitName: "MAX_MAP_DISPINFO" },
  { index: 23, bytes: 56 },
  { index: 26, bytes: 20 },
  { index: 35 },
  { index: 40 },
  { index: 42, bytes: 16, limit: 1024, limitName: "MAX_MAP_CUBEMAPSAMPLES" },
  { index: 43, limit: 256000, limitName: "MAX_MAP_TEXDATA_STRING_DATA" },
  { index: 44, bytes: 4, limit: 65536 },
  { index: 45, bytes: 352, limit: 512, limitName: "MAX_MAP_OVERLAYS" },
  { index: 53 },
  { index: 58, bytes: 56 },
];

export interface LumpReport {
  index: number;
  name: string;
  bytes: number;
  megabytes: number;
  /** Individually LZMA-compressed. When true, `bytes` counts compressed bytes. */
  compressed: boolean;
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
    if (lump.compressed) {
      // Checked BEFORE divisibility, and it is not the same guard. `length` here counts
      // COMPRESSED bytes, so dividing it by a record size is meaningless -- and only
      // sometimes obviously so, since a compressed length lands on a multiple of the
      // record size roughly one time in `bytes`. The divisibility check alone would let
      // those through as a plausible, wrong count.
      note =
        `lump is LZMA-compressed, so no record count can be given without decompressing. ` +
        `It declares ${lump.declaredUncompressedBytes} uncompressed bytes -- declared in ` +
        `its header, not verified here.`;
    } else if (
      spec.bytesByVersion !== undefined &&
      spec.bytesByVersion[lump.version] === undefined
    ) {
      note =
        `lump version ${lump.version} is not one this reader knows for lump ${spec.index} ` +
        `(known: ${Object.keys(spec.bytesByVersion).join(", ")}); no record size applies, ` +
        `so no count is given`;
    } else {
      const recordBytes = spec.bytesByVersion?.[lump.version] ?? spec.bytes;
      if (recordBytes !== undefined) {
        if (lump.length % recordBytes === 0) {
          count = lump.length / recordBytes;
        } else {
          // Reporting length/bytes anyway would produce a plausible wrong number, which
          // is worse than none.
          note =
            `${lump.length} bytes is not a multiple of the expected ${recordBytes}-byte ` +
            `record; the layout differs in this BSP version`;
        }
      }
    }

    const report: LumpReport = {
      index: spec.index,
      // Never a second hand-written list: one table, in header.ts, read from bspfile.h.
      name: LUMP_NAMES[spec.index] ?? `LUMP_${spec.index}`,
      bytes: lump.length,
      megabytes: Math.round((lump.length / 1048576) * 100) / 100,
      compressed: lump.compressed,
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
