# Shipping a map

## Packing the assets

A custom asset that is not packed shows up as a purple chequerboard for everyone who does not have
it. `run_pack` packs files into the `.bsp` through `bspzip`.

⚠️ **`bspzip` exits 0 whether or not it added anything.** So `run_pack` does not believe its exit
code: it counts the pakfile before and after, and only returns `ok: true` when the file count grew
by exactly what was asked for.

`run_pack` **does not guess** what a map references: it takes explicit pairs.

**The test that settles it**: move the custom asset folders out of the way, load the map, and search
the console for `ERROR` and `Missing`. That is the only check that proves the `.bsp` stands alone —
an isolation test, not a re-reading of a list.

It is also the one defect on this page a mapper **never** sees at home: they have the files.

## Nav mesh

**Recompiling a map always invalidates its nav mesh.** The engine compares the BSP size recorded in
the `.nav` against the map it is loading and **says nothing** when they differ: in game that looks
like Nextbots refusing to move, with a silent console.

`read_nav` returns a `fresh` / `stale` verdict. Regenerating one needs `nav_generate` in the
engine — no offline generator exists, here or anywhere public.

Worth checking on third-party maps too, not only your own: one map in a measured corpus of three
shipped a nav mesh whose recorded size matched no `.bsp` in its own archive.

Not to be confused with the **nodegraph** (`.ain`): that one serves scripted HL2 NPCs, the nav mesh
serves Nextbots. `rp_nycity_day` ships an `.ain` in its pakfile.

## The pre-ship check

| Point | How | Who decides |
|---|---|---|
| No leak | `run_compile` then `read_leak` | the tool |
| Cubemaps built | `read_pakfile` counts the `c-*.vtf` | the tool |
| Prop lighting baked | `read_pakfile` counts the `.vhv` | the tool |
| Nav mesh current | `read_nav` | the tool |
| Headroom before the ceilings | `read_map_geometry` | the tool |
| Assets packed | isolation test, console | the tool produces the log, a human judges |
| Spawns, clips, exploits | playtest | **a human** |
| Pacing, readability, looks | playtest | **a human** |

## Garry's Mod Workshop

`gmad` then `gmpublish`. Two hard constraints: the icon must be a **baseline JPEG, 512×512**, and
only certain extensions pass — the whitelist is in `gmad`'s `AddonWhiteList.h` (`.dll`, `.exe`,
`.js`, `.html` are banned).

No `hammer-mcp` tool drives this step yet.
