import { BspFormatError, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader, BspLump } from "./header.js";

const LUMP_LEAFS = 10;
const LUMP_VISIBILITY = 4;

/**
 * `dleaf_t` has two on-disk sizes, distinguished by the lump's own `version` field --
 * never by guessing from length, which the rest of this reader also refuses to do.
 *
 * Version 1 (32 bytes) is what every BSP version this server reads (19-21) actually
 * writes. Version 0 (56 bytes) carries an extra 24-byte `CompressedLightCube` field
 * between `leafWaterDataID` and the trailing padding -- present in some early Source
 * BSPs, absorbed here rather than refused, since the fields this reader needs (contents,
 * cluster, mins, maxs) sit at the same offsets in both.
 */
const LEAF_BYTES_V1 = 32;
const LEAF_BYTES_V0 = 56;

/** First four bytes of the `dvis_t` header: how many clusters the map was vis'd into. */
const VISIBILITY_HEADER_BYTES = 4;

export interface VisLeaf {
  index: number;
  contents: number;
  /** -1 means outside the PVS: normally a solid leaf, which owns no visible volume. */
  cluster: number;
  mins: [number, number, number];
  maxs: [number, number, number];
  volume: number;
}

export interface VisleafReport {
  header: BspHeader;
  leafVersion: number;
  leafBytes: number;
  leafCount: number;
  /** From the VISIBILITY lump's own header -- the authoritative count, not inferred. */
  clusterCount: number | null;
  visibilityBytes: number;
  noClusterLeafCount: number;
  leaves: VisLeaf[];
}

function guardLump(header: BspHeader, index: number, structBytes: number): BspLump {
  const lump = requireLump(header, index);
  if (lump.compressed) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is individually LZMA-compressed; ` +
        `refusing rather than decoding compressed bytes as records. It declares ` +
        `${lump.declaredUncompressedBytes} uncompressed bytes, not verified here.`,
    );
  }
  if (lump.length % structBytes !== 0) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is ${lump.length} bytes, not a ` +
        `multiple of the expected ${structBytes}-byte record; the layout differs in this ` +
        `BSP version`,
    );
  }
  return lump;
}

/**
 * Reads every leaf's bounding volume and cluster assignment, plus the map's real cluster
 * count from the VISIBILITY lump's own header.
 *
 * Handles both `dleaf_t` sizes rather than assuming one: version is read from the lump
 * directory, never guessed from length, because a 56-byte record happens to divide evenly
 * by 32 one time in 32 -- exactly the trap `read_map_geometry`'s divisibility guard exists
 * to catch, except here it would not even fire.
 *
 * Reads two lump bodies. On a 1 GB map, LEAFS alone is on the order of a couple of
 * megabytes -- nothing like the file itself.
 */
export function readVisleafStats(path: string): VisleafReport {
  const header = readHeader(path);
  const leafsLumpDir = header.lumps[LUMP_LEAFS];
  if (!leafsLumpDir) {
    throw new BspFormatError(`${header.path}: no LEAFS lump directory entry`);
  }
  const leafVersion = leafsLumpDir.version;
  const leafBytes =
    leafVersion === 1 ? LEAF_BYTES_V1 : leafVersion === 0 ? LEAF_BYTES_V0 : null;
  if (leafBytes === null) {
    throw new BspFormatError(
      `${header.path}: LEAFS lump is version ${leafVersion}; only version 0 (56-byte ` +
        `leaves, with CompressedLightCube) and version 1 (32-byte leaves) are supported`,
    );
  }

  const leafsLump = guardLump(header, LUMP_LEAFS, leafBytes);
  const leafsRaw = readAt(path, leafsLump.offset, leafsLump.length);
  const leafsView = new DataView(leafsRaw.buffer, leafsRaw.byteOffset, leafsRaw.byteLength);
  const leafCount = leafsLump.length / leafBytes;

  const leaves: VisLeaf[] = [];
  let noClusterLeafCount = 0;
  for (let i = 0; i < leafCount; i++) {
    const at = i * leafBytes;
    const contents = leafsView.getInt32(at, true);
    const cluster = leafsView.getInt16(at + 4, true);
    const mins: [number, number, number] = [
      leafsView.getInt16(at + 8, true),
      leafsView.getInt16(at + 10, true),
      leafsView.getInt16(at + 12, true),
    ];
    const maxs: [number, number, number] = [
      leafsView.getInt16(at + 14, true),
      leafsView.getInt16(at + 16, true),
      leafsView.getInt16(at + 18, true),
    ];
    // Clamped at 0: a maxs below mins would be a malformed leaf, and a negative volume
    // would corrupt every average silently rather than standing out as the anomaly it is.
    const volume = Math.max(0, maxs[0] - mins[0]) *
      Math.max(0, maxs[1] - mins[1]) *
      Math.max(0, maxs[2] - mins[2]);

    if (cluster === -1) noClusterLeafCount++;
    leaves.push({ index: i, contents, cluster, mins, maxs, volume });
  }

  // Not requireLump: an unvised map (vvis never run, or run with -novconfig on a tiny
  // probe) legitimately has an empty VISIBILITY lump, and that is worth reporting rather
  // than refusing outright -- LEAFS alone still answers most of this tool's questions.
  const visLump = header.lumps[LUMP_VISIBILITY];
  let clusterCount: number | null = null;
  let visibilityBytes = 0;
  if (visLump && visLump.length > 0) {
    if (visLump.compressed) {
      throw new BspFormatError(
        `${header.path}: lump ${LUMP_VISIBILITY} (${visLump.name ?? LUMP_VISIBILITY}) is ` +
          `individually LZMA-compressed; refusing to read its cluster count. It declares ` +
          `${visLump.declaredUncompressedBytes} uncompressed bytes, not verified here.`,
      );
    }
    if (visLump.length >= VISIBILITY_HEADER_BYTES) {
      const visHeader = readAt(path, visLump.offset, VISIBILITY_HEADER_BYTES);
      clusterCount = visHeader.readInt32LE(0);
    }
    visibilityBytes = visLump.length;
  }

  return {
    header,
    leafVersion,
    leafBytes,
    leafCount,
    clusterCount,
    visibilityBytes,
    noClusterLeafCount,
    leaves,
  };
}
