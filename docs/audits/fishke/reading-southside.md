# Raw reading — rp_southside.bsp (Fishke, 2020)

File: `rp_southside.bsp`, extracted from the Workshop into a scratch directory (path local to the
machine that took the reading, not reproduced here) — 1,032,140,406 bytes (984.4 MiB / 1.03 GB).
Every figure below comes from a tool call actually executed on that file. No estimates.

## 1. `read_bsp_info` (header, no optional parameter)

| Field | Value |
|---|---|
| ident | VBSP |
| version | 20 |
| mapRevision | 16260 |
| fileSize | 1,032,140,406 bytes |
| lumpCount (non-empty) | 52 |

Five largest lumps by bytes: PAKFILE 843.63 MB, LIGHTING 47.72 MB, lump 53 (LIGHTING_HDR duplicate,
unnamed) 47.72 MB, VISIBILITY 11.66 MB, lump 33 (unnamed) 3.94 MB.

## 2. `read_map_extents` (no optional parameter)

| Field | Value |
|---|---|
| modelCount | 1008 |
| mins | [−15360, −15360, −9216] |
| maxs | [15360, 15104, 2080] |
| sizeUnits | [30720, 30464, 11296] |
| sizeMetres | [780.3, 773.8, 286.9] |
| spanUnits (largest horizontal) | 30720 |
| spanMetres | 780.3 |
| areaSquareMetres | 603,776 |
| metresPerUnit | 0.0254 |

⚠️ Bounding box of the entire world model (lump 14, model 0): includes the 3D skybox and all
vertical volume (−9216 to +2080 units, i.e. 286.9 m of height), not only the playable ground extent.

## 3. `read_map_geometry` (no optional parameter — all lumps with a `count`)

| Lump | Bytes | MB | Count | Limit | % of ceiling |
|---|---|---|---|---|---|
| ENTITIES | 2,081,581 | 1.99 | — | MAX_MAP_ENTITIES=8192 | — (this is not an entity count, see §4) |
| PLANES | 421,360 | 0.40 | 21,068 | 65,536 | 32.1% |
| TEXDATA | 53,760 | 0.05 | 1,680 | 2,048 | 82.0% |
| VERTEXES | 755,208 | 0.72 | 62,934 | 65,536 | 96.0% |
| VISIBILITY | 12,224,997 | 11.66 | — | — | — |
| NODES | 848,192 | 0.81 | 26,506 | 65,536 | 40.4% |
| TEXINFO | 822,960 | 0.78 | 11,430 | 12,288 | 93.0% |
| FACES | 1,926,680 | 1.84 | 34,405 | 65,536 | 52.5% |
| LIGHTING | 50,034,400 | 47.72 | — | — | — |
| OCCLUSION | 8,860 | 0.01 | — | — | — |
| LEAFS | 880,480 | 0.84 | — | 65,536 | — |
| FACEIDS | 68,810 | 0.07 | — | — | — |
| EDGES | 626,836 | 0.60 | 156,709 | 256,000 | 61.2% |
| SURFEDGES | 966,804 | 0.92 | 241,701 | 512,000 | 47.2% |
| MODELS | 48,384 | 0.05 | 1,008 | 1,024 | 98.4% |
| WORLDLIGHTS | 154,968 | 0.15 | 1,761 | 8,192 | 21.5% |
| LEAFFACES | 72,208 | 0.07 | 36,104 | 65,536 | 55.1% |
| LEAFBRUSHES | 130,808 | 0.12 | 65,404 | 65,536 | **99.8%** |
| BRUSHES | 89,820 | 0.09 | 7,485 | 8,192 | 91.4% |
| BRUSHSIDES | 382,808 | 0.37 | 47,851 | 65,536 | 73.0% |
| AREAS | 776 | 0.00 | 97 | 256 | 37.9% |
| AREAPORTALS | 4,404 | 0.00 | 367 | 1,024 | 35.8% |
| DISP_VERTS | 1,289,024 | 1.23 | note: size not a multiple of 20 bytes, different layout in this BSP version | — | — |
| GAME_LUMP | 403,660 | 0.38 | — | — | — |
| PAKFILE | 884,608,146 | 843.63 | — | — | — |
| CUBEMAPS | 3,824 | 0.00 | 239 | 1,024 | 23.3% |
| TEXDATA_STRING_DATA | 81,658 | 0.08 | — | 256,000 | — |
| TEXDATA_STRING_TABLE | 6,720 | 0.01 | 1,680 | 65,536 | 2.6% |
| OVERLAYS | 126,720 | 0.12 | 360 | 512 | 70.3% |
| LIGHTING_HDR | 50,034,400 | 47.72 | — | — | — |
| FACES_HDR | 1,926,680 | 1.84 | 34,405 | — | — |

`nearLimitCount` returned by the tool (lumps ≥ 80%): **6** → TEXDATA (82.0%), VERTEXES (96.0%),
TEXINFO (93.0%), MODELS (98.4%), LEAFBRUSHES (99.8%), BRUSHES (91.4%).

