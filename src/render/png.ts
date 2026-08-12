/**
 * Writing a PNG, in about sixty lines and with no dependency.
 *
 * A PNG is a signature, then chunks, each `length | type | data | crc32`. Only three are
 * needed: `IHDR` says how big and what kind, `IDAT` holds the pixels zlib-deflated with a
 * filter byte per row, `IEND` ends it. Node ships `zlib.deflateSync`, which is the only hard
 * part, so the rest is byte layout.
 *
 * The alternative was a dependency, and it would have been a strange one to take: this
 * server refuses to guess a lump's structure from memory and reads Valve's formats by their
 * documented layout instead. PNG is documented the same way, and it is smaller than the BSP
 * header reader already here.
 *
 * The filter byte is the trap. Every scanline is prefixed with one, and 0 means "no
 * filtering". Omit it and the encoder still produces a file, deflate still compresses, the
 * CRC still checks out -- and every row is shifted one byte further than the last, so the
 * image shears into diagonal noise. The test inflates its own output and compares it with
 * the framebuffer, which is the only way that fault shows up as a failure rather than as a
 * picture nobody looked at.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The standard CRC-32 table, built once. */
const CRC_TABLE = ((): Int32Array => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encodes an RGB framebuffer as a PNG.
 *
 * `rgb` is width * height * 3 bytes, row-major from the top left, which is the order both
 * PNG and this repository's rasteriser use.
 */
export function encodePng(rgb: Uint8Array, width: number, height: number): Buffer {
  if (rgb.length !== width * height * 3) {
    throw new Error(
      `framebuffer is ${rgb.length} bytes for ${width}x${height}, expected ${width * height * 3}`,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2: truecolour, no alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte per scanline, and it must be there even when it is zero.
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const at = y * (width * 3 + 1);
    raw[at] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), at + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export interface DecodedPng {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/**
 * Reads back a PNG this module wrote, for the test that proves it wrote one.
 *
 * Deliberately narrow: colour type 2, bit depth 8, filter 0, no interlace. A general decoder
 * would be a second piece of software to be wrong in, and the question here is only whether
 * the bytes that went in come back out.
 */
export function decodePng(buf: Buffer): DecodedPng {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG: bad signature");

  let at = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    const stated = buf.readUInt32BE(at + 8 + length);
    const actual = crc32(buf.subarray(at + 4, at + 8 + length));
    if (stated !== actual) throw new Error(`chunk ${type}: CRC ${stated} but computed ${actual}`);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 2) throw new Error("only 8-bit truecolour is read here");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const from = y * (width * 3 + 1);
    if (raw[from] !== 0) throw new Error(`scanline ${y} uses filter ${raw[from]}, only 0 is read`);
    rgb.set(raw.subarray(from + 1, from + 1 + width * 3), y * width * 3);
  }
  return { width, height, rgb };
}
