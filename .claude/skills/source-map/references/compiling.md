# Compiling a map

## The three stages

| Stage | What it does | Order of magnitude |
|---|---|---|
| **vbsp** | builds the BSP tree, writes the entity list, detects leaks | seconds to minutes |
| **vvis** | computes visibility between visleaves (the PVS) | **the slow one** — minutes to hours |
| **vrad** | radiosity: lightmaps, prop lighting, ambient samples | minutes to hours |

`run_compile` chains them and **stops at the first one that fails**. That is not excessive caution:
running vvis after a leak spends an hour computing a visibility set that means nothing.

## Iterate, then ship

- **Iterating**: `fast: true`. vvis returns a conservative PVS, vrad a coarse lighting pass.
  Development quality only, but you see your map in minutes.
- **Shipping**: `fast: false`, and `hdr: true` if the map is to carry an HDR lightmap set.
- **Touching only entities**: nothing to recompile at all. A lump patch is enough, or
  `vbsp -onlyents` if you have the source.

## Which chain — stock or Hammer++

**The default is `plusplus`** — ficool2's Hammer++ rebuild — and `cull` is on with it. You do not
pass either; you pass `toolchain: "stock"` when you specifically want the compilers the game ships.

| Situation | Chain |
|---|---|
| Iterating, shipping, everyday work | the default |
| Doubt about a result the `++` chain returned | `toolchain: "stock"`, recompile, compare |
| A compile that must prune nothing | `cull: false` |

`cull` prunes what nothing references without waiting for a ceiling to be reached. Measured on
`ttt_traps`: −20.5% `PLANES`, −12.8% `VERTEXES`, −10.5% file size, faces and texinfos unchanged —
which is what distinguishes a prune from a broken map. It is **refused** on the stock chain rather
than ignored, since vbsp swallows unknown options silently.

The `++` binaries stay optional: `health` says whether they are there, and without them
`run_compile` **falls back to stock**, reporting it in `toolchainNote` with the binaries that were
missing. So read `toolchain` in the result, not the argument you passed — they are not always the
same, and a `.bsp` you cannot attribute to a compiler is the thing this reporting exists to prevent.

## Reading compiler output

`read_compile_log` translates. The compilers speak to whoever wrote them in 2004, and several of
their messages **name the wrong thing**:

| What it says | What it really is |
|---|---|
| `**** leaked ****` | no position given. The `.lin` has one: `read_leak` |
| `Displacement found on a(n) X entity` | the brush id it prints is **always 0**, useless. `read_vmf_lint` gives the real one |
| `Bad surface extents` | texture scale outside `[0.1, 10]`. The face is named by an index you cannot find in Hammer |
| `Can't load skybox file … default cubemap` | **nothing is missing.** vbsp could not build a default cubemap. No effect on geometry |
| `MAX_MAP_*` | a lump is full. `read_map_geometry` says which and by how much |

## A leak

A map that leaks is not sealed: something inside can see the void. The consequences — the PVS
cannot be computed, the map loads **fullbright**, and vvis/vrad stop meaning anything.

**Only world brushes seal.** Not `func_detail`, not displacements, not brush entities. A map sealed
with `func_detail` leaks — and the cause is the optimisation itself: vbsp takes detail brushes out
of the BSP tree, so as far as sealing is concerned they are not there.

No static check can rule it out either, because sealing is a property of the whole hull rather than
of any one brush. Measured on the probe map, a sealed box: **all six of its brushes are
load-bearing, the floor included**, since the void sits directly underneath it.

`read_leak` correlates both ends of the pointfile with the entities and names the one standing on
it. Careful: the position found says **where the ray got through**, not necessarily where the hole
is — but it gives you a starting point, which the compiler does not.

## The traps of the Wine chain

Measured, not guessed:

- **Absolute Windows-form path** (`Z:\...`). A relative path resolves against wine's working
  directory, and vbsp silently compiles the wrong file. `run_compile` refuses a relative path
  rather than converting it.
- **Working directory on `bin/`**, or `tier0.dll` fails to resolve.
- **`WINEDEBUG=-all`**, or stderr is a wall of `fixme:` that buries the compiler's own output.
- The compilers ship with the game **client**, not with `srcds`. A dedicated server's `bin/` has
  none of them.
