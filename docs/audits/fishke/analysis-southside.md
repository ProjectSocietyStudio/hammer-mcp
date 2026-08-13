# Spatial analysis — rp_southside.bsp (Fishke, 2020)

Derived solely from the reading in `reading-southside.md`. Each section separates MEASURED (taken
straight from the reading) from INFERRED (a calculation or a cross-reading). All densities are
normalised per playable hectare (ha) and per 1000 m², for later comparison with the other two maps.

Area reference: **603,776 m² = 60.3776 ha** (world model bbox, `read_map_extents`).

## 1. Real playable extent

**MEASURED**: world bbox (model 0, MODELS lump) = 30,720 × 30,464 × 11,296 units =
780.3 × 773.8 × 286.9 metres. Ground area of the bbox: 603,776 m² (60.38 ha).

**INFERRED**: this bbox covers the whole world model, so very probably the 3D skybox (Source
convention: a distant miniature connected by `sky_camera` — the map has exactly 1, `sky_camera:1` in
the histogram). The 286.9 m vertical height (−9216 to +2080 units) far exceeds a street-plus-blocks
envelope; part of that vertical and horizontal extent is therefore not ground actually walked by a
player. **Not precisely determinable from the tools provided**: no tool separates "real world"
geometry from "3D skybox" geometry in a compiled .bsp (they share the same MODELS lump, only the
scale differs and it is not exposed). So the 60.38 ha area is an upper bound on the playable extent,
not a measurement of it.

## 2. Usable doors and plot density

**MEASURED** (`read_bsp_entities` histogram + `read_brush_volumes`):

| Class | Count | Nature |
|---|---|---|
| func_door | 149 | brush entity |
| func_door_rotating | 403 | brush entity |
| func_movelinear | 2 | brush entity (`GTarget1/2` targets, probably not plot doors — generic target names) |
| prop_door_rotating | 0 | absent from this map |
| prop_dynamic | 383 | model — a subset not isolable as "door" without model-by-model inspection |

Unambiguous brush-door total: **554** (149+403+2).

**INFERRED**: in the top-50 `prop_dynamic`/`prop_physics_multiplayer` models returned by
`read_prop_survey`, at least 4 models are plainly leaves: `glassdoor.mdl` (10),
`bathroom_stalldoor.mdl` (9), `jail_door01.mdl` (7), `cell_door.mdl` (6) — i.e. **32 further
identifiable doors**, out of a `prop_dynamic` total of 383 of which only the 50 most frequent models
are listed. The real number of `prop_dynamic` doors is therefore **≥ 32, a lower bound**, the survey
not covering low-count models.

**Density (lower bound, 554 brush doors):**
- 554 / 60.3776 ha = **9.18 doors/ha**
- 554 / 603,776 m² = **0.92 doors per 1000 m²**, i.e. one door every **1,090 m²** on average.

With the 32 identified `prop_dynamic` added (586 doors): 9.71/ha — the gap between bounds stays
small (+6%); the brush measurement dominates the door count by a wide margin.

## 3. Lights: density and pattern

**MEASURED**: `light_spot` 1421 + `light` 338 = **1759** point/spot light entities in the ENTITIES
lump, consistent with `WORLDLIGHTS` (1761 in `read_map_geometry`, a gap of 2 — probably
`light_environment` ×1 and one culled/duplicated entity delta, unresolved by the tools).
`light_dynamic` (runtime, not baked): 7, outside this count.

**Density**:
- 1759 / 60.3776 ha = **29.1 lights/ha**
- 1759 / 603.776 (in thousands of m²) = **2.91 lights per 1000 m²**

**INFERRED**: `read_sightlines` samples 1008 floor points on a 512-unit grid (≈13 m) with a
"nearby content" filter. The ratio of lights to sampled floor points (1759/1008 ≈ 1.75) suggests
sustained coverage rather than isolated concentration in a few zones — but **the precise spatial
pattern (a regular street grid vs concentrated interiors) is not measurable** with the available
tools: none aggregates `light`/`light_spot` origins by zone. Only the isolated occurrence of
`WORLDLIGHTS` at 21.5% of the ceiling (8192) indicates a large margin — the map is far from
saturating its static-light budget.

