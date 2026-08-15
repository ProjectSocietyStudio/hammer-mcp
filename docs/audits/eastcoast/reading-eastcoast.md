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
keyvalues. Not investigated further here; recorded as measured.

⚠️ **Settled by the second pass, and the reading above is wrong about what it saw.** There are
not two readers of one lump. `read_entity_report` takes *a `.vmf`* — it was handed a 79 MB
`.bsp`, read it whole as text, and lexed binary. See "The two refusals" below.

---

# Second pass — 15/08/2026

Same file, same discipline: what was read, and nothing concluded. The first pass ran seven
readers; this one runs the ones it never called, and settles by census what it settled by
sample.

## Packed content — `read_pakfile`, then the ZIP directly

```
fileCount 1515   totalBytes 28 095 800   26.8 MB
vmt 1158   vtf 336   vtx 10   mdl 4   vvd 4   phy 3
```

1148 of the 1158 `.vmt` are under `materials/maps/rp_eastcoast_v4c/` — the per-cubemap material
patches vbsp generates. **Ten `.vmt` in the whole map are authored.**

Read from the PAKFILE lump as a ZIP, sizes verbatim from the archive directory:

| | Files | Bytes | Share of the pakfile |
|---|---|---|---|
| Cubemap textures, both sets | 326 | 14 200 000 | **51%** |
| — of which HDR (`*.hdr.vtf`) | 163 | 12 474 064 | **44%** |
| — of which LDR | 163 | ~1 700 000 | 6% |
| `mall_trees_branches01.vtf` | 1 | 5 592 672 | 20% |
| `decals/basketmarking.vtf` | 1 | 5 592 640 | 20% |

Both of those two are **2048 × 2048**, read from the VTF header. One of them is a decal.
An HDR cubemap face here is 76 528 B against 9 832 B for its LDR twin — **7.8×**.

162 entries in the CUBEMAPS lump (2592 B ÷ 16); 163 textures per set, the extra being
`cubemapdefault`. Both sets are complete: `buildcubemaps` was run, and nothing is missing.

**`LIGHTING_HDR` (lump 53) is 0 bytes.** That is the direct reading of `hdrLighting: false`,
from the lump rather than from an inference.

The addon ships **no `.nav`** — the 42 `.gma` entries are `bsp`, `vmt`, `vtf`, `vtx`, `mdl`,
`vvd`, `phy` and nothing else.

## Props — `read_prop_survey`

```
propTotal 338
prop_door_rotating 197   prop_dynamic 106   prop_physics_multiplayer 35
staticCandidates 55
```

193 of the 197 doors are one model, `models/props_c17/door01_left.mdl`. Then
`tree_city01.mdl` ×17, `de_train_doorhandle_01.mdl` ×14, `trashbin01a.mdl` ×13.

## The brush lump is internally consistent — read directly

The first pass recorded `BRUSHES 8192 of 8192` and could not explain landing on the SDK value
exactly. This tests whether the lump is *torn* — whether a compiler stopped mid-write:

```
BRUSHES     8192 (98 304 B = 8192 x 12 exactly)
BRUSHSIDES 58 389 (467 112 B)
sum of numsides                 = 58 389
max(firstside + numsides)       = 58 389
orphaned brushsides             = 0
```

**Zero orphans**, and the reference chain ends exactly at the last brushside. Recorded as
measured; what it does and does not settle is in the analysis.

Other lumps, for the record: `MODELS` 404, `FACES` 28 205, `TEXINFO` 8719, `VERTEXES` 46 841,
`PLANES` 21 102.

## Entity census — the whole population, not a sample

The first pass sampled six `light_spot`. This reads all 3942 entities out of the lump and
counts. Method: the ENTITIES lump parsed as `"key" "value"` lines between braces — the same
bytes `read_bsp_entities` reads, counted here because no tool in this repository reports a
census of a compiled map's wiring — which [`analysis-eastcoast.md`](analysis-eastcoast.md)
treats as the finding it is.

| | Count |
|---|---|
| Entities | 3942 |
| Classnames | **57** (the first pass said 56; `worldspawn` is the 57th) |
| Carrying a `targetname` | **510** |

**Lights:**

| Class | Count | Named | Styles |
|---|---|---|---|
| `light_spot` | 1068 | **36** | 1018 at style 0; 50 at styles 1, 6, 32–36 |
| `light` | 79 | 0 | all style 0 |
| `light_environment` | 2 | 0 | style 0 |
| `light_dynamic` | 1 | 0 | — |

**1113 of the 1149 baked-light entities are unnamed.** 50 carry a non-zero lightstyle.

