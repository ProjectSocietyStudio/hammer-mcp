# Raw reading — rp_unioncity.bsp (Fishke, 2018)

Map: `rp_unioncity.bsp`, extracted from the Workshop into a scratch directory (path local to the
machine that took the reading, not reproduced here).
File size: 782,453,803 bytes (746.3 MiB / 0.78 GB as declared).

Each section = one tool call actually executed, with its parameters and its raw result.

> ⚠️ The lump-name table used at the time named lump 56 "LIGHTING_HDR", which is wrong — it is
> `LEAF_AMBIENT_LIGHTING`. The naming error is left in §1 as it was recorded; see
> `longitudinal-synthesis.md` §5 for the correction and what it changed.

## 1. `read_bsp_info` (parameters: `path`, `allLumps` default = false)

| Field | Value |
|---|---|
| ident | VBSP |
| version | 20 |
| mapRevision | 29319 |
| fileSize | 782,453,803 bytes |
| lumpCount (non-empty) | 52 |

The 10 largest lumps:

| Lump | Name | Bytes | MB |
|---|---|---|---|
| 40 | PAKFILE | 699,602,443 | 667.19 |
| 8 | LIGHTING | 26,612,388 | 25.38 |
| 53 | LIGHTING_HDR | 26,612,388 | 25.38 |
| 4 | VISIBILITY | 5,729,549 | 5.46 |
| 29 | (unnamed, lump 29) | 2,834,068 | 2.70 |
| 55 | (unnamed, lump 55) | 2,780,344 | 2.65 |
| 56 | LIGHTING_HDR (physical?) | 2,780,344 | 2.65 |
| 7 | FACES | 1,711,528 | 1.63 |
| 58 | FACES_HDR | 1,711,528 | 1.63 |
| 33 | (unnamed, lump 33) | 1,562,580 | 1.49 |
| 0 | ENTITIES | 1,288,239 | 1.23 |

The PAKFILE alone is 89.4% of the file (699,602,443 / 782,453,803).

## 2. `read_map_extents` (parameters: `path`)

| Field | Value |
|---|---|
| modelCount | 535 |
| mins (units) | [−15630, −15852, −7184.00] |
| maxs (units) | [12804, 13888, 7360] |
| sizeUnits (X, Y, Z) | [28434, 29740, 14544.00] |
| sizeMetres (X, Y, Z) | [722.2, 755.4, 369.4] |
| spanUnits (max horizontal) | 29740 |
| spanMetres | 755.4 |
| areaSquareMetres (bounding box X×Y) | 545,565 |
| metresPerUnit | 0.0254 |

## 3. `read_map_geometry` (parameters: `path`, `nearLimitOnly` default = false)

`nearLimitCount` returned by the tool: 7 (lumps at ≥ 80% of their compiler ceiling).

