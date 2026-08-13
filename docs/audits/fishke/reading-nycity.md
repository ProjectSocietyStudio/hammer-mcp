# Raw reading — rp_nycity.bsp (Fishke, 2022)

File: `rp_nycity.bsp`, extracted from the Workshop into a scratch directory (path local to the
machine that took the reading, not reproduced here), 1,142,853,009 bytes (1.14 GB).
Tooling: `hammer-mcp` (MCP), read by offset, never a direct read of the .bsp.

## 1. `read_bsp_info`

| Field | Value |
|---|---|
| ident | VBSP |
| version | 20 |
| mapRevision | 10718 |
| fileSize | 1,142,853,009 |
| lumpCount | 49 (non-empty) |

10 largest lumps (bytes):

| Lump | Bytes | MB |
|---|---|---|
| PAKFILE (40) | 1,075,762,805 | 1025.93 |
| LIGHTING (8) | 33,779,412 | 32.21 |
| VISIBILITY (4) | 5,355,353 | 5.11 |
| lump 34 (unnamed) | 4,515,260 | 4.31 |
| LIGHTING_HDR (56) | 3,043,264 | 2.90 |
| lump 33 (unnamed) | 2,983,520 | 2.85 |
| lump 29 (unnamed) | 2,655,023 | 2.53 |
| FACES (7) | 1,886,696 | 1.80 |
| ENTITIES (0) | 1,856,904 | 1.77 |
| lump 27 (unnamed) | 1,235,808 | 1.18 |

> ⚠️ Lump 56 is named "LIGHTING_HDR" above by the tool of the day. That is wrong — it is
> `LEAF_AMBIENT_LIGHTING`, and the error is what produced the belief that this map has an HDR
> compile. Left as recorded; see `longitudinal-synthesis.md` §5.

## 2. `read_map_extents`

| Field | Value |
|---|---|
| modelCount | 1217 |
| mins (units) | [−15424, −15936, −6208] |
| maxs (units) | [16176, 15424, 10496] |
| sizeUnits | [31600, 31360, 16704] |
| sizeMetres | [802.6, 796.5, 424.3] |
| spanUnits (max horizontal) | 31600 |
| spanMetres | 802.6 |
| areaSquareMetres (XY bounding box) | 639,338 |
| metresPerUnit | 0.0254 |

## 3. `read_map_geometry` (lump fill vs the vbsp ceiling)

