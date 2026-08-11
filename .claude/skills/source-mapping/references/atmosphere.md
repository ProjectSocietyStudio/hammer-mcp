# Atmosphere: sound, fog, water, sky, weather, colour

## The general model

Atmosphere is not computed like geometry or lighting: it is **declared**, zone by zone, through
entities that cost almost nothing to place and a great deal to get wrong. Nothing here is baked by a
compiler — it is all driven in game, so it is all verified in game.

## Soundscapes

`env_soundscape` sets **only** the active soundscape and the origin of positioned sounds; its
`radius` is the **trigger** radius (line of sight required), not the audio range of the referenced
sounds — `-1` means infinite triggering, not infinite audible range. One soundscape is active at a
time: activating a second **crossfades** the first, it does not add to it, and the player keeps the
last one triggered even out of line of sight. **`info_player_start` must be covered**, or the player
spawns with no ambience. `[engine]`

| Need | Entity | Why |
|---|---|---|
| Zone by proximity + line of sight | `env_soundscape` | The default case |
| Settings shared across several entrances | `env_soundscape_proxy` | References an existing `env_soundscape` rather than duplicating it |
| Triggering by volume rather than LOS | `env_soundscape_triggerable` + `trigger_soundscape` | A plain `env_soundscape` does not answer `trigger_soundscape` `[engine]` |

The file must be listed in `scripts/soundscapes_manifest.txt`, or named
`soundscapes_<mapname>.txt` for clean per-map mounting. ⚠️ **The 64 simultaneous sound limit is
shared** across every active `ambient_generic` and soundscape sound — exceeding it corrupts the
audio engine across the whole map. `[engine]`

⚠️ The soundscape **script** is found through a manifest, so nothing in the map names the file. A
dependency walker that does not know that convention reports it as dead weight — see
`tooling-coverage.md` on what the engine owns without anything naming it.

**Verifying**: `soundscape_debug 1` in game (purple cubes: green triggered, yellow active but not
triggered, red inactive), `soundscape_flush` to reset — runtime state no `hammer-mcp` tool reads
from the file.

## `ambient_generic`

A sound that must follow a moving entity goes through `SourceEntityName`, never through ordinary
parenting. Two hard conditions: the target entity must **already exist** when the `ambient_generic`
spawns, and be **networked to the client** (`info_target` + *Transmit to client* flag). Assigning
`SourceEntityName` via `AddOutput` is **not supported** — break that and the sound stays frozen at
its spawn position, with no error. `[consensus]`

`radius` (default **1250** units) is only an approximate fade: the sound keeps playing internally
beyond it and still counts against the same limit of 64; prefer an `env_soundscape` as soon as the
ambience is more than a one-off effect. `[engine]`

**Verifying**: `read_fgd_class` for the game's exact keyvalues, `read_vmf` to confirm
`SourceEntityName` points at an entity present in the file — the audible result stays human
judgement, not tooled.

## Fog

⚠️ **Fog buys no performance in itself.** `fogstart`/`fogend`/`fogcolor` produce a colour fade —
what it hides goes on being drawn in full behind the veil. Only **`farz`** actually cuts rendering
beyond a distance; it is the only one of the three settings that touches the GPU.
`[consensus/disputed — farz behaves inconsistently in GMod, cf. Facepunch/garrysmod-issues#6300]`

`farz` must be **greater than `fogend`**. Default `-1`, resolved internally to **28377.9204312**
Hammer units. `fogmaxdensity` is a float **0.0–1.0** (0.45 = 45%), not 0–255 nor 0–100. Several
`env_fog_controller` can coexist per zone (`SetFogController` sent to the player, or a `Master`);
the `sky_camera`'s fog is set separately and must be **matched by hand** to the main world's — it
receives no `Inputs` to follow it. `[engine]`

**Verifying**: `read_vmf`/`read_vmf_lint` for `farz > fogend` and a unique `Master`; in game,
`mat_wireframe` or a draw-call counter to confirm `farz` really cuts something in the distance —
and note `mat_wireframe` is a **client** cvar, useless server-side.

