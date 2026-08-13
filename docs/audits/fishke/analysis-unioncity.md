# Spatial analysis — rp_unioncity.bsp (Fishke, 2018)

Derived exclusively from the reading in `reading-unioncity.md`. Every density is normalised over the
extent measured by `read_map_extents`: **545,565 m² (54.5565 ha / 545.565 × 1000 m²)**. That is the
area of the world's horizontal *bounding box* (X × Y), not a "streets + buildings" footprint — no
tool here measures a built outline, so it is the only denominator available for comparing the three
maps. Flagged as such everywhere it serves as a base.

## 1. Real playable extent

| Measure | Units | Metres |
|---|---|---|
| X extent | 28,434 | 722.2 m |
| Y extent | 29,740 | 755.4 m |
| Z extent (total height, lowest floor to highest skybox ceiling) | 14,544.00 | 369.4 m |
| Largest horizontal span | 29,740 | 755.4 m |
| Bounding-box area (X×Y) | — | **545,565 m²** |

**Inferred**: at 722 × 755 m, the map is a near-square rectangle. The 369 m height is dominated by
the sky box (`sky_camera`, a single one, §4 of the reading) — it is **not determinable** from
extents alone whether part of that height is real play volume or skybox clearance at the 1:16 scale
typical of a `3d_sky` (the model `models/uc/props_skybox/3d_sky.vvd` exists in the pakfile, §8 of
the reading, which confirms a 3D skybox — its geometry inflates `sizeUnits.Z` without any way here
to isolate its share).

## 2. Usable doors

| Class (measured) | n | Source |
|---|---|---|
| `func_door` | 63 | histogram §4 + brush volumes §6a |
| `func_door_rotating` | 210 | histogram §4 + brush volumes §6b |
| `func_movelinear` | 3 | histogram §4 — **but** the 3 entities (`range1/2/3`) are moving shooting-range targets, not doors (§6c) |
| `prop_dynamic` | 276 | histogram §4 — a generic class, not filterable into "door" without model-by-model inspection |
| `prop_door_rotating` | 24 | histogram §4 + survey §5, a single model (`door_interior_112_01.mdl`) |

**Unambiguous count** (classes that are structurally doors, `func_movelinear` excluded as measured
not to be one): **63 + 210 + 24 = 297 doors**.

Including `func_movelinear` despite the measurement above: 300. **297** is the defensible figure.

A subset identified inside `prop_dynamic` with a model name explicitly meaning "door" (read from the
survey's top-50 `byModel`, §5 — a list not guaranteed exhaustive beyond what it returns):
`safe_door.mdl` (12), `jail_door01.mdl` (9), `apt_door.mdl` (8), `shopdoor1.mdl` (8),
`bathroom_stalldoor.mdl` (6), `freezerdoor.mdl` (2) = **45 further `prop_dynamic`** at minimum that
work visually as doors without being classed as such. The real total of `prop_dynamic` doors is
**not determinable** precisely from the available tools (no semantic filter on model name).

**Plot density** (base 297): 297 / 54.5565 ha = **5.44 doors/ha**, i.e. one door every
**≈ 1,837 m²**. Counting the floor of 45 further `prop_dynamic` doors (342): 6.27 doors/ha, one door
every ≈ 1,596 m².

## 3. Lights

| Class | n |
|---|---|
| `light_spot` | 898 |
| `light` | 251 |
| `light_dynamic` | 9 |
| `light_environment` | 1 |
| `point_spotlight` (additional projected light, counted separately) | 3 |
| **Total classic light entities** | **1,159** |

Compared against the WORLDLIGHTS lump (`read_map_geometry`, §3): **1,151** compiled worldlights for
1,159 declared light entities — a gap of 8, consistent with a handful of light entities being
disabled, out of world, or merged at compile time (VRAD).

**Density**: 1,159 / 54.5565 ha = **21.2 lights/ha**, i.e. one light every ≈ 471 m².

**Pattern**: `light_spot` (898, 77.5% of the total) dominates `light` (251, 21.7%) by a wide margin
— the signature of massively directional/spot lighting (interiors, shop windows, street lamps laid
as spots rather than omnis). No homogeneous grid pattern is **determinable** from a histogram alone:
it gives the composition, not the spatial distribution (no tool here gives the coordinates of the
1,159 lights one by one to judge regular mesh vs concentrated — only 10 `info_player_start` were
sampled in detail, not the lights).

## 4. Props

| Class (covered by `read_prop_survey`) | n |
|---|---|
| `prop_dynamic` | 276 |
| `prop_physics_multiplayer` | 72 |
| `prop_door_rotating` | 24 |
| **Total (`propTotal`)** | **372** |

**Static vs dynamic proportion: not determinable.** `read_prop_survey` covers only point-entity
props (dynamic/physics/door-rotating); `prop_static` lives in the GAME_LUMP (372,704 raw bytes,
§1/§3 of the reading), whose entry count no available tool details. There is no computing a
static/dynamic ratio without that figure — a gap declared rather than estimated.

**Convertible dynamics**: of the 276 `prop_dynamic`, `read_prop_survey`'s heuristic (no name, no
parent, no animation, no output) keeps **149 candidates**, i.e. **54.0%** of the map's
`prop_dynamic`. Recall the tool caveat: candidates only — conversion assumes a model that supports
`prop_static` and breaks any Lua that finds the prop other than by targetname.

