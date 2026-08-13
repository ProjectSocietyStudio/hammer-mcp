# Spatial analysis — rp_nycity.bsp (Fishke, 2022)

Derived solely from the reading in `reading-nycity.md`. Every value below marked **[measured]**
comes straight from a tool call; every value marked **[inferred]** is a calculation or an
interpretation built on those measurements.

## 1. Real playable extent

**[measured]** World model bounding box (lump MODELS[0]): 31,600 × 31,360 × 16,704 units, i.e.
802.6 × 796.5 × 424.3 m. XY area of the bounding box: **639,338 m²** (63.93 ha, 0.6393 km²).

**[inferred]** That is an upper bound, not the real playable extent: the bounding box includes the
3D skybox (`sky_camera` present, ×1) and all unbuilt void inside the box. The compiled .bsp no
longer carries the structural/func_detail information or the visgroups that would separate "built"
from "void" — not determinable from a compiled .bsp. Every density below is therefore a floor (they
underestimate real density if the built area is smaller than the box).

## 2. Usable doors and plot density

**[measured]** Histogram: `func_door_rotating` 451, `func_door` 171, `func_movelinear` 4,
`prop_door_rotating` 0 (absent); `func_door_rotating` + `func_door` = total ground footprint
(bounding box) 88.65 + 112.93 = 201.58 m² over 622 entities.

**[inferred]** Total doors in the strict sense (the requested classes present) = 451 + 171 + 4 =
**626**. `prop_dynamic` (59) is not counted as a door by default because the class does not
guarantee it; filtering by model name in the prop survey, 13 models look like doors
(`jail_door01.mdl` ×5, `freezerdoor.mdl` ×3, `bathroom_stalldoor.mdl` ×3, `bankdoor_wheel.mdl` ×1,
`bankvault_door.mdl` ×1) — these are doors animated by Lua or skin rather than by brush, so counted
separately.

Density, against the measured extent (639,338 m² = 63.93 ha):

| Base | Density |
|---|---|
| 626 strict doors | **9.8 doors/ha** (≈ 979/km²) |
| 639 (strict doors + 13 prop-doors) | 10.0 doors/ha (≈ 999/km²) |

Adding `func_button` (183) and `func_rot_button`/`momentary_rot_button` (16+9=25) — activators often
tied to a plot (switch, vending machine, lift) — the total of interactive elements tied to the built
fabric rises to 626+183+25 = 834, i.e. 13.0/ha. Read that as a ceiling on interaction density, not
plot density in the strict sense: one plot may carry several doors (front door plus service door) or
no dedicated button at all.

## 3. Lights: density and pattern

**[measured]** `light` 203, `light_spot` 1889, `light_dynamic` 13, `light_environment` 1 (a single
sun). `WORLDLIGHTS` (lump 15, baked by vrad) = 2094 entries.

**[inferred]** Total light entities = 203+1889+13+1 = **2106**. Consistency with `WORLDLIGHTS`
(2106 − 13 unbaked dynamics = 2093 ≈ 2094 measured) confirms that nearly all static sources were
indeed baked — no orphan light visible at this level.

Density: 2106 / 63.93 ha = **32.9 lights/ha** (≈ 3294/km²), i.e. one light every ≈ 17.4 m² on
average across the whole extent.

The pattern: `light_spot` dominates at 89.7% of light entities (1889/2106) against `light` at 9.6%.
A `light_spot` is directional — typical of a street lamp, a sign, a shop-window spot — where an
omnidirectional `light` serves room ambience. That ratio, combined with 25 + 11 + 2 = 38 street
lamps (`streetlight_traffic_rev.mdl`, `streetlight_traffic_longer.mdl`,
`streetlight_traffic_1ped.mdl`) in the prop survey, points to **systematic** urban lighting rather
than pointwise dramatisation by zone: the per-hectare density is too uniform (close to the
lights-per-door ratio of 3.4:1) to be concentrated on a few scripted spots. This remains a reading
of the global histogram alone — without the XY positions of each `light_spot` (not extracted, too
large a volume for this reading), spatial regularity is not proved, only plausible.

## 4. Props: static vs dynamic