| Lump | Bytes | MB | Count | Limit | Limit name | Fraction used |
|---|---|---|---|---|---|---|
| ENTITIES | 1,856,904 | 1.77 | — | 8192 | MAX_MAP_ENTITIES | — (no structured count) |
| PLANES | 437,240 | 0.42 | 21,862 | 65,536 | MAX_MAP_PLANES | 0.334 |
| TEXDATA | 45,152 | 0.04 | 1,411 | 2,048 | MAX_MAP_TEXDATA | 0.689 |
| VERTEXES | 745,332 | 0.71 | 62,111 | 65,536 | MAX_MAP_VERTS | 0.948 |
| VISIBILITY | 5,355,353 | 5.11 | — | — | — | — |
| NODES | 719,264 | 0.69 | 22,477 | 65,536 | MAX_MAP_NODES | 0.343 |
| TEXINFO | 847,728 | 0.81 | 11,774 | 12,288 | MAX_MAP_TEXINFO | 0.958 |
| FACES | 1,886,696 | 1.80 | 33,691 | 65,536 | MAX_MAP_FACES | 0.514 |
| LIGHTING | 33,779,412 | 32.21 | — | — | — | — |
| OCCLUSION | 1,852 | 0 | — | — | — | — |
| LEAFS | 758,240 | 0.72 | — | 65,536 | MAX_MAP_LEAFS | — |
| FACEIDS | 67,382 | 0.06 | — | — | — | — |
| EDGES | 617,928 | 0.59 | 154,482 | 256,000 | MAX_MAP_EDGES | 0.603 |
| SURFEDGES | 972,044 | 0.93 | 243,011 | 512,000 | MAX_MAP_SURFEDGES | 0.475 |
| MODELS | 58,416 | 0.06 | 1,217 | 1,024 | MAX_MAP_MODELS | **1.188 (exceeds the stock SDK 2013 ceiling; the compilers used raised it)** |
| WORLDLIGHTS | 184,272 | 0.18 | 2,094 | 8,192 | MAX_MAP_WORLDLIGHTS | 0.256 |
| LEAFFACES | 79,840 | 0.08 | 39,920 | 65,536 | MAX_MAP_LEAFFACES | 0.609 |
| LEAFBRUSHES | 41,792 | 0.04 | 20,896 | 65,536 | MAX_MAP_LEAFBRUSHES | 0.319 |
| BRUSHES | 83,136 | 0.08 | 6,928 | 8,192 | MAX_MAP_BRUSHES | 0.846 |
| BRUSHSIDES | 353,400 | 0.34 | 44,175 | 65,536 | MAX_MAP_BRUSHSIDES | 0.674 |
| AREAS | 88 | 0 | 11 | 256 | MAX_MAP_AREAS | 0.043 |
| AREAPORTALS | 252 | 0 | 21 | 1,024 | MAX_MAP_AREAPORTALS | 0.021 |
| DISP_VERTS | 943,360 | 0.90 | 47,168 | — | — | — |
| GAME_LUMP | 421,484 | 0.40 | — | — | — | — |
| PAKFILE | 1,075,762,805 | 1025.93 | — | — | — | — |
| CUBEMAPS | 2,688 | 0 | 168 | 1,024 | MAX_MAP_CUBEMAPSAMPLES | 0.164 |
| TEXDATA_STRING_DATA | 57,844 | 0.06 | — | 256,000 | MAX_MAP_TEXDATA_STRING_DATA | — |
| TEXDATA_STRING_TABLE | 5,644 | 0.01 | 1,411 | 65,536 | — | 0.022 |
| OVERLAYS | 130,592 | 0.12 | 371 | 512 | MAX_MAP_OVERLAYS | 0.725 |

`nearLimitCount` (≥ 80%) = 4 lumps: MODELS (1.188, exceeded), TEXINFO (0.958), VERTEXES (0.948),
BRUSHES (0.846).

## 4. `read_bsp_entities` (histogramOnly)

Total entities in lump 0: **4287**.

| Classname | Count |
|---|---|
| light_spot | 1889 |
| func_door_rotating | 451 |
| trigger_soundscape | 211 |
| light | 203 |
| func_button | 183 |
| func_door | 171 |
| path_track | 129 |
| prop_physics_multiplayer | 111 |
| env_soundscape_proxy | 107 |
| info_player_start | 100 |
| keyframe_rope | 68 |
| ambient_generic | 66 |
| prop_dynamic | 59 |
| info_target | 53 |
| env_soundscape_triggerable | 45 |
| point_template | 45 |
| func_breakable_surf | 44 |
| logic_relay | 33 |
| func_brush | 26 |
| trigger_push | 23 |
| trigger_teleport | 22 |
| info_ladder | 21 |
| info_landmark | 19 |
| info_teleport_destination | 19 |
| func_occluder | 16 |
| func_rot_button | 16 |
| env_sprite_clientside | 14 |
| light_dynamic | 13 |
| func_areaportal | 10 |
| trigger_multiple | 10 |
| func_tracktrain | 9 |
| momentary_rot_button | 9 |
| func_rotating | 7 |
| func_wall_toggle | 7 |
| trigger_hurt | 7 |
| env_sprite | 6 |
| game_text | 6 |
| logic_timer | 6 |
| env_fire | 5 |
| func_breakable | 5 |
| lua_run | 5 |
| func_movelinear | 4 |
| func_physbox | 4 |
| func_reflective_glass | 4 |
| logic_case | 4 |
| func_smokevolume | 3 |
| math_counter | 3 |
| env_fade | 2 |
| logic_measure_movement | 2 |
| env_fog_controller | 1 |
| env_smokestack | 1 |
| env_wind | 1 |
| infodecal | 1 |
| light_environment | 1 |
| logic_auto | 1 |
| player_speedmod | 1 |
| point_message | 1 |
| shadow_control | 1 |
| sky_camera | 1 |
| water_lod_control | 1 |
| worldspawn | 1 |

