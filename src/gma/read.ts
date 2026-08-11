/**
 * Reading a Garry's Mod addon archive.
 *
 * A `.gma` is how the Workshop ships everything, maps included, and until now a Workshop
 * map had to be unpacked by hand before any tool here could look at it. That is a real gap
 * rather than a cosmetic one: the corpus a mapper learns from is on the Workshop, and a
 * tool that cannot open it can only ever measure work that was already local.
 *
 * The format is a header, an index, then every file's bytes concatenated in index order.
 * Nothing is compressed and nothing is aligned, so a file's offset is the sum of the sizes
 * before it -- which means one pass over the index gives random access to a 1 GB archive
 * without reading its body. The map inside `rp_pinescity_v2b.gma` can be extracted while
 * the materials beside it are never touched.
 *
 * Layout, as read from an archive Steam produced:
 *
 *   "GMAD"            4 bytes
 *   version           1
 *   steamid           8
 *   timestamp         8
 *   required content  version > 1 only: NUL-terminated strings, ended by an empty one
 *   name, description, author   NUL-terminated
 *   addon version     4
 *   index             repeated { number: u32 (0 ends it), path, size: i64, crc: u32 }
 *   bodies            concatenated, in index order
 */
import { closeSync, openSync, readSync, statSync } from "node:fs";

export class GmaFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmaFormatError";
  }
}

export const GMA_MAGIC = "GMAD";

export interface GmaEntry {
  /** Path inside the addon, e.g. `maps/rp_pinescity_v2b.bsp`. */
  path: string;
  size: number;
  crc: number;
  /** Byte offset of this entry's data in the archive. */
  offset: number;
}

export interface GmaArchive {
  path: string;
  version: number;
  steamId: string;
  /** Unix seconds, as the archive records it. */
  timestamp: number;
  name: string;
  description: string;
  author: string;
  addonVersion: number;
  requiredContent: string[];
  entries: GmaEntry[];
  /** Sum of every entry's size. Smaller than the file: the header and index are extra. */
  contentBytes: number;
  fileBytes: number;
}

/** A cursor over a file, reading in blocks so an index of 15 000 entries is one pass. */
class Cursor {
  private buffer: Buffer;
  private start = 0;
  private at = 0;

  constructor(
    private readonly fd: number,
    private readonly fileSize: number,
    private readonly block = 1 << 16,
  ) {
    this.buffer = Buffer.alloc(0);
  }

  get position(): number {
    return this.start + this.at;
  }

  private fill(need: number): void {
    if (this.buffer.length - this.at >= need) return;
    const keep = this.buffer.subarray(this.at);
    const want = Math.max(this.block, need);
    const next = Buffer.alloc(want);
    const read = readSync(this.fd, next, 0, want, this.start + this.at + keep.length);
    this.start += this.at;
    this.at = 0;
    this.buffer = Buffer.concat([keep, next.subarray(0, read)]);
    if (this.buffer.length < need) {
      throw new GmaFormatError(
        `archive ends after ${this.fileSize} bytes, in the middle of a record`,
      );
    }
  }

  take(n: number): Buffer {
    this.fill(n);
    const out = this.buffer.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  u8(): number {
    return this.take(1)[0]!;
  }
  u32(): number {
    return this.take(4).readUInt32LE(0);
  }
  i64(): number {
    const raw = this.take(8).readBigInt64LE(0);
    if (raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < 0n) {
      throw new GmaFormatError(`entry size ${raw} is not a usable length`);
    }
    return Number(raw);
  }
  /** A NUL-terminated string. Reads a byte at a time: these are short and few. */
  cstr(): string {
    const bytes: number[] = [];
    for (;;) {
      const b = this.u8();
      if (b === 0) break;
      bytes.push(b);
      if (bytes.length > 4096) {
        throw new GmaFormatError("a string ran past 4096 bytes with no terminator");
      }
    }
    return Buffer.from(bytes).toString("utf8");
  }
}

/**
 * Reads the header and index. The bodies are never touched, so this is fast on any size.
 */
export function readGma(path: string): GmaArchive {
  const fileBytes = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const cursor = new Cursor(fd, fileBytes);
    const magic = cursor.take(4).toString("ascii");
    if (magic !== GMA_MAGIC) {
      throw new GmaFormatError(
        `${path}: magic is ${JSON.stringify(magic)}, not ${GMA_MAGIC}. A compressed or ` +
          `encrypted archive is refused here rather than decoded as if it were plain.`,
      );
    }

    const version = cursor.u8();
    const steamId = cursor.take(8).readBigUInt64LE(0).toString();
    const timestamp = Number(cursor.take(8).readBigUInt64LE(0));

    const requiredContent: string[] = [];
    if (version > 1) {
      for (;;) {
        const entry = cursor.cstr();
        if (entry === "") break;
        requiredContent.push(entry);
        if (requiredContent.length > 1024) {
          throw new GmaFormatError("required-content list ran past 1024 entries");
        }
      }
    }

    const name = cursor.cstr();
    const description = cursor.cstr();
    const author = cursor.cstr();
    const addonVersion = cursor.take(4).readInt32LE(0);

    const entries: GmaEntry[] = [];
    let sizes = 0;
    for (;;) {
      const number = cursor.u32();
      if (number === 0) break;
      const entryPath = cursor.cstr();
      const size = cursor.i64();
      const crc = cursor.u32();
      entries.push({ path: entryPath, size, crc, offset: 0 });
      sizes += size;
      if (entries.length > 262144) {
        throw new GmaFormatError("index ran past 262144 entries; this is not a .gma");
      }
    }

    // Offsets are only knowable once the index is closed: the first body begins where the
    // index ends, and each one follows the last with no padding.
    let offset = cursor.position;
    for (const entry of entries) {
      entry.offset = offset;
      offset += entry.size;
    }

    if (offset > fileBytes) {
      throw new GmaFormatError(
        `${path}: the index describes ${offset} bytes but the file is ${fileBytes}. ` +
          `It is truncated, and any extraction from it would be silently short.`,
      );
    }

    return {
      path,
      version,
      steamId,
      timestamp,
      name,
      description,
      author,
      addonVersion,
      requiredContent,
      entries,
      contentBytes: sizes,
      fileBytes,
    };
  } finally {
    closeSync(fd);
  }
}

/** Reads one entry's bytes, by offset. Nothing before or after it is read. */
export function readGmaEntry(archive: GmaArchive, entry: GmaEntry): Buffer {
  const fd = openSync(archive.path, "r");
  try {
    const out = Buffer.alloc(entry.size);
    let done = 0;
    while (done < entry.size) {
      const read = readSync(fd, out, done, entry.size - done, entry.offset + done);
      if (read === 0) {
        throw new GmaFormatError(
          `${archive.path}: ${entry.path} ends after ${done} of ${entry.size} bytes`,
        );
      }
      done += read;
    }
    return out;
  } finally {
    closeSync(fd);
  }
}