**[measured]** `read_prop_survey`: `propTotal` 170, of which `prop_physics_multiplayer` 111 and
`prop_dynamic` 59. The tool states explicitly that it does **not** cover `prop_static` (stored in
the GAME_LUMP, not the ENTITIES lump).

**[inferred]** No real static/dynamic ratio can be given: the `prop_static` count was not measured
(a declared tooling gap, not an estimate). What can be said: of the 170 props that *cost* a runtime
edict (physics + dynamic, none free unlike prop_static), 65.3% (111/170) are
`prop_physics_multiplayer` — necessarily dynamic, physics demands it — and 34.7% (59/170) are
`prop_dynamic`, whose need to be dynamic is not guaranteed by the class alone.

Of those 59 `prop_dynamic`, **17 (28.8%)** are candidates for conversion to `prop_static` under the
tool's criterion (no name, no parent, no animation, no output). The most represented model among the
candidates is `hotelflag.mdl` (9/17, a plain decorative hotel flag) — consistent with a purely
visual object that had no reason to be dynamic. Conversion not applied here (read-only, requires a
recompile).

Measured prop density (excluding static): 170/63.93 ha = 2.66/ha (≈ 266/km²) — to be read as a very
strict floor, since static scenery, presumably the biggest visual contributor on an urban map, is
absent from this count.

## 5. Cubemaps

**[measured]** CUBEMAPS lump (42): 168 samples (16.4% of the `MAX_MAP_CUBEMAPSAMPLES` ceiling of
1024). Pakfile: `cubemapTextures` 285 embedded `c-*.vtf` files, `staticPropLighting` (.vhv) 3991
files.

**[inferred]** Cubemap density: 168/63.93 ha = **2.63 cubemaps/ha** (≈ 263/km²), i.e. one sample
every ≈ 3,805 m². The ratio of embedded textures to samples (285/168 ≈ 1.7) is consistent with
several `.vtf` files per HDR/LDR sample plus mips, not with missing cubemaps — `buildcubemaps` did
run (presence confirmed by `cubemapTextures` > 0). The presence of 3991 `.vhv` files (baked
per-static-prop lighting) is itself an indirect sign of a high `prop_static` count — consistent with
the gap in point 4 — but remains an inference, not a measurement of the real count.

## 6. Lump fill profile — a technical signature

**[measured]** 4 lumps at ≥ 80% of their stock vbsp ceiling:

| Lump | Fraction | Reading |
|---|---|---|
| MODELS | 118.8% | **exceeds** the SDK 2013 ceiling (1024) — the compilers used (probably plusplus or a raised host toolset) lifted it, or the compile would have failed |
| TEXINFO | 95.8% | nearly saturated |
| VERTEXES | 94.8% | nearly saturated |
| BRUSHES | 84.6% | near the ceiling |

The lumps that are large but far from a structural ceiling (PLANES 33.4%, NODES 34.3%, FACES 51.4%,
SURFEDGES 47.5%) show that raw geometry is not the limiting factor — it is the **number of brush
models** (a direct function of the number of brush entities: 1217 `MODELS`, see the table in §7) and
the **number of distinct textures applied** (TEXINFO) that approach or exceed the stock ceilings.

**[inferred]** This map's signature: very little void (the geometric lumps do not saturate), but an
enormous number of individualised brush entities (1217 models, 6928 brushes) and distinct texture/UV
combinations (11,774 texinfo) — consistent with a detailed urban map made of a great many small
functional objects (626 doors, 183 buttons…) rather than large uniform surfaces. It is that
granularity that forced an overrun of the stock `MAX_MAP_MODELS` ceiling, not the size of the extent
in itself.

## 7. Total entities and engine limits

**[measured]** ENTITIES lump histogram: **4287** entities in total (lump 0, 1,856,904 bytes).
`MAX_MAP_ENTITIES` (vbsp compile ceiling) = 8192. `MAX_EDICTS` (stock engine runtime ceiling) =
2048.

