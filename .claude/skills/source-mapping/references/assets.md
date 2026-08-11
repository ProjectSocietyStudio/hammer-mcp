# Materials, models and packing

Three families of file make a map self-contained: VTF (texture), VMT (material), MDL and its family
(model). Each has its own hard constraints, and all of them end up in the same pakfile. Material
lighting (`$envmap`, cubemaps) is in [lighting.md](lighting.md) — not here. Mounting CS:S/HL2:EP2 is
in [gmod.md](gmod.md), the in-game cost of `prop_static`/`prop_dynamic` in
[performance.md](performance.md): this page covers building the model, not what it costs.

## VTF — the texture

**Power-of-two dimensions are mandatory, and multiples of 4 for any compressed format** (DXT block).
A non-power-of-two texture is not rejected but treated as the next power of two up by Hammer.
`[engine, VDC VTF]`

- A VTF stores its mipmaps **smallest to largest**, the reverse of DDS. `[engine]`
- **DXT1**: 4 bits/pixel, no smooth alpha (1-bit alpha is possible) — the standard opaque texture.
  **DXT5**: 8 bits/pixel, interpolated 8-bit alpha — a quality alpha channel (specular mask, fine
  alpha-test). `[engine, VDC VTF]`
- ⚠️ **On Source 2013 branches a VTF above 32 MiB does not load**: a 4096×4096 has to stay in
  DXT1/DXT5/I8. VRAD also computes no texture shadow from DXT3 — use DXT5 or BGRA8888 for any
  material meant to cast one. `[engine, VDC VTF]`

## VMT — the material

A missing material gives the purple-and-black chequerboard; a **white wireframe is not a missing
material, it is a missing shader** — two different diagnoses. `[engine, VDC VMT]`

The shaders that matter: `LightmappedGeneric` (brushes, lightmap), `VertexLitGeneric` (models,
per-vertex or per-pixel lighting), `UnlitGeneric` (HUD/UI), `WorldVertexTransition` (blending two
textures on a displacement). A parameter the shader does not support produces **no error** — it is
silently ignored. `[engine, VDC VMT]`

- `$basetexture` is all but mandatory; on a model, the alpha channel of the `$bumpmap` (or of the
  basetexture) carries the specular mask — an imposed convention, not an option. `[engine]`
- **`$alphatest` is markedly cheaper than `$translucent`**: faster to render, always correctly
  sorted (translucency only sorts correctly on non-`func_detail` worldspawn), and compatible with
  the flashlight and projected shadows — but binary, with no semi-transparency free of banding.
  `[engine, VDC $alphatest/$translucent]`
- `$alphatestreference` **does not default to 0.5**: `LightmappedGeneric`, `UnlitGeneric` and
  `VertexLitGeneric` default to **0.7** — always set it explicitly. `$translucent` additionally
  disables projected texture shadows on that material entirely. `[engine, VDC
  $alphatest/$translucent]`
- The `%compile*` keys (`%compiletrigger`, `%compilenodraw`, `%compilewater`…) are material flags
  read by VBSP at compile time, not render parameters: a wrong choice shows up at the compile or in
  game, never while hovering the material in Hammer.

## Surfaceprops

`$surfaceprop` (material) and its QC equivalent (model) point at a block of
`scripts/surfaceproperties.txt`: footstep sound, friction, impact decal, and health/debris when
breakable. `[engine, VDC Material surface properties]`

⚠️ **A missing or misspelt value does not break the compile** — it silently falls back to `default`,
wrong footsteps and wrong decals with no console error whatever. `[consensus]`

## Anatomy of a model

The `.mdl` is an **index**: it references `.vvd` (per-vertex data: position, normal, bone weights,
UV), `.dx90.vtx` (triangle strips per LOD, required to render) and `.phy` (collision). None of those
files holds the whole thing on its own. `[engine, VDC .mdl/VTX]`

- **`$staticprop`** in the QC reduces the skeleton to a single `static_prop` bone. Without the flag a
  model keeps its animations and skeleton: placing it as a `prop_static` is not reliable, because the
  engine expects the "static" assumption only that flag establishes. `[engine, VDC $staticprop]`
  Runtime cost: [performance.md](performance.md).
- **`$concave`** inside `$collisionmodel` allows a non-convex hull (an arch, a bent tube). Without
  it the compiler fills the hollow with one or more convex hulls — wrong collision, no error. A
  convex hull stays cheaper in physics CPU: do not ask for `$concave` on an object with no hollow.
  `[engine, VDC Collision Mesh]`
- **Static Prop Combine** (`-staticpropcombine` on VBSP) merges `prop_static` sharing a material
  into a generated model — one draw call fewer per group (Valve reports Nuke 40% faster). It needs
  the QC sources of every prop combined; a stock Valve prop has to be recompiled under another name,
  or the VPK version overrides the combined one. `[engine, VDC Static Prop Combine]`

## The packing table

Paths are relative to the game folder (`garrysmod/`). A file missing from this list means a purple
chequerboard or an ERROR model for any player who does not already have it.