## 4. Props: static vs dynamic, conversion candidates

**MEASURED** (`read_prop_survey`):
- `propTotal` (prop_dynamic + prop_physics_multiplayer) = **481**
- `prop_dynamic` = 383 (79.6% of propTotal)
- `prop_physics_multiplayer` = 98 (20.4% of propTotal)
- `staticCandidates.total` = **261** `prop_dynamic` with no name, no parent, no animation, no
  output — candidates for conversion to `prop_static` (subject to a recompile and to model support,
  see the tool's warning)

**prop_static not found**: none of the tools provided exposes the `prop_static` count (they live in
the GAME_LUMP, lump 35, outside the scope of `read_bsp_entities`/`read_prop_survey`). **Not
determinable**: the map's real static-to-dynamic proportion; only the proportion within the measured
classes (dynamic/physics) is.

**INFERRED**:
- 261/383 = **68.1%** of `prop_dynamic` are conversion candidates (no functional reason to be
  dynamic).
- 261/481 = **54.3%** of all measured props (dynamic + physics) are candidates.
- Measured prop density: 481 / 60.3776 ha = **7.97 props/ha** (excluding statics, so an
  underestimate of total scenery density).
- Most repeated model: `alley_trashcan.mdl` ×44, followed by `lightswitch.mdl` ×38 — consistent with
  repetitive urban street furniture rather than unique pieces.
- The `.vhv` files (per-vertex static lighting, pakfile) number 7656 — an indirect sign (not a
  direct count; the tool documents it as evidence the bake happened, not as a prop count) that a
  substantial number of `prop_static` exist and received baked lighting, well beyond the 481
  dynamic/physics props measured. **This is not a measurement of the prop_static count** — only a
  sign that they are numerous.

## 5. Cubemaps

**MEASURED**:
- `CUBEMAPS` (lump 42, `read_map_geometry`): **239** samples, 23.3% of the ceiling (1024)
- `cubemapTextures` (pakfile, `c-*.vtf` files): **322** baked textures

**INFERRED**: the gap of 239 samples vs 322 textures (+83) may be explained by the default cubemap
(implicit `env_cubemap`) or by separate HDR/LDR textures for the same sampling point — unresolved by
the available tools.

**Density**: 239 / 60.3776 ha = **3.96 cubemaps/ha**, i.e. one sample every **2,527 m²** on average
— consistent with an urban map full of interiors (each distinct interior typically wants its own
cubemap for a correct reflection).

## 6. Lump fill profile — a technical signature

**MEASURED** (`nearLimitCount: 6`, lumps at ≥ 80% of the vbsp ceiling):

| Lump | % of ceiling | Reading |
|---|---|---|
| LEAFBRUSHES | 99.8% | nearly saturated |
| MODELS | 98.4% | nearly saturated (1008/1024 brush entities) |
| VERTEXES | 96.0% | near saturation |
| TEXINFO | 93.0% | near saturation |
| BRUSHES | 91.4% | near saturation |
| TEXDATA | 82.0% | near the threshold |

Lumps with wide margin (< 40% of the ceiling): PLANES (32.1%), AREAPORTALS (35.8%), AREAS (37.9%),
WORLDLIGHTS (21.5%), CUBEMAPS (23.3%), TEXDATA_STRING_TABLE (2.6%).

**INFERRED**: this map's signature is one of **dense brushwork geometry** (LEAFBRUSHES, BRUSHES,
MODELS, VERTEXES all above 90%) built with **relatively few unique materials**
(TEXDATA_STRING_TABLE at only 2.6%, while TEXDATA itself is at 82% — many `texinfo`/`texdata` reuse
a restricted set of material strings). `MODELS` at 98.4% (1008 of 1024 brush models) is the nearest
constraint: **adding one more brush entity risks hitting `MAX_MAP_MODELS`** without first reducing
the number of brush entities (doors, buttons, triggers). It is this map's closest structural limit,
ahead even of `LEAFBRUSHES`.

## 7. Total entity count and margin against the limits

**MEASURED**: ENTITIES lump = **5122** entities (`read_bsp_entities`, `total`/`matched`).

