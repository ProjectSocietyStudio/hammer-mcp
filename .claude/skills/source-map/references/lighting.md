# Lighting a map

## Lightmaps and luxels

The default scale is 16 units per luxel. Finer means better looking and **much** slower: the cost
grows with the square.

A brush face is capped at **32 luxels along either texture axis**
(`MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER`) — past that, vbsp splits the face. Do not reach for
`MAX_LIGHTMAP_DIM_WITHOUT_BORDER`: despite the obvious-looking name and a comment claiming it is
"the actual max", it aliases the **displacement** value of 125, four times the real limit for a
brush face.

⚠️ **Displacements are not subdivided** the way brush faces are. A fine scale on a displacement is
the number one cause of a vrad compile going from minutes to hours. `read_vmf_lint` flags it.

## What is baked, and what is not

**All static lighting is baked by vrad, into the `.bsp`.** Direct consequences:

- Adding a `light` entity through a lump patch **does nothing**. The tool warns.
- Changing a light requires a full vrad recompile.
- A map that leaks loads **fullbright**: the lighting could not be computed.

## HDR

Two independent lightmap sets, in distinct lumps. This can more than double the file size.
`read_bsp_info` answers the question directly with `hdrLighting`, read from lumps 53, 54 and 58.

⚠️ **Not from lump 56.** `LEAF_AMBIENT_LIGHTING` is per-visleaf ambient and is present in LDR maps
too — reading it as HDR reports every LDR map as HDR-compiled. Nor from lump 55, whose name ends in
`HDR` and which is non-empty on `rp_nycity_day`, a map with no HDR lighting at all.

That presence is **evidence recoverable from the file** that an HDR compile happened, which beats
trusting the settings you think you used.

## Cubemaps

Reflective surfaces need cubemaps, built **in game** by `buildcubemaps`, not at compile time.
Without them, anything reflective shows the default cubemap.

The check is file-side: `read_pakfile` counts the embedded `c-*.vtf`. On `rp_nycity_day`, **345** —
so `buildcubemaps` did run. That is evidence, not a memory.

⚠️ HDR and LDR each have their own cubemaps. Building them in one mode does not build them in the
other.

## Static props

By default a `prop_static` receives **a single lighting sample** for the whole model — hence props
that seem to float, lit differently from the floor they stand on. `vrad -StaticPropLighting` bakes
per-vertex lighting into `.vhv` files.

Same check as for cubemaps: `read_pakfile` counts the `.vhv`. On `rp_nycity_day`, **3983** —
per-vertex lighting was baked.

## Where the lighting budget actually goes

Each doubling of the lightmap scale divides the bill by roughly four. Measured on one face:

| Scale | Luxels | LIGHTING bytes |
|---|---|---|
| 8 | 17,424 | 69,760 |
| 16 | 4,624 | 18,560 |
| 32 | 1,296 | 5,248 |
| 64 | 400 | 1,664 |

That is why `rp_nycity_day` sits at **264% of `MAX_MAP_LIGHTING`**: you do not get there by picking
a fine lightmap once, you get there by never coarsening the surfaces that did not need it. A
warehouse floor at 16 and the same floor at 32 are indistinguishable to a player and a factor of
four apart on disk.

## What VRAD++ adds, and why it is not a tool

The Hammer++ chain (`toolchain: "plusplus"`) opens lighting options the stock chain does not have:
`-ambientocclusion` / `-aoscale`, `-propambient`, `-worldtextureshadows`, soft lights.

**None is exposed by `hammer-mcp`, deliberately.** A tool can prove an HDR lump exists or count
`.vhv` files; it cannot say whether an ambient occlusion setting looks right. That is a visual
judgement, so it lives here and is settled by eye, on screenshots — not in a boolean that would
return "fine".

To try them, go through `run_compile` with `toolchain: "plusplus"` and look at the map. The only
machine check available stays indirect: `read_map_geometry` says whether the LIGHTING lump changed
size, which proves vrad did the work again, not that it did it well.
