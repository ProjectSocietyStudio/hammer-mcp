# Brush geometry

Brush geometry is the raw material of any Hammer map: what vbsp compiles, what vvis cuts, what
seals or leaks. This page covers the grid, valid shapes, tool textures and the world brush /
`func_detail` / brush entity choice — not visibility (`visibility.md`), not lighting, not
displacements, not performance, which each have their own reference.

## The grid

**Hammer's grid step is always a power of two**: 1 - 2 - 4 - 8 - 16 - 32 - 64 - 128 - 256 - 512 -
1024 units, never an intermediate value `[engine]`. Going below 1 unit for a fine adjustment is
tolerated but rarely necessary — it is the first step towards the welding tolerance below, not a
normal working scale `[consensus]`.

Verifying: human judgement, not tooled — Hammer shows the current step (`[`/`]`), and
`read_vmf_lint` can flag an off-grid brush where the rule is implemented; otherwise it is a visual
read in the editor.

## Valid shapes

**A brush must be convex, with planar faces.** That is the definition vbsp applies: a non-planar
face or a concave volume gives an *invalid brush* `[engine]`. There is no such thing as a compound
brush — a non-convex shape is built from several convex brushes assembled.

⚠️ **vbsp only welds a misaligned vertex within ~0.03 units of the face plane** `[engine]`. Past
that there is no automatic correction: the brush stays invalid, silently in Hammer, and can produce
malformed visleaf portals at compile time — hence a leak that is invisible in the editor. Any
vertex-tool edit must re-check the planarity of **every** face sharing the moved vertex, not just
the one you were aiming at.

`read_vmf_solids` recovers a solid's volume **from its planes**, running the opposite way to the
writer — convexity, planarity, bounds and grid all get checked without opening the editor.

Verifying: **Map → Check for Problems** (Alt+P) in Hammer before any compile — editor-assisted
human judgement. Downstream, `read_vmf_solids` and `read_vmf_lint`, and if the compile got that
far, `read_leak`.

## Cutting a shape

| Need | Tool | Why |
|---|---|---|
| Split a brush in two along a plane | Clip tool | Clean cut, result always convex and planar |
| Adjust a corner, a bevel | Vertex tool, carefully | Cleaner than Carve, but every move must stay on grid — otherwise the 0.03u tolerance is exceeded |
| Hole, arch, complex shape | Assemble several convex brushes, or switch to a displacement | Carve produces invalid faces and corrupt volumes as soon as the result is no longer a single convex volume |
| The rare case where Carve is still acceptable | Only if the cut stays **one** convex volume, with no split | A split into pieces creates unoptimised brushwork and off-grid angles |

⚠️ "Never use Carve" is **`[disputed]`**: too absolute. The real prohibition is on the usage that
forces a split into several pieces or a concave shape — not on the tool itself.

Verifying: Check for Problems after any cutting operation, then `read_vmf_solids` and
`read_vmf_lint`.

## Tool textures

| Need | Texture | Trap |
|---|---|---|
| Face never seen in game | `toolsnodraw` | Stays solid and **seals** — zero rendering, not zero collision `[engine]` |
| Face that must exist nowhere | `toolsskip` | Does not exist in the compiled BSP: no collision, no cut. Using it instead of nodraw creates a collision hole invisible in the editor `[engine]` |
| Force a precise visleaf cut | `toolshint` on the cutting face, `toolsskip` on the other faces of the same brush | Without a hint, vvis cuts on its own and often badly in an L-corridor `[engine]` |
| Block player + physics + bullets | `toolsclip` | Also solid to items and C4 depending on the game |
| Block the player only | `toolsplayerclip` | ⚠️ ignored by nav mesh generation — a bot can walk through an area blocked to the player `[engine]` |
| Non-solid entity volume (trigger, viscluster) | `toolstrigger` | The texture alone does nothing: it must clothe a brush **attached to an entity** (`trigger_*`) `[engine]` |
| Areaportal area | `toolsareaportal` | Same: with no linked `func_areaportal`, the texture is inert `[engine]` |

