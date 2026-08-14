/**
 * The header of a `.vtf`, and nothing else.
 *
 * Written to check what a tool claimed to write, not to decode a texture: this server has
 * never needed a pixel and does not start now. Reading the first 80 bytes answers the
 * questions that actually come up -- is this a cubemap, what size, which format, which
 * version -- and every one of those is a field, not a decode.
 *
 * Layout from Valve's `vtf.h`, and the offsets are asserted against real files rather than
 * trusted: `cubemapdefault.vtf` out of `hmcp_probe.bsp` reads 7.5, 32x32; the cubemaps
 * packed in `gm_construct.bsp` read 7.4, 32x32, DXT1 for the LDR set and RGBA16161616F for
 * the `.hdr` one. Those four numbers are the calibration.
 */

/** `IMAGE_FORMAT_*`, the ones that turn up in map content. Unknown stays a number. */
export const VTF_FORMATS: Record<number, string> = {
  0: "RGBA8888",
  2: "RGB888",
  3: "BGR888",
  12: "BGRA8888",
  13: "DXT1",
  14: "DXT3",
  15: "DXT5",
  24: "RGBA16161616F",
};

/** `TEXTUREFLAGS_ENVMAP`. The bit that makes a texture a cubemap rather than a picture. */
export const VTF_ENVMAP = 0x4000;

export interface VtfHeader {
  version: string;
  width: number;
  height: number;
  flags: number;
  /** True when `TEXTUREFLAGS_ENVMAP` is set: six faces, not one image. */
  cubemap: boolean;
  format: string;
  frames: number;
}

/** Reads the header, or null when the bytes are not a `.vtf` at all. */
export function readVtfHeader(bytes: Buffer): VtfHeader | null {
  if (bytes.length < 64 || bytes.toString("latin1", 0, 4) !== "VTF\0") return null;
  const major = bytes.readUInt32LE(4);
  const minor = bytes.readUInt32LE(8);
  const width = bytes.readUInt16LE(16);
  const height = bytes.readUInt16LE(18);
  const flags = bytes.readUInt32LE(20);
  const frames = bytes.readUInt16LE(24);
  const format = bytes.readInt32LE(52);
  return {
    version: `${major}.${minor}`,
    width,
    height,
    flags,
    cubemap: (flags & VTF_ENVMAP) !== 0,
    format: VTF_FORMATS[format] ?? String(format),
    frames,
  };
}
