import { BspFormatError, readAt, readHeader, requireLump } from "./header.js";
import type { BspHeader, BspLump } from "./header.js";

const LUMP_FACES = 7;
const LUMP_TEXINFO = 6;

/** `dface_t`: 56 bytes, unchanged since the Source 2007 BSP version this server reads. */
const FACE_BYTES = 56;
/** `texinfo_t`: matches `src/bsp/materials.ts`'s constant of the same shape. */
const TEXINFO_BYTES = 72;
/** Byte offset of the `flags` field inside a `texinfo_t`, just before `texdata`. */
const TEXINFO_FLAGS_OFFSET = 64;

/** From `bspflags.h`. A face carrying any of these never gets a baked lightmap. */
const SURF_SKY2D = 0x2;
const SURF_SKY = 0x4;
const SURF_NODRAW = 0x80;
const SURF_NOLIGHT = 0x400;
const NO_LIGHTMAP_FLAGS = SURF_SKY2D | SURF_SKY | SURF_NODRAW | SURF_NOLIGHT;

export interface FaceLightmap {
  index: number;
  texinfo: number;
  /** vrad actually wrote lightmap data for this face (`lightofs >= 0`). */
  hasLightmap: boolean;
  /** (sizeInLuxels + 1) in each axis, multiplied -- Source's own off-by-one convention. */
  luxels: number;
  sizeLuxels: [number, number];
  /** Face polygon area, in Hammer units^2, as vbsp computed it. 0 when not computable. */
  area: number;
}

export interface LightmapBudgetReport {
  header: BspHeader;
  faceCount: number;
  facesWithLightmap: number;
  totalLuxels: number;
  /** Sum of `area` over faces counted in `totalLuxels`, when > 0. */
  litAreaUnits: number;
  faces: FaceLightmap[];
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
 * Reads every face's lightmap footprint: FACES for the luxel dimensions vrad allocated,
 * TEXINFO for the surface flags that say a face was never going to have one (sky, nodraw,
 * SURF_NOLIGHT). Excluding those is what makes `totalLuxels` a budget rather than a
 * headcount padded with faces that could never have cost anything.
 *
 * `m_LightmapTextureSizeInLuxels` stores the texture size MINUS one in each axis -- a
 * documented Source convention, cross-checked here against the probe map's known
 * `lightmapscale`, not assumed from a wiki page.
 *
 * Reads two lump bodies only. On a 1 GB map that is a few megabytes at most, nothing like
 * the file itself.
 */
export function readLightmapBudget(path: string): LightmapBudgetReport {
  const header = readHeader(path);
  const facesLump = guardLump(header, LUMP_FACES, FACE_BYTES);
  const texinfoLump = guardLump(header, LUMP_TEXINFO, TEXINFO_BYTES);

  const texinfoRaw = readAt(path, texinfoLump.offset, texinfoLump.length);
  const texinfoView = new DataView(texinfoRaw.buffer, texinfoRaw.byteOffset, texinfoRaw.byteLength);
  const texinfoCount = texinfoLump.length / TEXINFO_BYTES;
  const texinfoFlags = new Int32Array(texinfoCount);
  for (let i = 0; i < texinfoCount; i++) {
    texinfoFlags[i] = texinfoView.getInt32(i * TEXINFO_BYTES + TEXINFO_FLAGS_OFFSET, true);
  }

  const facesRaw = readAt(path, facesLump.offset, facesLump.length);
  const facesView = new DataView(facesRaw.buffer, facesRaw.byteOffset, facesRaw.byteLength);
  const faceCount = facesLump.length / FACE_BYTES;

  const faces: FaceLightmap[] = [];
  let totalLuxels = 0;
  let litAreaUnits = 0;
  let facesWithLightmap = 0;

  for (let i = 0; i < faceCount; i++) {
    const at = i * FACE_BYTES;
    const texinfo = facesView.getInt16(at + 10, true);
    const lightofs = facesView.getInt32(at + 20, true);
    const area = facesView.getFloat32(at + 24, true);
    const sizeLuxels: [number, number] = [
      facesView.getInt32(at + 36, true),
      facesView.getInt32(at + 40, true),
    ];

    const flags = texinfo >= 0 && texinfo < texinfoCount ? texinfoFlags[texinfo]! : 0;
    const surfaceExcludesLightmap = (flags & NO_LIGHTMAP_FLAGS) !== 0;
    const hasLightmap =
      lightofs >= 0 && !surfaceExcludesLightmap && sizeLuxels[0] >= 0 && sizeLuxels[1] >= 0;
    const luxels = hasLightmap ? (sizeLuxels[0] + 1) * (sizeLuxels[1] + 1) : 0;

    if (hasLightmap) {
      facesWithLightmap++;
      totalLuxels += luxels;
      if (area > 0) litAreaUnits += area;
    }

    faces.push({ index: i, texinfo, hasLightmap, luxels, sizeLuxels, area });
  }

  return { header, faceCount, facesWithLightmap, totalLuxels, litAreaUnits, faces };
}
