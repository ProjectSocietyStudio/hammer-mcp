# Lighting a Source map

## The general model

**All static lighting is radiosity baked by VRAD, once, into the `.bsp`.** Nothing is recomputed at
runtime. Three distinct pipelines stack up:

- **brush faces and displacements** get a real lightmap (a grid of luxels);
- **`prop_static`** get, by default, a single sample per model vertex rather than a lightmap — hence
  props that seem to float, lit differently from the floor they touch (already in
  `source-map/references/lighting.md`, which gives the `.vhv` check);
- everything else (players, `prop_physics`, `prop_dynamic`, particles) is lit in game by the
  **ambient cube**: six averaged light samples, one per cube face, interpolated from the nearest
  lightmap. A `prop_dynamic` is therefore never as well lit as a neighbouring brush — that is not a
  bug, it is the absence of a third pipeline.

VRAD computes no geometric penumbra: a sharp shadow edge comes from luxel density, not from a light
source radius. `[engine]` (VDC, Lightmap article)

## Lightmaps and luxels

The default scale is **16 units per luxel**, and the memory cost grows **with the square** as you
lower it (halve the scale = four times the luxels on the same face) — detail and verification are in
`source-map/references/lighting.md`. What is missing there: **how to choose**, face by face.

| Surface | Scale | Why |
|---|---|---|
| Flat wall, ceiling, large slab with no cast shadow | 32 or 64 | Nothing to gain visually; the cost is paid for nothing `[consensus]` |
| Default, most of the map | 16 | The engine's original compromise `[engine]` |
| A wanted shadow edge (grate, railing, projected text) | 8 or 4, **on that face only** | Lowering globally rather than locally is the first cause of blowing past `MAX_MAP_LIGHTING` `[consensus]` |
| Close-to-camera detail, hard shadow required | 2 | The lowest value in common use; below it, no gain and 64× the cost of 16 `[consensus]` |
| Displacement | Do not lower without measuring | A displacement is **not subdivided** like a brush face — the number one cause of a vrad run going from minutes to hours |

⚠️ A brush face carries at most **32 luxels per axis** — `MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER`,
`[engine]`. Do not reach for `MAX_LIGHTMAP_DIM_WITHOUT_BORDER`: despite the obvious name and a
comment calling it "the actual max", it aliases the **displacement** value of 125, four times the
real limit for a brush face. VBSP subdivides past the cap, and an excess of low-scale faces fails
with "Too many unique verts".

**Verifying**: `read_lightmap_budget` gives the total luxels, the distribution and the costliest
faces; `read_map_geometry` compares the `LIGHTING` lump against the hard ceiling
`MAX_MAP_LIGHTING` = 16 MiB (`bspfile.h:90`, `[engine]`) — a byte-denominated limit, so record-count
checks miss it entirely.

**Where the budget actually goes**, measured on one face: scale 8 → 17,424 luxels, 16 → 4,624,
32 → 1,296, 64 → 400. Each doubling divides the bill by roughly four `[measured]`. That is why a
production map can reach **264%** of `MAX_MAP_LIGHTING`: not by picking a fine scale once, but by
never coarsening the surfaces that did not need it.

## Light entities and their falloff

`light` (point), `light_spot` (cone), `light_environment` (sun, one per map — beyond that, silently
ignored), `light_dynamic` (computed in game, never baked, expensive in numbers).

**Two falloff systems, mutually exclusive, and the second wins as soon as it is filled in**:

- **Constant/Linear/Quadratic** (`_constant_attn` etc.) — the historical ratio, inheriting a scale
  factor up to ×10,000 to compensate for physical 1/d² falloff, which saturates fast under
  HDR+bloom. `[engine]` (VDC, Constant-Linear-Quadratic Falloff)
- **`_fifty_percent_distance` / `_zero_percent_distance`** — VRAD solves an inverse quadratic from
  those two distances as soon as the first is non-zero. If `d0 < d50`, VRAD warns and forces
  `d0 = 2×d50`: the falloff actually placed in game then diverges silently from what was entered.
  `[engine]` (`lightmap.cpp`, `SetLightFalloffParams`)

⚠️ A `light_spot` whose inner or outer angle exceeds 90° is **clamped to 90° by VRAD**, in game as
in render — the angle Hammer shows beyond 90° is cosmetic and has no real effect. `[engine]`
(`lightmap.cpp` ~1293-1300)

**Verifying**: the compile log contains both warnings verbatim (`_fifty_percent_distance`,
`inner/outer angle larger than 90 degrees`) — `read_compile_log` finds them. The falloff as *felt*
in game (too hard, too soft) is human judgement, not tooled.

## Light styles

Each **face** can carry only **4 simultaneous styles** (`MAXLIGHTMAPS = 4`); beyond that, VRAD
ignores the extras with a simple warning, without failing the compile. The engine knows **64 global
styles** (`MAX_LIGHTSTYLES`). `[engine]` (`bspfile.h:43,679`; `lightmap.cpp`)