**INFERRED**:
- vs `MAX_MAP_ENTITIES` = 8192 (vbsp compile limit): 5122/8192 = **62.5%** — a 37.5% margin before
  a recompile is blocked.
- vs `MAX_EDICTS` = 2048 (stock engine runtime limit): 5122/2048 = **250%** — **the compiled .bsp's
  entity count alone already exceeds 2.5× the engine's stock ceiling**, before adding players,
  `prop_physics` created in game, NPCs or any other edict allocated at runtime. In practice this map
  is only playable under GMod thanks to an edict ceiling raised by GMod (the brief says so
  explicitly: "raised by GMod") — **the value GMod raises it to was not itself measured by the
  hammer-mcp tools**, which only reach the offline file. Not determinable beyond that caveat.
- Entity density: 5122 / 60.3776 ha = **84.8 entities/ha**, or 8.48 per 1000 m².

## 8. Longest sightlines

**MEASURED**: the longest measured sightline is **28,068 units = 712.9 m** (512-unit grid, 1008
points, 507,528 pairs tested), between [−14592,−5376,358] and [12544,−12544,70]. The 15 longest
spread from 712.9 m to 691.2 m — a gap of only **21.7 m across the top 15**.

**INFERRED**:
- 712.9 m is **91.4%** of the map's largest horizontal span (780.3 m, `spanMetres`) — the longest
  sightline crosses nearly the whole diagonal of the bbox.
- All 15 longest lines share a clustered origin (x ≈ −14592/−14080, y ≈ −5376 to −11520) and a
  near-unique destination ([12544,−12544,70], repeated 8 times out of 15, or close to it). **A
  single pair of zones dominates the ranking**: this is not a general openness of the map but one
  isolated long axis — consistent with a straight street corridor, a river or an industrial no
  man's land crossing the map diagonally (to be confirmed visually, not determinable from the data
  alone).
- The tool excludes brush entities (doors read as open) and static props: the real distance
  perceived in game, with doors shut and furniture in place, is therefore **at most** what is
  measured here, and probably less.

## 9. Pakfile — embedded content

**MEASURED**: 17,942 files, 882,003,068 bytes (841.1 MB), i.e. 843.63 MB of PAKFILE lump (close to
the whole .bsp: 843.63/984.4 MB ≈ **85.7% of the .bsp's total weight**).

| Type | Count | Role |
|---|---|---|
| .vhv | 7656 | baked per-vertex static lighting (evidence the static-prop lighting bake happened) |
| .vmt | 2721 | material scripts |
| .vtx/.vvd/.phy | 2625/850/783 | compiled meshes + model collision |
| .vtf | 2144 | textures |
| .mdl | 850 | compiled models |
| .wav | 309 | sounds (including almost all the pak's largest files: club music tracks at 7.8–10.3 MB each) |
| .txt | 3 | miscellaneous scripts (not identified in detail — outside the `limit:100`) |
| .raw | 1 | unidentified |

**INFERRED**: cubemaps (322 `c-*.vtf` textures) and static lighting (7656 `.vhv`) are both embedded
— the map ships with its full bake, nothing to recompute client-side. **External dependencies**: not
determinable by a negative list — the pakfile does not say what is *missing*, only what it contains.
The absence of base-game `materials/`/`models/` files (HL2/CSS/etc.) from the pak is expected (the
base game provides them client-side) but **not verifiable** without comparing every material and
model reference used in the map against what is packed — outside the scope of `read_pakfile`, which
lists content, not unresolved references.

## Normalised summary table (per ha, base 60.3776 ha)

| Measure | Raw value | Per ha | Per 1000 m² |
|---|---|---|---|
| Total entities (lump 0) | 5122 | 84.8 | 8.48 |
| Brush doors (func_door + func_door_rotating + func_movelinear) | 554 | 9.18 | 0.92 |
| Lights (light + light_spot) | 1759 | 29.1 | 2.91 |
| Measured props (prop_dynamic + prop_physics_multiplayer) | 481 | 7.97 | 0.80 |
| Cubemaps | 239 | 3.96 | 0.40 |

Normalisation base: 603,776 m² / 60.3776 ha — world model bbox, an upper bound on the real playable
extent (§1).