⚠️ "nodraw and skip are interchangeable" is **`[disputed]`**: false, with documented opposite
behaviours (nodraw seals and cuts, skip does not exist in the compiled BSP). A frequent and
expensive confusion — the most misused texture pair in the VDC corpus.

Verifying: `read_compile_log` and `read_bsp_info` after a compile — a `toolsskip` face must appear
nowhere in the compiled BSP's counts, unlike `toolsnodraw`.

## World brush, `func_detail`, brush entity

**The split that matters**: does removing this brush open a line of sight or break the world's
seal? If yes, it is structural (world brush). Otherwise it is detail.

| | World brush | `func_detail` | Brush entity (`func_brush`, `func_wall`…) |
|---|---|---|---|
| Cuts visleaves | yes | no — merged back as `CONTENTS_DETAIL` | no |
| Can seal the world / an areaportal | yes | **no, never** | no |
| Counts against `MAX_MAP_BRUSHES` | yes | yes | yes |
| Use | load-bearing walls, floors, ceilings | mouldings, furniture, posts, steps | door, window, a wall toggling solid/non-solid |

⚠️ **A `func_detail` does not seal.** An exterior wall marked as detail leaks the map even if the
room looks closed in game `[engine]`. And a `func_detail` **cuts against other `func_detail`**:
stock vbsp has no detail levels, so two touching details cut each other with no arbitration — only
the detail/structural contact is asymmetric (detail gets cut, not the reverse) `[engine]`.

`set_solid_class` flips a brush between the two and reports the visibility effect, refusing to move
one out of a `hidden` block — unhiding a brush as a side effect of an edit that said nothing about
visibility is exactly the kind of surprise a diff does not explain.

**`func_brush`** replaces `func_wall` / `func_illusionary` / `func_wall_toggle`, all officially
deprecated — `Solidity` (0 = toggle, 1 = never solid, 2 = always solid) covers all three uses
`[engine]`. **`func_lod`** does the same as a `prop_static` with LOD but remains a full edict — only
reach for it when the model genuinely cannot be a prop `[engine]`.

The structural/detail choice is **the only genuinely human judgement on this page**; the counting
that goes with it is not.

Verifying: `read_map_geometry` gives the world/detail ratio but not which wall is which — a
starting point, not a verdict. `read_brush_volumes` quantifies volume per brush. The seal is proven
by compiling and reading `read_leak` if the map leaks. VIS proper — hint/skip, areaportals,
occluders, visclusters — lives in `visibility.md`.

## Hard limits

All read in `src/public/bspfile.h` (`ValveSoftware/source-sdk-2013`), not off a wiki `[engine]`:

| Constant | Value | What drives it up fast |
|---|---|---|
| `MAX_MAP_BRUSHES` | 8192 | every brush, world + detail + brush entity together |
| `MAX_MAP_BRUSHSIDES` | 65536 | often the first limit reached — high-resolution cylinders and arches left as world brushes rather than detail |
| `MAX_MAP_ENTITIES` | 8192 | includes brush entities |
| `MAX_MAP_PLANES` | 65536 | every unique face; aligning brushes edge to edge on one plane reuses the entry instead of creating one |
| `MAX_MAP_TEXINFO` | 12288 | rarely the limit that breaks first |

⚠️ **32768 is an extent, not a bound.** The world runs from −16384 to +16384 on each axis
(`MAX_COORD_INTEGER`) `[engine]`. Building "up to 32768" leaves the world by a factor of two.

The compiler names the constant it exceeded in full in its error message — no need to guess which
one broke.

Verifying: `read_bsp_info` and `read_compile_log` give the compiled counts; compare them to the
table above. `read_map_geometry` before compiling to see whether a map still has headroom — and
note that it now applies byte-denominated ceilings too, so `MAX_MAP_LIGHTING` is watched alongside
the record counts.