**Prop density (covered classes)**: 372 / 54.5565 ha = **6.82 props/ha**.

## 5. Cubemaps

| Source | n |
|---|---|
| Lump 42 CUBEMAPS (`read_map_geometry`) | 361 samples, ceiling `MAX_MAP_CUBEMAPSAMPLES` = 1024 → **35.3% of the ceiling** |
| Cubemap textures baked into the pakfile (`cubemapTextures`, §8) | 426 `.vtf` files |

The gap from 361 samples to 426 textures is consistent: each `env_cubemap` can generate several
packed texture faces or variants, so the file count exceeds the sampling-point count.

**Density**: 361 / 54.5565 ha = **6.62 cubemaps/ha**, one cubemap point every ≈ 1,511 m².

## 6. Lump fill profile — a technical signature

Lumps at ≥ 80% of their compiler ceiling (measured by `read_map_geometry`, `nearLimitCount: 7`):

| Lump | Fraction | Ceiling |
|---|---|---|
| BRUSHES | **97.9%** | 8,192 (MAX_MAP_BRUSHES) |
| TEXINFO | **95.3%** | 12,288 (MAX_MAP_TEXINFO) |
| LEAFBRUSHES | 87.9% | 65,536 |
| OVERLAYS | 84.6% | 512 (MAX_MAP_OVERLAYS) |
| TEXDATA | 84.1% | 2,048 (MAX_MAP_TEXDATA) |
| BRUSHSIDES | 80.7% | 65,536 |
| VERTEXES | 80.4% | 65,536 |

**BRUSHES at 97.9% is the measured bottleneck**: the map is 169 brushes from exhausting the `vbsp`
ceiling (8,023 / 8,192). Any geometric extension by adding brushes (structural or not) risks failing
a recompile without a reduction elsewhere. TEXINFO at 95.3% follows close behind (11,712 / 12,288, a
margin of 576).

Lumps far below (the signature of a map that did not try to optimise visibility or dynamic light):
WORLDLIGHTS 14.1%, AREAS 21.1%, AREAPORTALS 22.2%, TEXDATA_STRING_TABLE 2.6%.

**Combined reading**: brush geometry near saturation + textures/texinfo near saturation, but
visibility volumetry (areas/areaportals) and dynamic lights far from their ceilings → a map built
from many small textured volumes (consistent with 297+ doors as func_door/func_door_rotating, each
its own brush model) rather than an aggressive optimisation of the visibility split.

## 7. Total entity count and engine limits

| Measure | Value |
|---|---|
| Total entities (ENTITIES lump) | **3,388** |
| `MAX_MAP_ENTITIES` (compile ceiling, vbsp) | 8,192 |
| Fraction of the compile ceiling | **41.4%** |
| `MAX_EDICTS` (stock engine runtime ceiling, raised by GMod) | 2,048 |
| Fraction of the runtime ceiling | **165.4%** |

