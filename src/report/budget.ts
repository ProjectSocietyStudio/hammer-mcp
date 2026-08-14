/**
 * Turning measurements into a verdict.
 *
 * Every other reader in this server answers "how much"; none of them answers "is that
 * enough". That gap is why an agent driving this toolchain has no stopping condition: it
 * can measure a map forever and never learn that it is done. A budget profile supplies the
 * missing half -- the thresholds -- and this file compares one against the other.
 *
 * The split matters and is enforced by where numbers live:
 *
 *   - **Limits** are engine and compiler facts. They are already encoded once, in
 *     `../bsp/geometry.ts` (per-lump ceilings) and in `LIMITS` below (the three that are
 *     not per-lump). They are read from Valve's own headers, with the date. Nothing here
 *     restates them; restating them is how two copies come to disagree.
 *   - **Thresholds** are policy: how close to a limit you are willing to sit, what density
 *     you are aiming for. They live in a profile, and a profile says where each of its
 *     numbers came from -- including "we chose it".
 *
 * A criterion for which no calibrated threshold exists reports `skipped` and says why.
 * That is deliberate: inventing a plausible threshold would produce a confident verdict
 * about nothing, which is worse than admitting the gap.
 */
import { readEntityLump } from "../bsp/entities.js";
import { readGeometry } from "../bsp/geometry.js";
import { HDR_LUMPS } from "../bsp/header.js";
import { readLightmapBudget } from "../bsp/lightmap.js";
import { readModels, worldExtents } from "../bsp/models.js";
import { readVisleafStats } from "../bsp/visleaf.js";

/** `LUMP_CUBEMAPS`, one record per `env_cubemap` vrad resolved. */
const LUMP_CUBEMAPS = 42;

/**
 * The limits that are not per-lump, so have no home in `LUMP_SPECS`.
 *
 * Read from source-sdk-2013 on 11/08/2026, via the GitHub raw API rather than the wiki:
 * `src/public/const.h` for `MAX_EDICTS` and `src/public/worldsize.h` for the world bound.
 *
 * `MAX_MAP_LIGHTING` is deliberately absent. It lives in `LUMP_SPECS` with every other
 * per-lump ceiling, and briefly lived here too -- which produced two criteria reporting the
 * identical 264% on the same map. Exactly the duplication the header of this file warns
 * about, committed in this file, within a day.
 *
 * ⚠️ `bspfile.h` redefines every one of its `MAX_MAP_*` constants to `2` under a
 * conditional branch further down the file. Any automated re-read of that header must take
 * the first occurrence; the second is a build variant, not the value in force.
 */
export const LIMITS = {
  /** `MAX_EDICTS` = 1 << MAX_EDICT_BITS = 1 << 11. Stock Source; Garry's Mod raises it. */
  edicts: 2048,
  /**
   * `MAX_COORD_INTEGER`. The world runs from -16384 to +16384 on each axis.
   *
   * The often-repeated "32768 unit limit" is `COORD_EXTENT`, the width of that range. A
   * mapper who builds to 32768 leaves the world by a factor of two.
   */
  worldBound: 16384,
} as const;

export type Verdict = "pass" | "warn" | "fail" | "skipped";

export interface Criterion {
  /** Stable identifier, e.g. `vis-run`. Safe to match on. */
  id: string;
  /** What was measured, in words. */
  what: string;
  verdict: Verdict;
  /** The measured value. Null when the criterion was skipped. */
  value: number | null;
  unit: string;
  warnAt: number | null;
  failAt: number | null;
  /** `over`: crossing the threshold upward is bad. `under`: downward is bad. */
  direction: "over" | "under";
  message: string;
}

/** A threshold pair, plus where the two numbers came from. */
export interface Threshold {
  warnAt: number;
  failAt: number;
  /** Provenance. Required, because a threshold nobody can source is a guess. */
  source: string;
}