Absent from the reading (0 occurrences): `prop_door_rotating`.

No class above was dumped in detail apart from `info_player_start` (100/100, all spawns grouped into
3 coordinate clusters) and `light_environment` (1, the map's only sun, `_ambient` = "61 90 121 50",
pitch −90).

## 5. `read_prop_survey`

| Field | Value |
|---|---|
| totalEntities (lump 0) | 4287 |
| propTotal (props **from the ENTITIES lump** only — excluding prop_static, which lives in the GAME_LUMP) | 170 |
| prop_physics_multiplayer | 111 |
| prop_dynamic | 59 |

Tool note: the `prop_static` count (GAME_LUMP) is **not** returned by this reading — it covers only
lump 0 props.

Top models (by count, full list not truncated for ≥ 1):

| Model | Count |
|---|---|
| models/unioncity3/props_street/streetlight_traffic_rev.mdl | 25 |
| models/unioncity3/props_interior/monitor.mdl | 23 |
| models/unioncity2/props_unioncity/pd_deskclutter.mdl | 12 |
| models/unioncity3/props_misc/hotelflag.mdl | 11 |
| models/unioncity3/props_street/streetlight_traffic_longer.mdl | 11 |
| models/unioncity3/props_misc/bank_atm.mdl | 9 |
| models/postal3/jail_door01.mdl | 5 |
| models/unioncity3/propper/subwaytrain.mdl | 4 |
| models/unioncity3/propper/clublight1.mdl | 3 |
| models/unioncity3/propper/clublight3.mdl | 3 |
| models/unioncity3/propper/clublight2.mdl | 3 |
| models/props_downtown/pooltable.mdl | 3 |
| models/uc/props_fastfood/freezerdoor.mdl | 3 |
| models/uc/props_unioncity/bathroom_stalldoor.mdl | 3 |
| (37 further models at count 1–2, see the tool's raw output) | 1–2 |

Static-conversion candidates (`staticCandidates`): **17** of 59 `prop_dynamic` (each with no name, no
parent, no animation, no output — 100% of the candidates returned). `prop_physics_multiplayer` is
never a candidate (physics required).

| Candidate model | Occurrences among the 17 |
|---|---|
| models/unioncity3/props_misc/hotelflag.mdl | 9 |
| models/unioncity2/props_unioncity/world_clocks.mdl | 2 |
| models/unioncity3/propper/cdmibrecorders.mdl | 1 |
| models/props_wasteland/powertower01.mdl | 1 |
| models/dynamic_props/ceiling_fan_short.mdl | 1 |
| models/unioncity2/props_club/turntable.mdl | 1 |

The tool's warning, reproduced as-is: "Candidates only. Conversion needs a recompile, the model must
support static props, and Lua that finds a prop by anything other than targetname would still lose
it."

## 6. `read_brush_volumes` (no `classname` filter, limit 1000)

| Field | Value |
|---|---|
| brushModels | 1216 |
| attributed | 1216 |

By class (`medianFloorSquareMetres`, `totalFloorSquareMetres` — the ground area of each brush
model's **bounding box**, not a real polygon):

| Classname | Count | Median m² | Total m² |
|---|---|---|---|
| func_door_rotating | 451 | 0.14 | 88.65 |
| trigger_soundscape | 211 | 208.10 | 233,346.46 |
| func_button | 183 | 0.01 | 29.49 |
| func_door | 171 | 0.14 | 112.93 |
| func_breakable_surf | 44 | 0.52 | 295.77 |
| func_brush | 26 | 64.04 | 20,810.11 |
| trigger_push | 23 | 5.70 | 562,833.05 |
| trigger_teleport | 22 | 14.53 | 773.76 |
| func_rot_button | 16 | 0.02 | 0.32 |
| trigger_multiple | 10 | 15.86 | 250.40 |
| momentary_rot_button | 9 | 0.01 | 0.26 |
| func_tracktrain | 9 | 21.80 | 271.70 |
| trigger_hurt | 7 | 1.65 | 45.41 |
| func_wall_toggle | 7 | 0.41 | 143.49 |
| func_rotating | 7 | 0.04 | 5.10 |
| func_breakable | 5 | 0.50 | 253.22 |
| func_reflective_glass | 4 | 0.13 | 0.55 |
| func_physbox | 4 | 0.01 | 0.04 |
| func_movelinear | 4 | 2706.00 | 5412.63 |
| func_smokevolume | 3 | 151.04 | 470.55 |

`func_areaportal` and `func_occluder` do not appear in `byClass` despite being present in the
histogram (10 and 16 occurrences) — the tool's output attributes them no distinct bounding box at
this limit; a declared gap, not investigated further.

## 7. `read_sightlines`

Parameters: `limit=20`, defaults otherwise (`spacing=512`, `eyeHeight=64`, `elevationTolerance=512`,
`requireNearbyContent=true`).

| Field | Value |
|---|---|
| elevation (auto median) | 232.41 |
| samplePoints | 1480 |
| pairsTested | 1,094,460 |

20 longest sightlines:

| # | Units | Metres | From | To |
|---|---|---|---|---|
| 1 | 30,278 | 769.1 | [−2880,−15680,64] | [6848,12992,328] |
| 2 | 30,118 | 765.0 | [−2880,−15680,64] | [6336,12992,320] |
| 3 | 29,965 | 761.1 | [−2880,−15680,64] | [5824,12992,320] |
| 4 | 29,820 | 757.4 | [−2880,−15680,64] | [5312,12992,328] |
| 5 | 29,794 | 756.8 | [−2880,−15168,64] | [6848,12992,328] |
| 6 | 29,631 | 752.6 | [−2880,−15680,64] | [6336,12480,320] |
| 7 | 29,631 | 752.6 | [−2880,−15168,64] | [6336,12992,320] |
| 8 | 29,476 | 748.7 | [−2880,−15680,64] | [5824,12480,320] |
| 9 | 29,476 | 748.7 | [−2880,−15168,64] | [5824,12992,320] |
| 10 | 29,381 | 746.3 | [−2880,12992,72] | [8384,−14144,128] |
| 11 | 29,329 | 744.9 | [−2880,−15680,64] | [5312,12480,328] |
| 12 | 29,329 | 744.9 | [−2880,−15168,64] | [5312,12992,328] |
| 13 | 29,189 | 741.4 | [−2880,12992,72] | [7872,−14144,128] |
| 14 | 29,189 | 741.4 | [−2368,12992,72] | [8384,−14144,128] |
| 15 | 29,145 | 740.3 | [−2880,−15680,64] | [6336,11968,320] |
| 16 | 29,145 | 740.3 | [−2880,−15168,64] | [6336,12480,320] |
| 17 | 29,004 | 736.7 | [−2368,12992,72] | [7872,−14144,128] |
| 18 | 28,987 | 736.3 | [−2880,−15168,64] | [5824,12480,320] |
| 19 | 28,909 | 734.3 | [−2880,12480,72] | [8384,−14144,128] |
| 20 | 28,909 | 734.3 | [−2880,12992,72] | [8384,−13632,128] |

The `excludes` field returned by the tool (verbatim):
- "static props: 'prop_static' geometry is not in the world tree"
- "brush entities: a func_door or func_brush is not in the world tree, so a closed door reads as
  open"
- "displacements are in the tree, but no notion of 'street' exists in a .bsp — an open line may
  cross terrain rather than a road"

## 8. `read_pakfile`

The full output (98,028 characters) exceeded the transport budget — extracted with `jq` from the
sidecar file the tool saves automatically.

| Field | Value |
|---|---|
| fileCount | 15,135 |
| totalBytes | 1,073,436,397 |
| megabytes | 1023.7 |
| cubemapTextures | 285 |
| staticPropLighting (.vhv) | 3991 |
| returned (requested limit) | 1000 |

By extension:

| Extension | Count |
|---|---|
| vhv | 3991 |
| vtx | 2821 |
| vmt | 2782 |
| vtf | 2542 |
| mdl | 939 |
| vvd | 939 |
| phy | 866 |
| wav | 188 |
| mp3 | 63 |
| txt | 2 |
| vbsp | 1 |
| ain | 1 |

30 largest embedded files (extract from `largest`):

| File | Bytes |
|---|---|
| sound/unioncity3/music/clubtrack12.wav | 11,347,410 |
| sound/unioncity3/music/clubtrack5.wav | 11,141,752 |
| sound/unioncity3/music/clubtrack2.wav | 10,762,236 |
| sound/unioncity3/music/clubtrack4.wav | 10,735,806 |
| sound/unioncity3/music/clubtrack3.wav | 10,648,854 |
| sound/unioncity3/music/clubtrack8.wav | 10,566,706 |
| sound/unioncity3/music/clubtrack10.wav | 10,279,682 |
| sound/unioncity3/music/clubtrack9.wav | 9,986,670 |
| sound/unioncity3/music/clubtrack11.wav | 9,975,222 |
| sound/unioncity3/music/clubtrack6.wav | 9,963,348 |
| sound/unioncity3/music/clubtrack7.wav | 9,711,470 |
| sound/unioncity3/music/interiors/centralmall.wav | 9,526,588 |
| sound/unioncity3/music/clubtrack1.wav | 9,513,868 |
| sound/unioncity3/music/interiors/centralmotors.wav | 8,897,180 |
| sound/unioncity3/music/discodance.wav | 8,156,944 |
| materials/unioncity3/floors/alleyway_n.vtf | 5,592,576 |
| sound/unioncity3/music/interiors/techzone.wav | 5,396,032 |
| sound/unioncity3/music/interiors/mtower.wav | 5,207,760 |
| sound/unioncity3/music/interiors/trattoria.wav | 4,692,976 |
| sound/unioncity3/ambience/river.wav | 4,371,980 |
| sound/unioncity3/music/interiors/hotel.wav | 3,950,060 |
| sound/unioncity3/ambience/centraldistrict.wav | 3,914,864 |
| sound/unioncity3/music/interiors/zdojo.wav | 3,859,740 |
| sound/unioncity3/music/interiors/reddevil.wav | 3,696,908 |
| sound/unioncity3/ambience/unioncity.wav | 3,655,352 |
| sound/unioncity3/music/interiors/goldendragon.wav | 3,598,522 |
| sound/unioncity3/music/radio/hiphop1.wav | 3,573,512 |
| sound/unioncity3/ambience/subwaystation.wav | 3,551,888 |
| sound/unioncity3/music/radio/hiphop5.wav | 3,523,264 |
| sound/unioncity3/music/interiors/coffeeshop.wav | 3,174,068 |

`returned:1000` with `limit:1000` requested — only the first 30 lines of the `largest` list were
extracted into this reading; the full sidecar file holds all 1000.

## 9. Declared gaps and failures

- `read_pakfile` and `read_brush_volumes` (unfiltered) each exceeded the agent-side MCP transport
  token budget; worked around by reading the sidecar file the tool saves automatically, filtered
  with `jq`. Nothing invented: every figure above comes from that file.
- `read_brush_volumes` does not return `func_areaportal` (10) or `func_occluder` (16) in `byClass`
  at `limit:1000` — cause not investigated.
- `read_prop_survey` does not cover `prop_static` (GAME_LUMP): the map's total static prop count was
  **not** measured by this tool and is therefore not in this reading.
- Per-class entity detail was not requested for `func_door`, `func_door_rotating`,
  `func_movelinear`, `light`, `light_spot` beyond the histogram (instruction: do not dump
  everything) — only aggregate counts and, for `func_movelinear`/`func_door`/`func_door_rotating`,
  aggregate ground areas via `read_brush_volumes`, are available.
