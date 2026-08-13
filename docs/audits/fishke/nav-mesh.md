# Nav mesh analysis — `rp_nycity`

Parser written for this reading (`nav_read.py`, a scratch script, not committed), layout verified
against `source-sdk-2013/mp/src/game/server/nav_file.cpp` (`CNavMesh::Load`, `CNavArea::Load`,
`PlaceDirectory::Load`) — not only against the VDC, which marks itself "reverse engineered" and
"too vague". Both files were parsed **in full, area by area**, without error: `bytesRemaining` falls
back to 4 bytes at end of file for both (consistent with the mesh's global ladder table, which this
script does not read — not needed for the question asked).

## Header — MEASURED, cross-checked Python ↔ `read_nav`

| Field | `rp_nycity.nav` | `rp_nycity_day.nav` |
|---|---|---|
| Magic | `0xFEEDFACE` (valid) | `0xFEEDFACE` (valid) |
| Version | 16 | 16 |
| Sub-version | 0 (Garry's Mod, per Valve's table) | 0 |
| `.nav` file size | 79,261,316 B (79 MB) | 34,594,519 B (34 MB) |
| Recorded BSP size | **1,142,853,009 B** | **1,130,563,848 B** |
| `isAnalyzed` | true | true |
| Area count | 26,711 | 13,260 |

Both readings (an independent Python script and `read_nav`) give identical values on every one of
these fields — a conclusive cross-check.

## Freshness against the shipped `.bsp`

Actual size of `rp_nycity.bsp`: **1,142,853,009 bytes** (measured with `ls -la` and confirmed by
`read_map_extents`).

- **`rp_nycity.nav`**: `savedBspSize` = 1,142,853,009 = the real size **exactly**. The mesh is
  current with respect to the shipped BSP.
- **`rp_nycity_day.nav`**: `savedBspSize` = 1,130,563,848, i.e. **12,289,161 bytes (≈ 11.7 MiB)
  less** than the shipped `.bsp`. The mesh was generated against a *different* compile from the one
  in the archive — **stale in the engine's strict sense**: if `rp_nycity_day.bsp` is not the shipped
  file, the game silently regenerates or refuses this mesh at load.

**A notable delivery fact**: the "day" `.nav` matches no `.bsp` present in the archive
(`rp_nycity.bsp`, `rp_southside.bsp`, `rp_unioncity.bsp` — no `rp_nycity_day.bsp`). Either a file is
missing from the delivery, or this `.nav` is a leftover from an earlier compile never removed.
Either way the shipping is not guaranteed coherent: there is no confirming that this file works with
anything in the archive received.

## Coverage — MEASURED (areas) × MEASURED (map extent)

Extent of `rp_nycity.bsp` via `read_map_extents`: 802.6 × 796.5 m, ground area **639,338 m²**
(Valve/hammer-mcp computation on the world model, lump 14).

| | `rp_nycity.nav` | `rp_nycity_day.nav` |
|---|---|---|
| Areas parsed | 26,711 / 26,711 (100%) | 13,260 / 13,260 (100%) |
| Total area surface | 472,604 m² | 286,666 m² |
| Mean surface per area | 17.69 m² | 21.62 m² |
| Median surface per area | 1.21 m² | 1.21 m² |
| Standard deviation | 62.64 m² | 73.76 m² |
| Largest area | ≈ 1,008 m² | ≈ 1,008 m² |
| **Coverage / map extent** | **73.9%** | **44.8%** |
| Mean connections per area | 4.47 | 4.58 |

*(Coverage = sum of mesh areas ÷ 639,338 m². This is an approximate bound: the map extent is an XY
bounding rectangle, whereas the mesh can only cover ground that is actually walkable — verticality,
roofs and stacked interiors are not counted once each by this division. Treat it as an order of
magnitude, not an exact percentage of "walkable floor".)*

### Size distribution

| Band | `rp_nycity` | `rp_nycity_day` |
|---|---|---|
| < 1 m² | 39.5% | 35.8% |
| 1–5 m² | 31.9% | 33.0% |
| 5–10 m² | 7.0% | 7.6% |
| 10–50 m² | 14.1% | 14.6% |
| 50–100 m² | 3.5% | 3.7% |
| > 100 m² | 4.0% | 5.2% |

The median (1.21 m²) sits far below the mean (17.7–21.6 m²): a heavy-tailed distribution — a mass of
tiny areas (kerbs, prop bases, stairs) and a handful of enormous ones (open streets, flat roofs)
carrying most of the total surface.

## Auto-generation vs manual retouching — INFERRED, with reservation

This bimodal distribution is **compatible with both hypotheses** and cannot settle the question on
its own:

- native `nav_generate` already produces this pattern: it merges flat unobstructed zones (street,
  roof) into large rectangles and leaves tiny cells near dense geometry (kerbs, stairs, wall bases)
  — Source's merge algorithm produces exactly this heterogeneity with no human involvement;
- manual retouching (merging/splitting areas in the nav editor) would produce the same statistical
  signature: large areas merged by hand over the streets, and the rest left as auto-generation left
  it.

**No signal in the geometry alone (size, connections) separates the two cases** — it would take a
position-by-position comparison against a reference auto-generation on the same map, which was not
done here. Verdict: stated as honestly undetermined rather than guessed.

The mean connection count (4.47–4.58, close to 4 = one per N/E/S/W direction) is consistent with a
regular merged-grid mesh, with no strong sign of hand-added connections in any number.

## Why `rp_nycity_day.nav` is less than half of `rp_nycity.nav` — INFERRED, uncertain

Measured facts: `areaCount` day = 13,260 vs night = 26,711 (ratio 49.6%); coverage day = 44.8% vs
night = 73.9% (ratio 60.6%); the two ratios are close — the "day" mesh is proportionally smaller
*and* less extensive, not merely coarser over the same extent.

The most significant fact is the mismatched `savedBspSize`: the day `.nav` was saved against a
`.bsp` **11.7 MiB smaller** than the one shipped. A nav mesh depends only on collidable geometry,
never on lighting alone — a plain "day/night" recompile changing only textures and
`light_environment` should barely move `areaCount`. A halving suggests instead that the day `.nav`
was generated on an **earlier, less finished version** of the map (less detail, fewer blocked-out
zones), or that `nav_generate` was interrupted or run over a partial zone for that variant.

There is no settling this between hypotheses without the matching `rp_nycity_day.bsp` (absent from
the archive): **stated rather than guessed**. What is solid is that this `.nav` does not describe
the geometry of the shipped `.bsp`.