⚠️ A map with many named lights (flickering neons stacked on one wall, say) can therefore have
lights that *appear* to work in Hammer and silently disappear in game on the busiest faces.

**Verifying**: `read_compile_log` — look for "Too many light styles on a face at", which gives the
offending face's coordinates.

## HDR

Two independent lightmap sets in the `.bsp` (already detailed file-side in
`source-map/references/lighting.md`). What lighting adds to it:

- A `light`/`light_environment` with no `_lightHDR` falls back to `_light` on the HDR pass — correct
  behaviour. But a `_lightHDR` filled in by mistake (a copy-paste) makes the HDR pass diverge from
  the LDR one silently, **with no error at all**. `[engine]` (`lightmap.cpp`, `ParseLightGeneric`)
- `-both` is not a combined mode: VRAD runs **twice in full**, an `-ldr` pass then an `-hdr` pass.
  Compile time strictly doubles. `[engine]` (`vrad_launcher.cpp:64-138`)

Project judgement: LDR alone for a player-dense RP interior (the HDR gain is marginal there, the
compile and bandwidth cost is not); `-both`/`-hdr` reserved for an exterior where day/night contrast
is a central visual argument. `[consensus, project judgement]`

**Verifying**: `read_bsp_info` answers it directly with `hdrLighting`, read from lumps 53, 54 and
58. ⚠️ **Not from lump 56** — `LEAF_AMBIENT_LIGHTING` is per-visleaf ambient and non-empty on LDR
maps too. Nor from 55, whose name ends in `HDR` and which is also non-empty on a map with no HDR
lighting whatever `[measured]`.

## Cubemaps

Built **in game**, never at compile time — VBSP only places default black cubemaps
(`cubemapdefault.vtf`) pending `buildcubemaps`. File counts, the pakfile evidence and the separate
HDR/LDR trap are in `source-map/references/lighting.md`; not duplicated here.

⚠️ A map reloaded before its new `env_cubemap` has been compiled into the `.bsp` cannot receive a
reflection yet: `buildcubemaps` fills entities already present in the file, it does not create them.
The order is: compile first, `buildcubemaps` second.

**Verifying**: `run_console_command`/`read_convars` to drive `mat_specular`, `building_cubemaps`,
`buildcubemaps` in game; the visual result (correct reflection or flat) is human judgement via
`capture_screen`.

## Shadows

Three distinct mechanisms, not to be confused:

- **Shadows baked into the lightmap** — the radiosity itself; what VRAD computes by default for
  opaque brushes and displacements.
- **Texture shadows (`-textureshadows`)** — cast by the alpha of an `$alphatest`/`$translucent`
  material (grate, foliage, fence). VRAD **never** computes a shadow from transparent or translucent
  geometry without that flag; a fence with neither `-textureshadows` nor a RAD file casts nothing.
  `[engine]` (VDC, VRAD article, Bugs and caveats)
- **Real-time dynamic shadows** (players, physics props) — driven by `shadow_control` (or
  `env_cascade_light` on branches that deprecated it), independent of VRAD.

**Verifying**: "the fence casts no shadow" is a compile symptom, not a placement one —
`read_compile_log` will say nothing (no error, just an absence); `read_fgd_class` on the material or
prop, then a visual check, settle it.

## What blows up compile time

VRAD is almost always the longest stage in the chain. In order of impact as observed in the code:

| Lever | Effect measured in the code | Cost |
|---|---|---|
| `-both` (HDR+LDR) | reruns VRAD entirely, twice | strictly ×2 `[engine]` |
| `-final` | exactly equivalent to `-extrasky 16` — not a magic mode that adds AO/textureshadows/StaticPropLighting | ×16 rays for the indirect pass, nothing else by default `[engine]` (`vrad.cpp`) |
| `-StaticPropLighting` | per-prop vertex lighting, one job per instance | grows with the **number** of props, not their size `[engine]` |
| `numbounce` (default 100, historically 8) | radiosity bounces | diminishing returns after a few dozen; `-bounce 0` disables the indirect pass `[engine]` (`vrad.cpp:51`) |

⚠️ **`-final` includes neither `-staticproplighting` nor `-textureshadows`.** A compile believed
"final" without adding them explicitly ships unlit props and shadowless fences, with no error to
say so. `[engine]`

To iterate fast: `-fast` (or `-bounce 0`, no `-final`, no `-StaticPropLighting`) — cycles of seconds
to minutes rather than hours, but `-fast` produces noise blotches in dark areas and on displacement
edges: never shipped as is. `[engine]` (VDC, VRAD article)

**Verifying**: `run_compile` with `fast: true` when iterating, `fast: false` reserved for shipping
(already the parent `SKILL.md`'s rule). `read_compile_log` gives the duration per stage; a clean,
unexplained doubling points at an implicit `-both` rather than a geometry regression. The Hammer++
lighting options (`-ambientocclusion`, `-propambient`, `-worldtextureshadows`) are not exposed by
`hammer-mcp`, for the reason already given: setting them is a visual judgement, not a tool boolean.