**[inferred]** 4287/8192 = **52.3%** of the compile ceiling — a comfortable margin on the compiler
side. But 4287 already exceeds, on its own, the stock runtime ceiling of 2048 edicts — **before**
counting the game's dynamic edicts (players, weapons, vehicles, DarkRP entities created in game).
This map can only run under an engine whose edict ceiling has been raised — which GMod does (per the
task statement: "MAX_EDICTS = 2048 in stock engine runtime, raised by GMod"). So it is not an
anomaly of the map but a structural constraint: `rp_nycity` is, by construction, incompatible with
an unpatched stock Source server.

Entity density: 4287/63.93 ha = **67.1 entities/ha** (≈ 6706/km²).

## 8. Longest sightlines and the city's openness

**[measured]** Longest measured sightline: **30,278 units (769.1 m)**, between [−2880,−15680,64] and
[6848,12992,328]. The 20 longest spread from 769.1 m to 734.3 m — a tight interval of 34.8 m (4.5%
between the 1st and the 20th).

**[inferred]** 769.1 m is 95.8% of the map's largest measured horizontal span (802.6 m): somewhere
in `rp_nycity` you can see almost from one end of the bounding box to the other. But the list of the
20 longest sightlines comes from only a handful of repeated source points (`x=−2880`,
`y∈{−15680,−15168}` on one side; `x∈{−2880,−2368}`, `y∈{12480,12992}` on the other) toward a handful
of equally repeated destinations (`x∈{5312..6848}, y≈12480–12992` and `x∈{7872,8384}`,
`y≈−14144..−13632`). This is not diffuse openness across the map — it is one or two very long
straight corridors or streets (probably a through avenue or a river/harbour axis, consistent with
the name `unioncity3` and the presence of `func_tracktrain` ×9 and `subwaytrain.mdl` assets) that
carry most of the view range. The rest of the city is presumably more compartmented — not measured
directly (the tool keeps only the top 20), so this reading remains an extrapolation, not a
measurement of the full distribution.

Note, recalling the tool's `excludes`: these sightlines ignore closed doors (counted open) and
static props (ornamental buildings included) — the real in-game range, with doors shut and static
scenery included, is probably **less** than what is measured here.

## 9. Pakfile — what Fishke embeds

**[measured]** 15,135 files, 1,073,436,397 bytes (1023.7 MB) — i.e. **94.0%** of the total file size
(1,142,853,009 bytes). vhv 3991, vtx 2821, vmt 2782, vtf 2542, mdl 939, vvd 939, phy 866, wav 188,
mp3 63, txt 2, vbsp 1, ain 1.

**[inferred]** Fishke embeds his custom content chain in full: materials (vmt/vtf), complete models
with their render and collision geometry (mdl/vvd/phy at near-equal counts — 939/939/866, consistent
with a largely custom model set under `unioncity2/3`), and the whole sound dressing (251 audio
files, wav + mp3). None of it is left as an external dependency — a server mounting this .bsp needs
no third-party Workshop addon to display the map as compiled. It is that total embedding, and in
particular the uncompressed `.wav` club tracks (up to 11.3 MB each, 15 tracks ≈ 140 MB on their
own), that explains most of the file's 1.14 GB — geometry and structural lumps weigh only ≈ 67 MB
(1,142,853,009 − 1,075,762,805 bytes of PAKFILE).

The only files not embedded, and so potential external dependencies: nothing identifiable in this
reading — `ain` (1, AI nav mesh) and `vbsp` (1, probably the compile log/version file) are internal
artefacts, not dependencies. No evidence of a missing external dependency was found in this reading;
absence of evidence is not evidence of absence — unverified beyond the pakfile's own content.

## 10. Normalised summary (for cross-map comparison)

| Metric | Raw value | Normalised /ha | Normalised /km² |
|---|---|---|---|
| Extent (XY bounding box) | 639,338 m² | — | — |
| Total entities | 4287 | 67.1 | 6706 |
| Strict doors (626) | 626 | 9.8 | 979 |
| Lights | 2106 | 32.9 | 3294 |
| Props (excluding static, unmeasured) | 170 | 2.66 | 266 |
| Cubemaps | 168 | 2.63 | 263 |
| Max sightline | 769.1 m | — | 95.8% of the max measured span |
| Pakfile weight | 1023.7 MB | 16.0 MB/ha | 1601 MB/km² |