## 4. `read_bsp_entities` — full histogram (`histogramOnly: true`)

Total entities in lump 0: **5,122** (`total` = `matched` = 5122, all classes together).

| Class | Count | Class | Count |
|---|---|---|---|
| light_spot | 1421 | logic_case | 3 |
| env_sprite | 470 | point_teleport | 3 |
| func_door_rotating | 403 | trigger_once | 3 |
| prop_dynamic | 383 | env_fog_controller | 2 |
| light | 338 | env_shake | 2 |
| env_soundscape_proxy | 314 | func_monitor | 2 |
| func_button | 224 | func_movelinear | 2 |
| func_door | 149 | func_reflective_glass | 2 |
| info_ladder_dismount | 130 | point_camera | 2 |
| func_useableladder | 105 | point_spotlight | 2 |
| func_areaportal | 103 | color_correction | 1 |
| prop_physics_multiplayer | 98 | env_bubbles | 1 |
| info_player_start | 90 | env_fade | 1 |
| info_target | 90 | env_spark | 1 |
| func_areaportalwindow | 80 | env_tonemap_controller | 1 |
| info_particle_system | 79 | env_wind | 1 |
| ambient_generic | 67 | func_fish_pool | 1 |
| func_brush | 55 | func_rotating | 1 |
| func_occluder | 53 | func_wall_toggle | 1 |
| keyframe_rope | 51 | game_text | 1 |
| env_soundscape_triggerable | 38 | light_environment | 1 |
| logic_relay | 38 | logic_auto | 1 |
| trigger_soundscape | 35 | shadow_control | 1 |
| func_breakable_surf | 29 | sky_camera | 1 |
| info_ladder | 25 | trigger_waterydeath | 1 |
| func_breakable | 23 | water_lod_control | 1 |
| math_counter | 22 | worldspawn | 1 |
| point_template | 21 | | |
| func_rot_button | 18 | | |
| path_track | 18 | | |
| trigger_multiple | 18 | | |
| momentary_rot_button | 13 | | |
| trigger_push | 12 | | |
| infodecal | 10 | | |
| func_tracktrain | 8 | | |
| env_beverage | 7 | | |
| light_dynamic | 7 | | |
| logic_measure_movement | 7 | | |
| move_rope | 7 | | |
| env_fire | 6 | | |
| env_sprite_oriented | 5 | | |
| logic_timer | 5 | | |
| trigger_hurt | 4 | | |
| func_smokevolume | 3 | | |

No occurrence of `prop_door_rotating` (a class requested in the brief but absent from this map).

`info_player_start`: 90 occurrences, a sample of 3 read in detail (`limit:3`) — origins clustered
around (656–704, 496–544, −102), spawns on a tight grid.

## 5. `read_prop_survey` (`limit: 200`)

| Field | Value |
|---|---|
| totalEntities (lump 0) | 5,122 |
| propTotal (prop_dynamic + prop_physics_multiplayer) | 481 |
| byClass.prop_dynamic | 383 |
| byClass.prop_physics_multiplayer | 98 |
| staticCandidates.total (prop_dynamic with no name/parent/anim/output) | 261 |
| staticCandidates.returned (with `limit:200`) | 200 |

Most frequent prop_dynamic/physics models (top 10 of 50 returned):

| Model | Count |
|---|---|
| alley_trashcan.mdl | 44 |
| lightswitch.mdl | 38 |
| ceiling_fan_short.mdl | 20 |
| streetlight_traffic_rev.mdl | 18 |
| pd_deskscreen.mdl | 14 |
| officedesk_small.mdl | 12 |
| leathercouch_a.mdl | 12 |
| prop_market_shelf_large.mdl | 12 |
| hospital_bed.mdl | 12 |
| pd_deskclutter.mdl | 10 |

⚠️ **prop_static is not measured here.** `read_prop_survey` and `read_bsp_entities` both read lump 0
(ENTITIES); `prop_static` lives in the GAME_LUMP (lump 35, static prop dictionary), outside the
scope of both tools. No tool in the provided set exposes a direct prop_static count — not
determinable with this tooling.

## 6. `read_brush_volumes`

### 6a. All classes (`limit: 1`, `attributed: 1007` of 1007 brush models)