**A measured finding, not an inference**: the compiled map holds 3,388 entities on its own, i.e.
**1.65× the engine's runtime `MAX_EDICTS` ceiling (2048)** — *before* any player, weapon, NPC,
picked-up prop or entity created by a Lua addon joins the game. On a DarkRP server, every connected
player, every weapon, every entity spawned by a job adds to an edict count already in deficit from a
cold map load. It is a structural constraint of the map itself, independent of any addon.

## 8. Sightlines — distribution

| Rank | units | metres |
|---|---|---|
| 1–2 | 15,880 | 403.4 m |
| 3–4 | 15,872 | 403.1 m |
| 5–6 | 15,369 | 390.4 m |
| 7–8 | 15,360 | 390.1 m |
| 9 | 14,859 | 377.4 m |
| 15 (last of the top 15) | 13,836 | 351.4 m |

All of the first 8 lines share the same pair of X bounds (≈ −7694 and ≈ +7666/+8178) at a nearly
fixed Z altitude (5944–5968) — one and the same view corridor measured several times with small Y
variations, not 15 distinct corridors. **One** dominant opening of about 400 m crosses the map,
against the 755.4 m max span: the longest measured sightline covers **53.4%** of the map's longest
axis.

Tool caveat carried over from the reading: it accounts for neither static props nor brush entities
(a closed door reads as open), and has no notion of "street" — this value measures raw world
geometry, not the play experience with doors shut and props in place.

**Inferred, not measured**: on an urban RP map, a 400 m sightline at eye height suggests an avenue
or a clear axis rather than a dense block-by-block fabric — consistent with the door density
measured in §2 (one door every ≈ 1,800 m², so a fairly wide plot pattern rather than a tight one).

## 9. Pakfile — embedded vs external dependency

| Category | file count | Evidence |
|---|---|---|
| Models (mdl/vvd/vtx/phy) | 757+757+2342+697 = 4,553 | complete custom Union City models, geometry + physics + LOD |
| Materials (vmt/vtf) | 2,998+2,847 = 5,845 | textures and materials specific to the map |
| Per-vertex static lighting (`.vhv`) | **7,426** | direct evidence that `buildcubemaps`/static-prop vertex lighting was baked (tool description) |
| Sounds (wav/mp3) | 195+5 = 200 | embedded `ucsounds/` ambiences and music |
| Cubemap textures (`c-*.vtf`) | 426 | evidence that `buildcubemaps` ran (tool description) |
| Miscellaneous (txt/raw) | 4 | — |
| **Pakfile total** | **18,028 files / 664.8 MB** | |

**Measured**: the pakfile (89.4% of the .bsp's total weight, §1 of the reading) embeds every asset
under the prefixes `uc/`, `unioncity`, `unioncity2`, `ucsounds/`, `clubzombo/` — all the content
visibly specific to this map.

**Not determinable from the pakfile alone**: which external dependencies (HL2/CS:S assets or other
mounted games, or a separate Steam Workshop content pack) the map assumes present without embedding
them. The pakfile lists what is *inside*; it says nothing about what is *missing* client-side — a
client without the right mounted game or addon could have missing-asset errors despite these 18,028
files. No tool in this reading compares the pakfile against the material and model references used
in the FACES/MODELS lumps to detect a gap.

## Normalised summary (for comparison with the other two maps)

| Indicator | Raw value | Density /ha | Density /1000 m² |
|---|---|---|---|
| Extent (bounding box X×Y) | 545,565 m² | — | — |
| Unambiguous doors (func_door + func_door_rotating + prop_door_rotating) | 297 | 5.44 | 0.544 |
| Lights (light + light_spot + light_dynamic + light_environment) | 1,159 | 21.2 | 2.12 |
| Props (classes covered by the survey) | 372 | 6.82 | 0.682 |
| — of which convertible `prop_dynamic` (candidates) | 149 | 2.73 | 0.273 |
| Cubemaps (lump samples) | 361 | 6.62 | 0.662 |
| Total entities | 3,388 | 62.1 | 6.21 |

One figure deliberately absent from this table: the prop_static / prop_dynamic proportion — not
measurable here, and not to be filled in with an estimate.