## Water

Two structural rules, not advice: **one PVS can contain only one *expensive* water height, and
cannot mix cheap and expensive water** (break it and water goes invisible or unrendered — separate
with a hint or an areaportal to force distinct PVSs); **one `water_lod_control` per map**
(`cheapwaterstartdistance`/`cheapwaterenddistance` apply to the whole map, VBSP adds one if absent,
having two breaks the compile). `[engine/consensus]`

Cheap and expensive water are **not the same shader**: cheap = `LightmappedGeneric` +
`%compilewater` + `$envmap`/static cubemap; expensive = real-time reflection/refraction, rendering
the scene internally up to three times. Only the top face carries the Water material; sides and
bottom in `tools/toolsnodraw`, rectangular surface with no slope in Z. `[engine/consensus]`

⚠️ **Moving water (tides, waves) cannot carry the Water shader** — it depends on a static visleaf
split, incompatible with a moving brush. Use `func_water_analog` with `nature/water_movingplane` or
`nature/water_dx70`. `[engine]`

**Verifying**: `read_vmf`/`read_vmf_lint` to count `water_lod_control` (≤1), `read_compile_log` for
VBSP's water warnings — one PVS spanning two heights stays a plan-level judgement.

## Sky: coherence, not visibility

The `sky_camera` / 1-in-16 scale split and the visibility constraints are in `visibility.md` — here,
only what touches atmosphere. `sky_name` references six VTF faces with no suffix; the HDR version
comes from the `_hdr` suffix (except `sky_borealis01`, `sky_wasteland02`) — without it on an HDR
map, a silent fallback to the LDR version, no error. `[engine]`

⚠️ Those six faces are named by **convention**, derived from `skyname` in `worldspawn`, and
referenced by no path. A dependency walker that does not know the derivation rule reports six to
twelve files as unreferenced — files that must not be deleted.

The 3D skybox is **never a replacement** for the 2D sky, always rendered in front of it: its
geometry must stay coherent with what the 2D skybox suggests, and its own fog (on `sky_camera`,
distinct from the main world's) must be **matched by hand** — easy to desynchronise after a pass on
either one. `[consensus]`

**Verifying**: `read_vmf` compares `fogcolor`/`fogstart`/`fogend` between `sky_camera` and the main
`env_fog_controller` — a clashing silhouette or tint stays human judgement, via `capture_screen`.

## Particles and weather

`info_particle_system` takes the **system's name** in `effect_name`, not the `.pcf` filename — and
that system must be precached in `particles_manifest.txt` (or the per-map manifest), otherwise
nothing plays, with no error. Packing, `.pcf` files and manifests in detail: `assets.md`.

`func_precipitation` (rain/snow/ash) is **not GPU accelerated**. Past roughly **32000 visible
vertices** at once it crashes the engine — for dense weather in multiplayer, prefer a particle
system with a bounded zone. `[engine]`

**Verifying**: `read_map_dependencies` confirms a custom `.pcf` is packed and resolves;
`read_vmf`/`read_fgd_class` compare `effect_name` against the name declared in the `.pcf` — the
visible vertex volume in game is only observable at the crash, and is not measured here.

## Colour and exposure

`color_correction`/`color_correction_volume` apply a non-destructive lookup table (`.raw`),
enabled per zone with a fade, at near-zero cost. `env_tonemap_controller` smooths the exposure
transition between two areas of different brightness (`SetAutoExposureMin`/`Max`, default max
**2.0**) rather than letting it jump. `[consensus]`

⚠️ **`env_sun` lights nothing.** It only draws the sun's visual halo in the skybox — the real light
comes from `light_environment` (covered in `lighting.md`), dynamic shadows from `shadow_control`.
Tuning it while believing you are fixing the lighting changes nothing in the scene. `[engine]`

**Verifying**: no `.raw` table or exposure is judged by a tool — `capture_screen`/`read_view`.
`read_vmf` at least confirms a `color_correction_volume`'s coverage and the presence of an
`env_tonemap_controller` in the file.