| Class | Count | Median area (m²) | Total area (m²) |
|---|---|---|---|
| func_door_rotating | 403 | 0.14 | 216.76 |
| func_button | 224 | 0.01 | 40.75 |
| func_door | 149 | 0.07 | 154.96 |
| func_brush | 55 | 0.58 | 3414.18 |
| trigger_soundscape | 35 | 1598.76 | 260,543.93 |
| func_breakable_surf | 29 | 0.50 | 144.40 |
| func_breakable | 23 | 1.37 | 137.38 |
| func_rot_button | 18 | 0.02 | 0.56 |
| trigger_multiple | 18 | 32.37 | 2547.16 |
| momentary_rot_button | 13 | 0.01 | 1.58 |
| trigger_push | 12 | 97.12 | 4761.12 |
| func_tracktrain | 8 | 16.47 | 115.94 |
| trigger_hurt | 4 | 112.29 | 533.90 |
| func_smokevolume | 3 | 49.55 | 213.56 |
| trigger_once | 3 | 40.31 | 13,360.17 |
| func_monitor | 2 | 0.23 | 0.46 |
| func_reflective_glass | 2 | 0.27 | 0.54 |
| func_movelinear | 2 | 0.03 | 0.06 |
| env_bubbles | 1 | 14.65 | 14.65 |
| trigger_waterydeath | 1 | 23.78 | 23.78 |
| func_wall_toggle | 1 | 9.91 | 9.91 |
| func_rotating | 1 | 0.17 | 0.17 |

Largest brush entity overall: `*859` (trigger_soundscape), 78,320.98 m², 57.71 m tall — a very
stretched bounding volume (it is only a bbox, not a real volume, per the tool's description).

### 6b. `classname: func_door` (`limit: 5`)

Count 149, median area 0.07 m², total 154.96 m². Largest: `*537` (BankSecBar), 70.27 m², 3.35 m
tall.

### 6c. `classname: func_door_rotating` (`limit: 5`)

Count 403, median area 0.14 m², total 216.76 m². Largest: `*4`/`*5`/`*186`/`*187`, 17.34 m² each,
1.12 m tall.

### 6d. `classname: func_movelinear` (`limit: 5`)

Count 2, median area 0.03 m², total 0.06 m². `GTarget1`/`GTarget2`, 2.18 m tall each.

Note: `prop_door_rotating` and `prop_dynamic` are not brush entities — they do not appear in
`read_brush_volumes` (no `*N` model).

## 7. `read_sightlines` (`limit: 15`, other parameters default: `spacing:512`, `eyeHeight:64`, `elevationTolerance:512`, `requireNearbyContent:true`)

| Field | Value |
|---|---|
| elevation (auto median) | 192 |
| spacing | 512 |
| samplePoints | 1008 |
| pairsTested | 507,528 |

Exclusions declared by the tool: static props outside the world collision tree, brush entities
(doors) treated as open, no notion of "street".

15 longest sightlines:

| Rank | Units | Metres | From | To |
|---|---|---|---|---|
| 1 | 28,068 | 712.9 | [−14592,−5376,358] | [12544,−12544,70] |
| 2 | 27,942 | 709.7 | [−14592,−5888,333] | [12544,−12544,70] |
| 3 | 27,824 | 706.7 | [−14592,−6400,320] | [12544,−12544,70] |
| 4 | 27,715 | 704.0 | [−14592,−6912,320] | [12544,−12544,70] |
| 5 | 27,712 | 703.9 | [−14592,−11520,320] | [9984,1280,704] |
| 6 | 27,616 | 701.4 | [−14592,−7424,320] | [12544,−12544,70] |
| 7 | 27,574 | 700.4 | [−14080,−5376,358] | [12544,−12544,70] |
| 8 | 27,526 | 699.2 | [−14592,−7936,320] | [12544,−12544,70] |
| 9 | 27,479 | 698.0 | [−14592,−11520,320] | [9984,768,704] |
| 10 | 27,445 | 697.1 | [−14080,−5888,333] | [12544,−12544,70] |
| 11 | 27,445 | 697.1 | [−14592,−8448,320] | [12544,−12544,70] |
| 12 | 27,373 | 695.3 | [−14592,−8960,320] | [12544,−12544,70] |
| 13 | 27,325 | 694.1 | [−14080,−6400,320] | [12544,−12544,70] |
| 14 | 27,259 | 692.4 | [−14080,−11520,320] | [9984,1280,704] |
| 15 | 27,214 | 691.2 | [−14080,−6912,320] | [12544,−12544,70] |

## 8. `read_pakfile` (`limit: 100`)

| Field | Value |
|---|---|
| fileCount | 17,942 |
| totalBytes | 882,003,068 (841.1 MB) |

By extension:

| Extension | Count |
|---|---|
| vhv | 7656 |
| vmt | 2721 |
| vtx | 2625 |
| vtf | 2144 |
| mdl | 850 |
| vvd | 850 |
| phy | 783 |
| wav | 309 |
| txt | 3 |
| raw | 1 |

`cubemapTextures` (`c-*.vtf` files): **322**. `staticPropLighting` (`.vhv` files): **7656**.

Ten largest embedded files (of the 100 requested): all the `sound/unioncity2/music/clubtrack*.wav`
(7.8 to 10.3 MB each), then `materials/skybox/southside_hdrup.vtf` (5.59 MB) and
`materials/unioncity2/floors/alleyway_n.vtf` (5.59 MB).
