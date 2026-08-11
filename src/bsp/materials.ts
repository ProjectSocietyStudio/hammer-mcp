import { BspFormatError, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader, BspLump } from "./header.js";

/** Lump indices this reader touches, named locally as `trace.ts` does for its own set. */
const LUMP_TEXDATA = 2;
const LUMP_TEXINFO = 6;
const LUMP_TEXDATA_STRING_TABLE = 44;
const LUMP_TEXDATA_STRING_DATA = 43;

/** `dtexdata_t`: reflectivity Vector + nameStringTableID + width/height + view width/height. */
const TEXDATA_BYTES = 32;
/** `texinfo_t`: two 4-float texture/lightmap vectors, then flags, then texdata. */
const TEXINFO_BYTES = 72;
/** Byte offset of the `texdata` field inside a `texinfo_t`. */
const TEXINFO_TEXDATA_OFFSET = 68;
/** One int32 offset per entry, into `TEXDATA_STRING_DATA`. */
const STRING_TABLE_ENTRY_BYTES = 4;

export interface MaterialUsage {
  name: string;
  /** How many `texinfo` entries resolve to this material, across every texdata that names it. */
  usageCount: number;
  /** From the first texdata entry that names it; a texture's dimensions do not vary by reuse. */
  width: number;
  height: number;
  /** texdata indices sharing this name. Normally one; kept plural because nothing enforces it. */
  texdataIndices: number[];
}

export interface MaterialReport {
  header: BspHeader;
  texdataCount: number;
  texinfoCount: number;
  /** texinfo entries whose texdata field falls outside [0, texdataCount) -- normally zero. */
  unattributedTexinfo: number;
  materials: MaterialUsage[];
}

/** Refuses a lump this reader would otherwise decode wrong: compressed, or wrongly sized. */
function guardLump(header: BspHeader, index: number, structBytes: number | null): BspLump {
  const lump = requireLump(header, index);
  if (lump.compressed) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is individually LZMA-compressed; ` +
        `refusing rather than decoding compressed bytes as records. It declares ` +
        `${lump.declaredUncompressedBytes} uncompressed bytes, not verified here.`,
    );
  }
  if (structBytes !== null && lump.length % structBytes !== 0) {
    throw new BspFormatError(
      `${header.path}: lump ${index} (${lump.name ?? index}) is ${lump.length} bytes, not a ` +
        `multiple of the expected ${structBytes}-byte record; the layout differs in this ` +
        `BSP version`,
    );
  }
  return lump;
}

/** Reads a NUL-terminated string out of a buffer, starting at `offset`. */
function readCString(buf: Buffer, offset: number): string {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.subarray(offset, end).toString("utf8");
}

/**
 * Reads the material table of a compiled map: every texture referenced by a `texinfo`, and
 * how many `texinfo` entries reuse it.
 *
 * The chain is `TEXINFO.texdata` -> `TEXDATA.nameStringTableID` -> `TEXDATA_STRING_TABLE[id]`,
 * an offset into `TEXDATA_STRING_DATA` where the material's path sits as a NUL-terminated
 * string. Reused because it is the only accurate reuse count in the file: a material can be
 * painted on many faces with a shared texinfo, or a distinct texinfo per face -- this counts
 * the latter, which is what determines how many distinct texinfo records vbsp had to keep.
 *
 * Reads the four lumps' bodies (never the whole file): on a 1 GB map these total well under
 * a megabyte.
 */
export function readMaterials(path: string): MaterialReport {
  const header = readHeader(path);

  const stringDataLump = guardLump(header, LUMP_TEXDATA_STRING_DATA, null);
  const stringTableLump = guardLump(
    header,
    LUMP_TEXDATA_STRING_TABLE,
    STRING_TABLE_ENTRY_BYTES,
  );
  const texdataLump = guardLump(header, LUMP_TEXDATA, TEXDATA_BYTES);
  const texinfoLump = guardLump(header, LUMP_TEXINFO, TEXINFO_BYTES);

  const stringData = readAt(path, stringDataLump.offset, stringDataLump.length);

  const tableRaw = readAt(path, stringTableLump.offset, stringTableLump.length);
  const tableView = new DataView(tableRaw.buffer, tableRaw.byteOffset, tableRaw.byteLength);
  const stringTableCount = stringTableLump.length / STRING_TABLE_ENTRY_BYTES;
  const stringOffsets: number[] = [];
  for (let i = 0; i < stringTableCount; i++) {
    stringOffsets.push(tableView.getInt32(i * STRING_TABLE_ENTRY_BYTES, true));
  }

  const texdataRaw = readAt(path, texdataLump.offset, texdataLump.length);
  const texdataView = new DataView(texdataRaw.buffer, texdataRaw.byteOffset, texdataRaw.byteLength);
  const texdataCount = texdataLump.length / TEXDATA_BYTES;

  interface TexdataEntry {
    name: string;
    width: number;
    height: number;
  }
  const texdataEntries: TexdataEntry[] = [];
  for (let i = 0; i < texdataCount; i++) {
    const at = i * TEXDATA_BYTES;
    const nameStringTableID = texdataView.getInt32(at + 12, true);
    const offset = stringOffsets[nameStringTableID];
    const name =
      offset === undefined || offset < 0 || offset >= stringData.length
        ? `(invalid string table id ${nameStringTableID})`
        : readCString(stringData, offset);
    texdataEntries.push({
      name,
      width: texdataView.getInt32(at + 16, true),
      height: texdataView.getInt32(at + 20, true),
    });
  }

  const texinfoRaw = readAt(path, texinfoLump.offset, texinfoLump.length);
  const texinfoView = new DataView(texinfoRaw.buffer, texinfoRaw.byteOffset, texinfoRaw.byteLength);
  const texinfoCount = texinfoLump.length / TEXINFO_BYTES;

  const usageByTexdata = new Array<number>(texdataCount).fill(0);
  let unattributedTexinfo = 0;
  for (let i = 0; i < texinfoCount; i++) {
    const texdata = texinfoView.getInt32(i * TEXINFO_BYTES + TEXINFO_TEXDATA_OFFSET, true);
    if (texdata < 0 || texdata >= texdataCount) {
      unattributedTexinfo++;
      continue;
    }
    usageByTexdata[texdata]!++;
  }

  const byName = new Map<string, MaterialUsage>();
  for (let i = 0; i < texdataCount; i++) {
    const entry = texdataEntries[i]!;
    const usage = usageByTexdata[i]!;
    const existing = byName.get(entry.name);
    if (existing) {
      existing.usageCount += usage;
      existing.texdataIndices.push(i);
    } else {
      byName.set(entry.name, {
        name: entry.name,
        usageCount: usage,
        width: entry.width,
        height: entry.height,
        texdataIndices: [i],
      });
    }
  }

  return {
    header,
    texdataCount,
    texinfoCount,
    unattributedTexinfo,
    materials: [...byName.values()],
  };
}
