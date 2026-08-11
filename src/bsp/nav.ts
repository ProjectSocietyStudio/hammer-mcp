import { existsSync, readFileSync, statSync } from "node:fs";

/** `0xFEEDFACE`, first four bytes of every .nav. */
export const NAV_MAGIC = 0xfeedface;

export class NavFormatError extends Error {}

export interface NavHeader {
  path: string;
  fileBytes: number;
  version: number;
  subVersion: number | null;
  /**
   * Size the .bsp had when this mesh was generated.
   *
   * This is the whole reason to read a .nav offline: the engine compares it against the
   * map it is loading and silently regenerates or refuses the mesh when they differ. A
   * stale nav shows up in game as Nextbots that will not path, with nothing in the
   * console to say why.
   */
  savedBspSize: number;
  isAnalyzed: boolean | null;
  placeCount: number | null;
  /**
   * Area count, read by walking the header past the place names.
   *
   * Best effort, unlike the fields above: those were checked byte-for-byte against
   * gm_construct and gm_flatgrass, this one only looks plausible. gm_construct reports
   * 2271 areas in a 7.2 MB file, which is 3189 bytes each, where gm_flatgrass reports
   * 853 in 325 bytes each. The gap may be real -- hiding spots and encounter paths grow
   * faster than area count -- but nothing here proves it, so treat it as indicative.
   */
  areaCount: number | null;
}

export interface NavFreshness extends NavHeader {
  bsp: string | null;
  actualBspSize: number | null;
  /** Null when no .bsp was found to compare against. */
  matchesBsp: boolean | null;
  verdict: "fresh" | "stale" | "unknown";
}

/** Reads the header of a .nav file. */
export function readNavHeader(path: string): NavHeader {
  if (!existsSync(path)) throw new NavFormatError(`${path} does not exist`);
  const buf = readFileSync(path);
  if (buf.length < 12) throw new NavFormatError(`${path}: too short to be a .nav`);

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== NAV_MAGIC) {
    throw new NavFormatError(
      `${path}: magic is 0x${magic.toString(16).toUpperCase()}, not 0xFEEDFACE`,
    );
  }

  const version = view.getUint32(4, true);
  let at = 8;
  let subVersion: number | null = null;
  if (version >= 10) {
    subVersion = view.getUint32(at, true);
    at += 4;
  }
  const savedBspSize = view.getUint32(at, true);
  at += 4;

  let isAnalyzed: boolean | null = null;
  if (version >= 14) {
    isAnalyzed = buf[at] === 1;
    at += 1;
  }

  // Everything past here is best effort: the layout is reverse-engineered, and a wrong
  // count is worse than none, so anything that does not read cleanly becomes null.
  let placeCount: number | null = null;
  let areaCount: number | null = null;
  try {
    placeCount = view.getUint16(at, true);
    at += 2;
    for (let i = 0; i < placeCount; i++) {
      const length = view.getUint16(at, true);
      at += 2 + length;
    }
    if (version >= 11) at += 1; // hasUnnamedAreas
    areaCount = view.getUint32(at, true);
  } catch {
    placeCount = null;
    areaCount = null;
  }

  return {
    path,
    fileBytes: buf.length,
    version,
    subVersion,
    savedBspSize,
    isAnalyzed,
    placeCount,
    areaCount,
  };
}

/**
 * Compares a .nav against the map it belongs to.
 *
 * Verified against ground truth: `gm_construct.nav` records 36 735 656 bytes and
 * `gm_flatgrass.nav` records 47 430 424, each matching its own .bsp exactly.
 */
export function checkNavFreshness(navPath: string, bspPath: string | null): NavFreshness {
  const header = readNavHeader(navPath);
  if (!bspPath || !existsSync(bspPath)) {
    return {
      ...header,
      bsp: bspPath,
      actualBspSize: null,
      matchesBsp: null,
      verdict: "unknown",
    };
  }
  const actualBspSize = statSync(bspPath).size;
  const matchesBsp = actualBspSize === header.savedBspSize;
  return {
    ...header,
    bsp: bspPath,
    actualBspSize,
    matchesBsp,
    verdict: matchesBsp ? "fresh" : "stale",
  };
}
