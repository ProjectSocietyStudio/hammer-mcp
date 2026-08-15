# `rp_eastcoast_v4c` — the reading

Raw measurements, one section per call, 15/08/2026. **This file is authoritative on the
numbers.** Anything derived from them lives in `analysis-eastcoast.md`, so a wrong inference
there can be corrected without touching what was measured.

Same discipline as [`../fishke/`](../fishke/): what was read, and nothing that was concluded.

## Provenance

Workshop item [1407179012](https://steamcommunity.com/workshop/filedetails/?id=1407179012),
published **13/06/2018**. Not present as a `.bsp` anywhere on this machine: it ships as a
Workshop addon and Garry's Mod mounts it from there.

```
928186408187074036_legacy.bin   17 122 435 bytes
```

⚠️ **That file is a raw LZMA stream, not a `.gma`.** `read_gma` refuses it — *"magic is
`]\0\0\0`, not GMAD. A compressed or encrypted archive is refused here rather than decoded as
if it were plain."* `0x5D` is LZMA's properties byte. Decompressed with Python's `lzma` at
`FORMAT_ALONE`:

```
17 122 435 -> 92 872 351 bytes, magic GMAD
```

`read_gma` then reads it: **42 entries**, `name: "Rp_eastcoast_v4c"`, `author: "Author Name"`,
timestamp 1528915051, `requiredContent: []`.

| Extension | Count |
|---|---|
| bsp | 1 |
| vmt | 10 |
| vtf | 10 |
| vtx | 10 |
| mdl | 4 |
| vvd | 4 |
| phy | 3 |

`maps/rp_eastcoast_v4c.bsp` — 79 017 614 bytes, crc 2488274436, at offset 2514. Extracted by
offset with `run_gma_extract`.

## Header — `read_bsp_info`

```
ident VBSP   version 20   mapRevision 23867   fileSize 79 017 614   lumpCount 48
hdrLighting false
```

**`hdrLighting: false`**, read from lumps 53, 54 and 58. Lumps 51 and 55 — whose names end in
`HDR` — are non-empty (0.04 MB and 0.30 MB), which the tool's own documentation warns is true
of LDR maps too and is not evidence either way.

The five largest lumps:

| Lump | MB |
|---|---|
| 40 PAKFILE | 27.10 |
| 8 LIGHTING | 26.86 |
| 29 (unnamed) | 8.17 |
| 4 VISIBILITY | 1.55 |
| 7 FACES | 1.51 |

`OCCLUSION` is 12 bytes. `AREAS` is 168 bytes, `AREAPORTALS` 1140. `CUBEMAPS` 2592.

## Extents — `read_map_extents`

```
mins  [-7296.005, -4448, -1313.430]
maxs  [ 6464,      4724,  1632    ]
size  [13760.005,  9172,  2945.430]  =  349.5 x 233 x 74.8 m
span  13760 units = 349.5 m
ground area  81 424 m2
modelCount   404
```

## Ceilings — `read_map_report`, profile `source-stock`

`overall: "fail"` — 20 pass, 2 warn, 3 fail, 1 skipped.

| Criterion | Value | Ceiling | Fraction |
|---|---|---|---|
| **edicts** | 3942 | 2048 `MAX_EDICTS` | **1.925** |
| **LIGHTING** | 28 165 556 B | 16 777 216 `MAX_MAP_LIGHTING` | **1.679** |
| **BRUSHES** | **8192** | 8192 `MAX_MAP_BRUSHES` | **1.000** |
| BRUSHSIDES | 58 389 | 65 536 | 0.891 |
| OVERLAYS | 493 | 512 | 0.963 |

`luxel-density` reports `skipped`: *"no profile here carries a calibrated threshold for this …
a made-up threshold would return a confident verdict about nothing."*

Each `fail` carries the same caveat verbatim: *"either the compilers that built this raise it,
or vbsp would have refused. Do not read it as 'this map is broken' without checking which
toolchain produced it."*

⚠️ The LIGHTING message prints `null of 16777216` for its numerator. That is
[#85](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/85), fixed and merged on
15/08/2026 — the MCP server in this session was still serving the build it loaded at startup.
The issue predicted that `MAX_MAP_LIGHTING` on a real map would be the number it lost, and this
is that map.

## Visibility — `read_visleaf_stats`

```
leafCount            11 337
clusterCount          3 653
visibilityBytes   1 626 674
noClusterLeafCount    7 666   (0.676)
degenerateLeafCount     134

leaf volume: median 172 032   mean 42 306 662   max 62 651 893 824
```

## Lighting — `read_lightmap_budget`

```
faceCount          28 205
facesWithLightmap  26 298
totalLuxels     2 761 019
luxelsPerAreaUnit   0.014
```

| Bucket (luxels/face) | Faces | Luxels |
|---|---|---|
| 1–16 | 11 664 | 120 661 |
| 17–64 | 7 361 | 239 821 |
| 65–256 | 4 320 | 567 224 |
| 257–1024 | 2 527 | 1 369 943 |
| 1025–4096 | 426 | 463 370 |
| 4097+ | 0 | 0 |

Costliest face: index 24535, texinfo 293, 2500 luxels, 49 × 49, area 589 824.

## Entities — `read_bsp_entities`

`mapRevision 23867`, lump 1 009 459 bytes, NUL-terminated, **3942 entities**.

| Classname | Count |
|---|---|
| `light_spot` | 1068 |
| `infodecal` | 991 |
| `env_sprite` | 664 |
| `prop_door_rotating` | 197 |
| `trigger_soundscape` | 143 |
| `keyframe_rope` | 109 |
| `prop_dynamic` | 106 |
| `func_breakable_surf` | 94 |
| `light` | 79 |
| `func_door_rotating` | 46 |
| `func_areaportal` | 38 |
| `func_breakable` | 35 |
| `prop_physics_multiplayer` | 35 |
| `info_hint` | 30 |
| `ambient_generic` | 29 |
| `info_player_start` | 26 |

Fifty-six classnames in all. Singletons include `env_fog_controller`, `env_sun`, `sky_camera`,
`shadow_control`, `light_dynamic`, `func_reflective_glass`, `func_tracktrain`.

Six `light_spot` sampled: **every one has `targetname: null`**, `_quadratic_attn 1`,
`_light "247 255 217 50"`, `_cone 75`, `_inner_cone 25`, and `_lightHDR "-1 -1 -1 1"`. Each
carries a `hammerid` — the compiled lump kept them.

## What failed to read

**`read_entity_report` refuses this map**:

```
read_entity_report failed: unterminated quoted string at offset 61907 (line 43)
```

`read_bsp_entities` reads the same lump completely — 3942 entities, full histogram, sampled
keyvalues. Two readers of one lump, one of which cannot parse it. Not investigated further
here; recorded as measured.