The two sets intersect exactly: of the 1068 `light_spot`, **36 are named and all 36 are styled**
(12 at style 32, 12 at 33, 10 at 34, one each at 35 and 36); **14 are styled and unnamed**
(11 at style 1, 3 at style 6); **no named light is unstyled**.

**Sprites:** 664 `env_sprite`, **24 named**, 640 not. Models: `glow06.spr` ×363, `glow.spr`
×245, `glow04.spr` ×41, `light_glow02.spr` ×9, `ledglow.spr` ×2, `glow01.vmt` ×4.

**Named things, top of the list:** `keyframe_rope` 109, `func_breakable_surf` 92,
`prop_door_rotating` 43, `light_spot` 36, `func_door_rotating` 34, `func_breakable` 30,
`env_sprite` 24, `prop_dynamic` 19, `point_template` 18, `logic_timer` 16, `info_target` 14.

## Wiring — 402 outputs, read out of the lump

| | Count |
|---|---|
| Outputs (`On*` keys with a target) | 402 |
| Aimed at a `targetname` that does not exist | **7**, across 4 distinct names |

The four dead targets, verbatim: `tonemap` ×3, `store_4_windows_timer` ×2,
`building_brick_2_elevator door_elevator` ×1, `bar_props` ×1.

**The window-respawn system.** Seventeen `logic_timer`, seventeen `point_template`, one per
shopfront or façade. Each timer is `StartDisabled 1`, `RefireTime 120`, enabled by the
`OnBreak` of its own `func_breakable` group, and fires three outputs — `Kill` the group,
`ForceSpawn` the template at +0.2 s, `Disable` itself. Sixteen of the seventeen are wired to
their own group. Read verbatim:

```
bar_2_windows      OnBreak   bar_2_windows_timer,Enable,,0,-1

bar_2_windows_timer  OnTimer  res_4_windows_timer,Disable,,0,-1
bar_2_windows_timer  OnTimer  res_4_windows,Kill,,0,-1
bar_2_windows_timer  OnTimer  res_4_windows_template,ForceSpawn,,0.2,-1

res_4_windows_timer  OnTimer  res_4_windows_timer,Disable,,0,-1
res_4_windows_timer  OnTimer  res_4_windows,Kill,,0,-1
res_4_windows_timer  OnTimer  res_4_windows_template,ForceSpawn,,0.2,-1
```

```
store_4_windows    OnBreak   store_4_windows_timer,Enable,,0,-1     x2
```
`store_4_windows_timer` is not among the 17, and no `store_4_windows_template` is among the 18.

**`bar_template`, in full:**
```
"origin" "-3081.38 503.862 -215"   "targetname" "bar_template"
"spawnflags" "0"   "classname" "point_template"   "hammerid" "6426908"
```
No `Template01`. `bar_button_logic` fires `bar_template,ForceSpawn` on `OnTrue` and
`bar_props,Kill` on `OnFalse`; `bar_props` is one of the four dead names.

**`logic_auto`, in full:**
```
OnMapSpawn  tonemap,SetBloomScale,0.1,0,-1
OnMapSpawn  tonemap,SetAutoExposureMin,0.25,0,-1
OnMapSpawn  tonemap,SetAutoExposureMax,2.5,0,-1
OnMapSpawn  train_1,StartForward,,50,1
OnMapSpawn  train_1,Stop,,0,1
OnMapSpawn  building_brick_2_elevator door_elevator,SetAnimation,open,0,-1
```
No `env_tonemap_controller` exists in the 57 classnames.

Elsewhere in the wiring, working as authored: two lift controllers built from `logic_relay`
pairs, a club spotlight on a 3-second `logic_timer` driving a `logic_branch`, three light
switches, and a gun-shop airlock (`gunstore_boothdoor_branch`).

## The two refusals

**`read_map_organisation` fails identically to `read_entity_report`**:

```
read_map_organisation failed: unterminated quoted string at offset 61907 (line 43)
```

Same offset, same line, on the same file. Both are **`.vmf` tools**
(`src/tools/wiring.ts:24`, `src/tools/organise.ts:76`); so is `validate_io`
(`src/tools/wiring.ts:86`). The entity lump itself is clean: split on `\n`, **52 327 lines,
zero lines whose quote count is not 4**, and no value contains a newline. Offset 61907 falls
at line ~3250 of that lump, not line 43 — the lexer was reading the `.bsp` as text.

**`read_leak`** returns `leaked: false`, on this reasoning:

> *"No pointfile beside this map, and […] rp_eastcoast_v4c.bsp is there. vbsp writes a `.lin`
> when it leaks and does not otherwise, so the compile that produced that `.bsp` did not leak."*

This `.bsp` was extracted from a `.gma` that contains no `.lin` and could not have.
