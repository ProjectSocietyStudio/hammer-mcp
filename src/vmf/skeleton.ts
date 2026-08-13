/**
 * The empty map every other writer assumes already exists.
 *
 * `write_vmf_solid` reads its target before it writes, and `insertSolids` refuses a file
 * with no `world` block, so neither an absent file nor an empty one is a place to start.
 * Until this existed the only way to begin a map was a text editor -- which made the whole
 * toolkit's workflow impossible to complete through tools alone, a gap found by trying it
 * (issue #47, `docs/dogfood/2026-08-13-bodega/findings.md` finding 4).
 *
 * What is written is what Hammer writes for File > New, with two departures, both because
 * a default that is silently wrong is worse than one a caller had to choose:
 *
 * - `mapversion` is 1 and `editorversion` 400, matching the fixtures this repository
 *   already compiles, rather than a version claiming to be a Hammer nobody ran.
 * - `skyname` is a parameter with `sky_day01_01` as its default -- Source's own -- rather
 *   than being omitted. A map with no `skyname` compiles and renders its sky as the last
 *   one the engine loaded.
 *
 * The `world` block is the only one that has to be here for the other writers to work. The
 * other four are written because Hammer writes them and their absence is the kind of
 * difference that turns up months later in a diff nobody can explain.
 */

export interface SkeletonOptions {
  /** The sky the map uses. Source's own default, not omitted -- see above. */
  skyname?: string;
  /** Hammer's grid, in units. Cosmetic: it is what an editor opens the file showing. */
  gridSpacing?: number;
}

export const DEFAULT_SKYNAME = "sky_day01_01";
export const DEFAULT_GRID = 64;

/**
 * A `.vmf` with no geometry and no entities, ready for every other writer here.
 *
 * Tabs and the brace-on-its-own-line layout are Hammer's, not a preference: this
 * repository's whole write discipline is that a machine edit reads like a human one, and
 * that starts with the file a machine creates being shaped like the file Hammer creates.
 */
export function emptyVmf(options: SkeletonOptions = {}): string {
  const skyname = options.skyname ?? DEFAULT_SKYNAME;
  const grid = options.gridSpacing ?? DEFAULT_GRID;

  return [
    "versioninfo",
    "{",
    '\t"editorversion" "400"',
    '\t"editorbuild" "5004"',
    '\t"mapversion" "1"',
    '\t"formatversion" "100"',
    '\t"prefab" "0"',
    "}",
    "visgroups",
    "{",
    "}",
    "viewsettings",
    "{",
    '\t"bSnapToGrid" "1"',
    '\t"bShowGrid" "1"',
    '\t"bShowLogicalGrid" "0"',
    `\t"nGridSpacing" "${grid}"`,
    '\t"bShow3DGrid" "0"',
    "}",
    "world",
    "{",
    '\t"id" "1"',
    '\t"mapversion" "1"',
    '\t"classname" "worldspawn"',
    '\t"detailmaterial" "detail/detailsprites"',
    '\t"detailvbsp" "detail.vbsp"',
    '\t"maxpropscreenwidth" "-1"',
    `\t"skyname" "${skyname}"`,
    "}",
    "cameras",
    "{",
    '\t"activecamera" "-1"',
    "}",
    "cordons",
    "{",
    '\t"active" "0"',
    "}",
    "",
  ].join("\n");
}