| Lump | Bytes | Count | Limit | Limit name | Fraction used |
|---|---|---|---|---|---|
| ENTITIES | 1,288,239 | — | 8192 | MAX_MAP_ENTITIES | n/a (count not given here, see §4) |
| PLANES | 429,320 | 21,466 | 65,536 | MAX_MAP_PLANES | 0.328 |
| TEXDATA | 55,136 | 1,723 | 2,048 | MAX_MAP_TEXDATA | 0.841 |
| VERTEXES | 632,124 | 52,677 | 65,536 | MAX_MAP_VERTS | 0.804 |
| VISIBILITY | 5,729,549 | — | — | — | — |
| NODES | 710,336 | 22,198 | 65,536 | MAX_MAP_NODES | 0.339 |
| TEXINFO | 843,264 | 11,712 | 12,288 | MAX_MAP_TEXINFO | 0.953 |
| FACES | 1,711,528 | 30,563 | 65,536 | MAX_MAP_FACES | 0.466 |
| LIGHTING | 26,612,388 | — | — | — | — |
| OCCLUSION | 1,092 | — | — | — | — |
| LEAFS | 727,488 | — | 65,536 | MAX_MAP_LEAFS | — |
| FACEIDS | 61,126 | — | — | — | — |
| EDGES | 521,348 | 130,337 | 256,000 | MAX_MAP_EDGES | 0.509 |
| SURFEDGES | 844,352 | 211,088 | 512,000 | MAX_MAP_SURFEDGES | 0.412 |
| MODELS | 25,680 | 535 | 1,024 | MAX_MAP_MODELS | 0.522 |
| WORLDLIGHTS | 101,288 | 1,151 | 8,192 | MAX_MAP_WORLDLIGHTS | 0.141 |
| LEAFFACES | 80,954 | 40,477 | 65,536 | MAX_MAP_LEAFFACES | 0.618 |
| LEAFBRUSHES | 115,156 | 57,578 | 65,536 | MAX_MAP_LEAFBRUSHES | 0.879 |
| BRUSHES | 96,276 | 8,023 | 8,192 | MAX_MAP_BRUSHES | 0.979 |
| BRUSHSIDES | 423,312 | 52,914 | 65,536 | MAX_MAP_BRUSHSIDES | 0.807 |
| AREAS | 432 | 54 | 256 | MAX_MAP_AREAS | 0.211 |
| AREAPORTALS | 2,724 | 227 | 1,024 | MAX_MAP_AREAPORTALS | 0.222 |
| DISP_VERTS | 181,808 | — | — | note: 181,808 bytes is not a multiple of the 20 bytes per record expected in this BSP version | |
| GAME_LUMP | 372,704 | — | — | — | — |
| PAKFILE | 699,602,443 | — | — | — | — |
| CUBEMAPS | 5,776 | 361 | 1,024 | MAX_MAP_CUBEMAPSAMPLES | 0.353 |
| TEXDATA_STRING_DATA | 79,920 | — | 256,000 | MAX_MAP_TEXDATA_STRING_DATA | — |
| TEXDATA_STRING_TABLE | 6,892 | 1,723 | 65,536 | — | 0.026 |
| OVERLAYS | 152,416 | 433 | 512 | MAX_MAP_OVERLAYS | 0.846 |
| LIGHTING_HDR | 26,612,388 | — | — | — | — |
| FACES_HDR | 1,711,528 | 30,563 | — | — | — |

Lumps at ≥ 80% of their ceiling (the 7 counted by the tool): TEXINFO (0.953), BRUSHES (0.979),
OVERLAYS (0.846), TEXDATA (0.841), LEAFBRUSHES (0.879), VERTEXES (0.804), BRUSHSIDES (0.807).

## 4. `read_bsp_entities` (full histogram)

Parameters: `path`, `histogramOnly: true`.

| Field | Value |
|---|---|
| lumpBytes | 1,288,238 |
| total (entities read) | 3,388 |
| matched | 3,388 |

Full histogram (classname → count):

| classname | n |
|---|---|
| light_spot | 898 |
| prop_dynamic | 276 |
| light | 251 |
| infodecal | 220 |
| func_door_rotating | 210 |
| env_soundscape_proxy | 193 |
| env_sprite | 176 |
| path_track | 134 |
| keyframe_rope | 101 |
| info_player_start | 90 |
| trigger_soundscape | 87 |
| func_areaportal | 72 |
| info_particle_system | 72 |
| prop_physics_multiplayer | 72 |
| func_button | 70 |
| func_door | 63 |
| func_brush | 48 |
| info_target | 47 |
| func_areaportalwindow | 41 |
| move_rope | 39 |
| info_ladder | 31 |
| env_soundscape_triggerable | 30 |
| prop_door_rotating | 24 |
| func_breakable_surf | 15 |
| ambient_generic | 14 |
| point_template | 11 |
| func_occluder | 9 |
| light_dynamic | 9 |
| func_tracktrain | 8 |
| logic_relay | 8 |
| env_fire | 6 |
| func_dustmotes | 4 |
| func_rotating | 4 |
| trigger_hurt | 4 |
| env_shake | 3 |
| func_breakable | 3 |
| func_movelinear | 3 |
| func_reflective_glass | 3 |
| func_smokevolume | 3 |
| logic_timer | 3 |
| point_spotlight | 3 |
| trigger_push | 3 |
| trigger_teleport | 3 |
| func_useableladder | 2 |
| info_ladder_dismount | 2 |
| logic_measure_movement | 2 |
| trigger_multiple | 2 |
| color_correction | 1 |
| env_fog_controller | 1 |
| env_spark | 1 |
| env_tonemap_controller | 1 |
| env_wind | 1 |
| func_wall_toggle | 1 |
| info_landmark | 1 |
| light_environment | 1 |
| logic_auto | 1 |
| logic_case | 1 |
| math_counter | 1 |
| point_teleport | 1 |
| shadow_control | 1 |
| sky_camera | 1 |
| water_lod_control | 1 |
| worldspawn | 1 |