export interface BudgetProfile {
  id: string;
  description: string;
  /** Fraction of each lump's compile ceiling. */
  lumpFill: Threshold;
  /** Fraction of `LIMITS.edicts`, or of `edictLimit` when the profile overrides it. */
  edicts: Threshold | null;
  /**
   * Overrides `LIMITS.edicts` for engines that raise it.
   *
   * Set this only with a source. Garry's Mod does raise the ceiling, but the value is not
   * checkable in any open source tree, so a profile that sets it is stating a target, not
   * a fact, and the criterion message says so.
   */
  edictLimit: { value: number; source: string } | null;
  /** Luxels per square metre of lit surface. Null when nothing calibrates it. */
  luxelDensity: Threshold | null;
  /** Visleaves per hectare of world footprint. `direction: under` -- too few is the fault. */
  visleafDensity: Threshold | null;
  /** Fraction of leaves belonging to no cluster. */
  noClusterFraction: Threshold | null;
  /** vvis must have run: a map shipped without a PVS draws the whole world everywhere. */
  requireVis: boolean;
  /** vrad must have produced HDR lumps. */
  requireHdr: boolean;
  /** At least one cubemap must be built, or every specular surface renders black. */
  requireCubemaps: boolean;
}

/**
 * Only what the engine and the compilers assert, plus this repository's own 80% warning
 * line -- the same one `readGeometry` already uses for `nearLimit`, so the two agree by
 * construction rather than by coincidence.
 *
 * Everything genuinely uncalibrated is left null on purpose. This profile answers "will
 * this map compile and load", not "is this map good".
 */
export const SOURCE_STOCK: BudgetProfile = {
  id: "source-stock",
  description:
    "Stock Source SDK 2013 limits, as read from Valve's headers. Answers whether a map " +
    "will compile and load -- not whether it is any good.",
  lumpFill: {
    warnAt: 0.8,
    failAt: 1,
    source: "limits from bspfile.h (11/08/2026); the 80% warning line is this repo's own",
  },
  edicts: { warnAt: 0.8, failAt: 1, source: "MAX_EDICTS from const.h; fractions are policy" },
  edictLimit: null,
  luxelDensity: null,
  visleafDensity: null,
  noClusterFraction: null,
  requireVis: true,
  requireHdr: false,
  requireCubemaps: false,
};

/**
 * What a DarkRP city map is aiming for here.
 *
 * Two of these thresholds are measured and one is not, and the difference is stated in
 * each `source` rather than smoothed over.
 */
export const GMOD_DARKRP: BudgetProfile = {
  id: "gmod-darkrp",
  description:
    "A Garry's Mod DarkRP city map: hundreds of entities arrive at runtime that the " +
    "compiled file knows nothing about, so the file itself must leave room.",
  lumpFill: { warnAt: 0.7, failAt: 1, source: "tighter than stock: this map is still growing" },
  edicts: {
    warnAt: 0.4,
    failAt: 0.7,
    source:
      "policy, not measurement: players, weapons, printers and doors all spawn at runtime, " +
      "so the map alone must not take the bulk of the budget",
  },
  edictLimit: {
    value: 8192,
    source:
      "UNVERIFIED. Garry's Mod raises MAX_EDICTS, but the engine is closed and the value " +
      "is not checkable in any open tree. Treated as a target here, never as a fact -- to " +
      "settle it, measure it on a running instance with gmod-mcp.",
  },
  luxelDensity: null,
  visleafDensity: {
    warnAt: 250,
    failAt: 150,
    source:
      "measured 11/08/2026 on four city maps: 278 leaves/ha on rp_nycity, 371-456 on an " +
      "urban control by another author. Below ~250 a dense city is under-split.",
  },
  noClusterFraction: {
    warnAt: 0.5,
    failAt: 0.8,
    source: "policy: past half, the split is describing solid space rather than playable space",
  },
  requireVis: true,
  requireHdr: false,
  requireCubemaps: true,
};

export const BUILTIN_PROFILES: readonly BudgetProfile[] = [SOURCE_STOCK, GMOD_DARKRP];

export function findProfile(id: string): BudgetProfile | undefined {
  return BUILTIN_PROFILES.find((p) => p.id === id);
}

/** Applies a threshold in the direction where crossing it is the fault. */
function judge(value: number, t: Threshold, direction: "over" | "under"): Verdict {
  if (direction === "over") {
    if (value >= t.failAt) return "fail";
    return value >= t.warnAt ? "warn" : "pass";
  }
  if (value <= t.failAt) return "fail";
  return value <= t.warnAt ? "warn" : "pass";
}

/**
 * The worst verdict among a set of criteria.
 *
 * Separate from `reportMap` so it can be tested for itself. The case that matters is the
 * one a real map cannot reach today: when nothing was judged, the answer is `skipped`, not
 * `pass`. "Everything I checked was fine" and "I checked nothing" produce identical counts,
 * and a green light nobody earned is the one failure mode this whole file exists to
 * prevent.
 */
