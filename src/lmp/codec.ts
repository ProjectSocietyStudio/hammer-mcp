import { readFileSync } from "node:fs";
import { LUMP_ENTITIES } from "../bsp/header.js";
import type { BspHeader } from "../bsp/header.js";

/** `lumpfileheader_t`: five little-endian int32. */
export const LMP_HEADER_BYTES = 20;

export interface LmpHeader {
  /** Where the payload starts. Always 20 in every file Valve ships. */
  lumpOffset: number;
  /** Which BSP lump this overrides. 0 is the entity list. */
  lumpID: number;
  lumpVersion: number;
  /** Payload length in bytes. */
  lumpLength: number;
  /**
   * Must equal the target BSP's `mapRevision`.
   *
   * This is the trap of the whole mechanism: on a mismatch the engine ignores the patch
   * WITHOUT SAYING ANYTHING. The map loads, looks normal, and none of the edits are
   * there. Never guess it -- read it from the BSP.
   */
  mapRevision: number;
}

export interface LmpFile {
  header: LmpHeader;
  /** Payload bytes, trailing NUL stripped. */
  payload: Buffer;
  nulTerminated: boolean;
}

export class LmpFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LmpFormatError";
  }
}

export function decodeLmp(buf: Buffer): LmpFile {
  if (buf.length < LMP_HEADER_BYTES) {
    throw new LmpFormatError(`too small to be a lump file (${buf.length} bytes)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const header: LmpHeader = {
    lumpOffset: view.getInt32(0, true),
    lumpID: view.getInt32(4, true),
    lumpVersion: view.getInt32(8, true),
    lumpLength: view.getInt32(12, true),
    mapRevision: view.getInt32(16, true),
  };

  const { lumpOffset, lumpLength } = header;
  if (lumpOffset < LMP_HEADER_BYTES || lumpOffset > buf.length) {
    throw new LmpFormatError(`lumpOffset ${lumpOffset} outside the file (${buf.length} bytes)`);
  }
  if (lumpLength < 0 || lumpOffset + lumpLength > buf.length) {
    throw new LmpFormatError(
      `payload ${lumpOffset}+${lumpLength} runs past end of file (${buf.length} bytes)`,
    );
  }

  const raw = buf.subarray(lumpOffset, lumpOffset + lumpLength);
  const nulTerminated = raw.length > 0 && raw[raw.length - 1] === 0;
  return {
    header,
    payload: nulTerminated ? raw.subarray(0, raw.length - 1) : raw,
    nulTerminated,
  };
}

export function readLmp(path: string): LmpFile {
  return decodeLmp(readFileSync(path));
}

export interface EncodeLmpOptions {
  /** Which lump to override. */
  lumpID: number;
  lumpVersion?: number;
  /**
   * Required, with no default on purpose. Every way of getting this wrong fails
   * silently, so the type system makes you go and fetch it.
   */
  mapRevision: number;
  /** Appends a NUL, matching what vbsp writes into the BSP's own entity lump. */
  nulTerminate?: boolean;
}

export function encodeLmp(payload: Buffer | string, opts: EncodeLmpOptions): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const nulTerminate = opts.nulTerminate ?? opts.lumpID === LUMP_ENTITIES;
  const full = nulTerminate ? Buffer.concat([body, Buffer.from([0])]) : body;

  const header = Buffer.alloc(LMP_HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  view.setInt32(0, LMP_HEADER_BYTES, true);
  view.setInt32(4, opts.lumpID, true);
  view.setInt32(8, opts.lumpVersion ?? 0, true);
  view.setInt32(12, full.length, true);
  view.setInt32(16, opts.mapRevision, true);

  return Buffer.concat([header, full]);
}

/**
 * Refuses a patch whose revision does not match the BSP it targets.
 *
 * Called at WRITE time rather than left to the engine, because the engine's answer is
 * silence: the failure surfaces as "my edits did nothing" after a server restart, which
 * is the most expensive place to learn it.
 */
export function assertRevisionMatches(header: LmpHeader, bsp: BspHeader): void {
  if (header.mapRevision !== bsp.mapRevision) {
    throw new LmpFormatError(
      `mapRevision mismatch: patch says ${header.mapRevision}, ${bsp.path} says ${bsp.mapRevision}. ` +
        `The engine would ignore this patch without any message.`,
    );
  }
}