Additional detail: `classname: info_player_start` (parameter `limit: 10`) → 90 spawns in total (from
the histogram), the first 10 listed, all clustered around
`[5360–5440, −1608 to −1488, 4801]`, `angles [0,180,0]` — a single spawn cluster visited in this
sample.

A `classnameContains: "cubemap"` call on `read_bsp_entities` → **0 results**. Cubemaps are not
entities of the ENTITIES lump; their count (361) comes from lump 42 CUBEMAPS read by
`read_map_geometry` (§3).

## 5. `read_prop_survey` (parameters: `path`, `limit: 50`)

| Field | Value |
|---|---|
| totalEntities (whole map) | 3,388 |
| propTotal (prop classes covered by the tool) | 372 |
| byClass.prop_dynamic | 276 |
| byClass.prop_physics_multiplayer | 72 |
| byClass.prop_door_rotating | 24 |

⚠️ The tool covers only entities of class `prop_dynamic`, `prop_physics_multiplayer`,
`prop_door_rotating` (i.e. *point-entity* props). `prop_static` does not live in the ENTITIES lump
but in the GAME_LUMP (372,704 bytes, §1/§3); its individual count is not returned by this tool — a
declared gap, no invented figure.

Top models (byModel, a list truncated to what the tool returns, not guaranteed exhaustive beyond its
frequency sort): `door_interior_112_01.mdl` (24, = all the `prop_door_rotating`),
`vending_machine01.mdl` (20), `cafe_chair.mdl` (16), `snack_machine_01a.mdl` (15),
`cash_register.mdl` (14), `lamp_side_trlight.mdl` (12), `downtown_walk_light02.mdl` (12),
`safe_door.mdl` (12), `jail_door01.mdl` (9), `flag_02.mdl` (9), `shelf_empty.mdl` (9), etc. (full
list of 50 entries in the tool's raw response).

`staticCandidates` (prop_dynamic with no name, no parent, no animation, no output — theoretical
candidates for conversion to `prop_static`):

| Field | Value |
|---|---|
| total | 149 |
| returned (capped by `limit`) | 50 |

⚠️ The tool's caveat, reproduced as-is: "Candidates only. Conversion needs a recompile, the model
must support static props, and Lua that finds a prop by anything other than targetname would still
lose it."

## 6. `read_brush_volumes`

### 6a. `classname: func_door`, `limit: 200`

| Field | Value |
|---|---|
| brushModels (map total) | 534 |
| attributed | 63 |
| count | 63 |
| medianFloorSquareMetres | 0.07 |
| totalFloorSquareMetres | 55.22 |

The 3 largest: `grgcl` (23.69 m², 0.13 m tall), `laundrydr` (13.87 m², 0.25 m), `wrh01d` (2.51 m²,
6.1 m). The large `floorSquareMetres` with low height (0.13 m, 0.25 m) give away hatches and
horizontal doors, not classic vertical doors.

### 6b. `classname: func_door_rotating`, `limit: 250`

| Field | Value |
|---|---|
| brushModels (map total) | 534 |
| attributed | 210 |
| count | 210 |
| medianFloorSquareMetres | 0.14 |
| totalFloorSquareMetres | 59.75 |

Largest doors: `*252`/`*253` (3.22 m², 0.08 m tall — presumably hatches), `mnhl` (2.02 m², a
manhole), `pdgrgdr` (1.73 m², 5.08 m — the police station's garage door).

### 6c. `classname: func_movelinear`, `limit: 10`

| Field | Value |
|---|---|
| attributed | 3 |
| count | 3 |
| totalFloorSquareMetres | 0.03 |

3 entities: `range1`, `range2`, `range3` (0.01 m² each, 0.71 m tall) — moving shooting-range targets
(`rangetarget.mdl` seen in §5), not functional doors.

⚠️ `prop_door_rotating` (24, §4/§5) and `prop_dynamic` (276, §4/§5) are **not** covered by
`read_brush_volumes` (a tool restricted to *brush* entities, model `*N`). Their geometry is
therefore not measured here.

## 7. `read_sightlines` (parameters: `path`, `limit: 15`, rest default: `spacing: 512`, `eyeHeight: 64`, `elevationTolerance: 512`, `requireNearbyContent: true`)

| Field | Value |
|---|---|
| elevation (auto median) | 5588 |
| spacing | 512 |
| samplePoints | 550 |
| pairsTested | 150,975 |

Exclusions declared by the tool: static props outside the world tree; brush entities (closed doors
read as open); no notion of "street".

The 5 longest lines:

| units | metres | from | to |
|---|---|---|---|
| 15,880 | 403.4 | [−7694, 4372, 5944] | [8178, 4884, 5968] |
| 15,880 | 403.4 | [−7694, 4884, 5944] | [8178, 4372, 5968] |
| 15,872 | 403.1 | [−7694, 4372, 5944] | [8178, 4372, 5968] |
| 15,872 | 403.1 | [−7694, 4884, 5944] | [8178, 4884, 5968] |
| 15,369 | 390.4 | [−7694, 4372, 5944] | [7666, 4884, 5968] |

(full list of 15 in the tool's raw response; the 15th = 13,836 units / 351.4 m)

## 8. `read_pakfile` (parameters: `path`, `limit: 50`)

| Field | Value |
|---|---|
| fileCount | 18,028 |
| totalBytes | 697,053,827 |
| megabytes | 664.8 |

By extension:

| ext | n |
|---|---|
| vhv | 7,426 |
| vmt | 2,998 |
| vtf | 2,847 |
| vtx | 2,342 |
| mdl | 757 |
| vvd | 757 |
| phy | 697 |
| wav | 195 |
| mp3 | 5 |
| txt | 3 |
| raw | 1 |

| Field derived by the tool | Value |
|---|---|
| cubemapTextures | 426 |
| staticPropLighting (.vhv files) | 7,426 |

The 5 largest embedded files: `materials/models/uc/skybox/map_lod.vtf` (8,388,816 B),
`materials/models/uc/skybox/map_lod_lum.vtf` (8,388,816 B), `sound/ucsounds/music/loop7.wav`
(6,092,948 B), `materials/skybox/southside_hdrup.vtf` (5,592,636 B),
`sound/ucsounds/ambience/subway_station.wav` (5,086,908 B).

## Tools not called / declared gaps

- `read_fgd_class`, `read_vmf`, `read_vmf_lint`, `read_leak`, `read_nav`, `read_compile_log`,
  `read_lump_patch*`, `edit_vmf`, `run_compile`, `run_pack`, `read_source_games`: not relevant to a
  measurement reading on an already-compiled `.bsp` with no `.vmf` source available — not called.
- No call failed.
- The exact `prop_static` count (static props, outside ENTITIES) is returned by none of the tools
  available here: a declared gap, no invented figure.