export function overallVerdict(summary: Record<Verdict, number>): Verdict {
  if (summary.pass + summary.warn + summary.fail === 0) return "skipped";
  if (summary.fail > 0) return "fail";
  return summary.warn > 0 ? "warn" : "pass";
}

function skipped(id: string, what: string, unit: string, why: string): Criterion {
  return {
    id,
    what,
    verdict: "skipped",
    value: null,
    unit,
    warnAt: null,
    failAt: null,
    direction: "over",
    message: why,
  };
}

export interface MapReport {
  path: string;
  profile: { id: string; description: string };
  /** The worst verdict among the criteria. `skipped` never counts as a failure. */
  overall: Verdict;
  criteria: Criterion[];
  /** Counts by verdict, for a caller that wants the shape without walking the list. */
  summary: Record<Verdict, number>;
}

/**
 * Measures a compiled map and judges it against a profile.
 *
 * Reads five lumps and the header. Everything here is offset-addressed, so it stays fast
 * on a map of any size -- the pakfile, which is most of a shipped map's bytes, is never
 * touched.
 */
export function reportMap(path: string, profile: BudgetProfile): MapReport {
  const criteria: Criterion[] = [];
  const geometry = readGeometry(path);
  const header = geometry.header;

  // --- lump fill, one criterion per lump that has a known ceiling and a usable count ---
  for (const lump of geometry.lumps) {
    if (lump.usedFraction === undefined || lump.limit === undefined) continue;
    const verdict = judge(lump.usedFraction, profile.lumpFill, "over");
    criteria.push({
      id: `lump-fill:${lump.name}`,
      what: `${lump.name} against ${lump.limitName ?? "its ceiling"}`,
      verdict,
      value: lump.usedFraction,
      unit: "fraction",
      warnAt: profile.lumpFill.warnAt,
      failAt: profile.lumpFill.failAt,
      direction: "over",
      // lump.used, not lump.count: a byte-denominated ceiling has no record count, and
      // printing the absent one gave `null of 16777216` beside a computed fraction (#85).
      message:
        `${lump.used ? `${lump.used.value}${lump.used.unit === "bytes" ? " bytes" : ""}` : lump.count} of ${lump.limit}` +
        (verdict === "fail"
          ? `. Past the stock ceiling -- either the compilers that built this raise it, ` +
            `or vbsp would have refused. Do not read it as "this map is broken" without ` +
            `checking which toolchain produced it.`
          : `.`),
    });
  }

  // --- edicts: the map's own entity count, before a single player connects ---
  const edictLimit = profile.edictLimit?.value ?? LIMITS.edicts;
  if (profile.edicts) {
    const entities = readEntityLump(path).entities.length;
    const fraction = entities / edictLimit;
    criteria.push({
      id: "edicts",
      what: "entities in lump 0, against the runtime edict ceiling",
      verdict: judge(fraction, profile.edicts, "over"),
      value: Math.round(fraction * 1000) / 1000,
      unit: "fraction",
      warnAt: profile.edicts.warnAt,
      failAt: profile.edicts.failAt,
      direction: "over",
      message:
        `${entities} entities against a ceiling of ${edictLimit}` +
        (profile.edictLimit ? ` (${profile.edictLimit.source})` : ` (MAX_EDICTS, stock)`) +
        `. This is what the map costs empty; everything a gamemode spawns comes on top.`,
    });
  }

  // --- did vvis actually run ---
  const visleaf = readVisleafStats(path);
  if (profile.requireVis) {
    const ran = visleaf.clusterCount !== null && visleaf.clusterCount > 0;
    criteria.push({
      id: "vis-run",
      what: "vvis produced a PVS",
      verdict: ran ? "pass" : "fail",
      value: ran ? 1 : 0,
      unit: "boolean",
      warnAt: null,
      failAt: 1,
      direction: "under",
      message: ran
        ? `${visleaf.clusterCount} clusters.`
        : `VISIBILITY is empty. Every leaf sees every other leaf, so the engine draws the ` +
          `whole map from everywhere. This is the single most expensive thing a map can ` +
          `ship with, and it is invisible in a small test.`,
    });
  }

  const extents = worldExtents(readModels(path));
  const hectares = extents.areaSquareMetres / 10000;

  // --- how finely the world got split, per hectare of footprint ---
  if (profile.visleafDensity) {
    if (hectares <= 0) {
      criteria.push(
        skipped(
          "visleaf-density",
          "visleaves per hectare",
          "leaves/ha",
          "the world model has no ground footprint, so a density cannot be formed",
        ),
      );
    } else {
      const density = visleaf.leafCount / hectares;
      criteria.push({
        id: "visleaf-density",
        what: "visleaves per hectare of world footprint",
        verdict: judge(density, profile.visleafDensity, "under"),
        value: Math.round(density * 10) / 10,
        unit: "leaves/ha",
        warnAt: profile.visleafDensity.warnAt,
        failAt: profile.visleafDensity.failAt,
        direction: "under",
        message:
          `${visleaf.leafCount} leaves over ${hectares.toFixed(1)} ha. ` +
          `⚠️ The footprint is the world model's XY bounding box, which includes the 3D ` +
          `skybox and every empty corner -- so this density is a floor, never a street-level ` +
          `figure. It compares honestly between maps and dishonestly against intuition.`,
      });
    }
  }

  if (profile.noClusterFraction) {
    const fraction =
      visleaf.leafCount > 0 ? visleaf.noClusterLeafCount / visleaf.leafCount : 0;
    criteria.push({
      id: "no-cluster-fraction",
      what: "leaves belonging to no cluster",
      verdict: judge(fraction, profile.noClusterFraction, "over"),
      value: Math.round(fraction * 1000) / 1000,
      unit: "fraction",
      warnAt: profile.noClusterFraction.warnAt,
      failAt: profile.noClusterFraction.failAt,
      direction: "over",
      message: `${visleaf.noClusterLeafCount} of ${visleaf.leafCount} leaves own no visible space.`,
    });
  }

  // --- luxel density: measured, but nothing calibrates it yet ---
  if (profile.luxelDensity) {
    const budget = readLightmapBudget(path);
    const areaSquareMetres = budget.litAreaUnits * 0.0254 * 0.0254;
    if (areaSquareMetres <= 0) {
      criteria.push(
        skipped(
          "luxel-density",
          "luxels per square metre of lit surface",
          "luxels/m2",
          "no face reports a positive area, so a density cannot be formed",
        ),
      );
    } else {
      const density = budget.totalLuxels / areaSquareMetres;
      criteria.push({
        id: "luxel-density",
        what: "luxels per square metre of lit surface",
        verdict: judge(density, profile.luxelDensity, "over"),
        value: Math.round(density * 10) / 10,
        unit: "luxels/m2",
        warnAt: profile.luxelDensity.warnAt,
        failAt: profile.luxelDensity.failAt,
        direction: "over",
        message: `${budget.totalLuxels} luxels over ${areaSquareMetres.toFixed(0)} m2 of lit face.`,
      });
    }
  } else {
    criteria.push(
      skipped(
        "luxel-density",
        "luxels per square metre of lit surface",
        "luxels/m2",
        "no profile here carries a calibrated threshold for this. The quantity is measurable " +
          "(read_lightmap_budget), but nobody has established what a good value is, and a " +
          "made-up threshold would return a confident verdict about nothing.",
      ),
    );
  }

  if (profile.requireHdr) {
    const present = HDR_LUMPS.filter((i) => (header.lumps[i]?.length ?? 0) > 0);
    criteria.push({
      id: "hdr",
      what: "vrad produced HDR lighting",
      verdict: present.length === HDR_LUMPS.length ? "pass" : "fail",
      value: present.length,
      unit: "lumps",
      warnAt: null,
      failAt: HDR_LUMPS.length,
      direction: "under",
      message:
        `${present.length} of ${HDR_LUMPS.length} HDR lumps (${HDR_LUMPS.join(", ")}) carry data.`,
    });
  }

  if (profile.requireCubemaps) {
    const cubemaps = geometry.lumps.find((l) => l.index === LUMP_CUBEMAPS)?.count ?? 0;
    criteria.push({
      id: "cubemaps",
      what: "cubemaps built into the map",
      verdict: cubemaps > 0 ? "pass" : "fail",
      value: cubemaps,
      unit: "samples",
      warnAt: null,
      failAt: 1,
      direction: "under",
      message:
        cubemaps > 0
          ? `${cubemaps} samples.`
          : `None. Every specular surface falls back to the default cubemap, which is why a ` +
            `map can look flat and mirror-black without any error appearing anywhere. ` +
            `Building them needs the engine: buildcubemaps, through gmod-mcp.`,
    });
  }

  const summary: Record<Verdict, number> = { pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const c of criteria) summary[c.verdict]++;
  return {
    path: header.path,
    profile: { id: profile.id, description: profile.description },
    overall: overallVerdict(summary),
    criteria,
    summary,
  };
}