| Asset | Files to embed | Trap |
|---|---|---|
| Simple material | `.vmt` + the `$basetexture`'s `.vtf` | every referenced VTF (`$bumpmap`, `$envmapmask`, `$detail`…) has to be packed too |
| `WorldVertexTransition` material | `.vmt` + **2** basetextures (`$basetexture`, `$basetexture2`) + their bumpmaps | one packed out of two = a chequerboard over half the blend |
| Model (prop) | `.mdl` + `.vvd` + `.dx90.vtx` (+ `.dx80.vtx`/`.sw.vtx` if generated) + `.phy` if it collides + **every** material of **every** skin | an unpacked alternate skin gives ERROR on that skin only, invisible while testing skin 0 |
| Model with LODs | the same + materials specific to each LOD if `$lod` changes them | rare, check in the QC |
| Sound | `sound/<path>/<file>` | path relative to `sound/` |
| Soundscape | the soundscape `.txt` + every referenced `.wav` + an entry in `scripts/soundscapes_manifest.txt` | no manifest entry = never loads, no error |
| Particles | `.pcf` + every particle material (`.vmt`/`.vtf`) + an entry in `particles/particles_manifest.txt` | same, silent |
| Nav mesh | `maps/<map>.nav`, next to the `.bsp` | **never in the pakfile** — a separate file, generated in game |
| Cubemaps | auto-generated into the pakfile by `buildcubemaps` + resave, `c-X_Y_Z.vtf` | never copy or hand-build them — they encode a precise position |
| Custom 3D skybox | 6 faces `skyname*up/dn/lf/rt/ft/bk.vtf` + `.vmt` | pointless when the skybox already comes from a mounted game |
| Detail sprites | `materials/detail/….vmt/.vtf` + the `detail.vbsp` referenced by `detailvbsp` | concerns displacements carrying detail props |

⚠️ **A `.vmt` sitting at the root of `materials/`** (not in a subfolder) can be ignored by `bspzip`
and the scanners wrapping it: always file them under a subfolder. `[engine, VDC BSPZIP]`

## What `run_pack` derives, and what it refuses to imply

`run_pack` takes an explicit list of pairs. With `auto: true` it also **derives** that list from the
map itself: `read_map_dependencies` resolves every reference and separates "packed already",
"provided by the game" and "missing", and auto packs the files that sit loose on disk.

Three things it deliberately will not pretend:

- **Loose is a candidate, not a proof.** No rule cleanly separates a mapper's work from a game's own
  loose files — they live under the same installation. Garry's Mod ships `detail.vbsp` loose in its
  own root `[measured]`, which is why `excludePaths` exists. Leaning towards inclusion is acceptable
  only because the asymmetry is: packing a game file costs a few kilobytes, missing one ships a
  broken map.
- **The derived list comes back in the output**, so what was packed is visible rather than assumed.
  A tool that packed silently would leave no way to tell "nothing needed packing" from "the
  derivation failed" — both look identical from a successful exit code.
- **What is missing everywhere is named as such.** Packing will not fix it, and a run that packs six
  files while four stay missing must not read as finished.

Neither can anything trace assets called dynamically from Lua (`Model()`, `ClientsideModel()`), which
nothing on the map side records — a known tooling gap, here as in the public domain. And `bspzip`
exits 0 whether or not it added anything; `run_pack` counts the pakfile before and after rather than
believing that return code.

## Two visual failures, two causes

| Symptom | Cause | Diagnosis |
|---|---|---|
| Purple-and-black chequerboard | the model loads, **one of its materials** fails (missing VMT, forgotten subfolder, invalid shader or parameter) | console `mat_reloadmaterial`, `developer 1` (`gmod-mcp` → `run_console_command`, `read_console`) |
| ERROR model (the red-and-black 3D sign) | the **`.mdl` itself** does not load — file missing, corrupt, or a VTX/PHY dependency absent | `read_pakfile` (hammer-mcp) to check the whole family is embedded |

⚠️ **Path case is unforgiving on Linux.** A GMod dedicated server runs on a case-sensitive
filesystem; `Materials/Props/Foo.vmt` referenced as `materials/props/foo.vmt` loads on a Windows
workstation and breaks silently in production, with no exception for `materials/`, `models/` or
`sound/`. `[engine — filesystem behaviour]`

## The trade-offs

| Situation | Choice | Why |
|---|---|---|
| Hard-edged transparency (grate, fence) | `$alphatest` | cheaper, always correctly sorted |
| Graded transparency (tinted glass) | `$translucent`, sparingly | the only way without banding, but pays for sorting and overdraw |
| Repeated decorative geometry (ironwork, moulding) | Propper → `prop_static` (`$staticprop`) | a model is a single optimised draw call; it cuts the BSP/visleaf cost |
| Simple geometry with a structural role (door, VIS cut) | stay a brush (`func_detail` when not structural) | Propper on an object that must keep a compile role is a misuse |
| Concave collision (arch, bent tube) | `$concave`, several convex hulls assembled | without it the compiler fills the hollow |
| Simple collision (crate, plank) | plain convex, no `$concave` | cheaper in physics CPU |

## Verifying

- Packing completeness and pakfile growth: `read_map_dependencies`, `run_pack`, `read_pakfile`
  (hammer-mcp).
- Model or material loading without error in game: `capture_screen`, `read_console`, `read_logs`
  (gmod-mcp) — the test that settles it is still removing the custom asset folder and looking for
  `ERROR`/`Missing` in the console (the shipping protocol is in
  [`source-map`](../../source-map/references/shipping.md)).
- Entity counts, to place the cost of a brush-versus-model choice: `read_map_geometry`,
  `read_bsp_entities` (hammer-mcp).
- VTF dimensions and format, the validity of a `$surfaceprop`, whether `$staticprop` really took,
  whether a collision hull is genuinely concave: human judgement, not tooled — nothing here reads
  inside a VTF or an MDL. External: VTFEdit, the Hammer++ model viewer, Crowbar.
