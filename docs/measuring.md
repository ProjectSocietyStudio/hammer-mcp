# Measuring a map

The rule that governs every reader here: **a `.bsp` is never loaded whole.** The map used
throughout this page is 1.13 GB. A `readFileSync` on it inside an MCP server kills the open stdio
transport, which the caller sees as a hang rather than an error. Everything reads by offsets.

The second rule: **no number without an outside witness.** What separates a measurement from a
figure stated with confidence is that something else, arrived at independently, agrees.

## Milestone 1 — reading, proven against a production map

Measured 02/08/2026 on `rp_nycity_day.bsp`, the map of a live Garry's Mod roleplay server:

| | |
|---|---|
| Size | 1,130,563,848 bytes (1.13 GB) |
| Version / `mapRevision` | VBSP 20 / 10863 |
| Lump 40 PAKFILE | 1004.0 MB |
| Lump 8 LIGHTING | 42.3 MB |
| Lump 0 ENTITIES | 1,548,648 bytes, **3555 entities** |
| Read time | **79 ms** |

Histogram: `light_spot` 1262 · `func_door_rotating` 451 · `trigger_soundscape` 211 · `func_button`
182 · `func_door` 171 · `path_track` 129 · `light` 111 · `prop_physics_multiplayer` 111 ·
`env_soundscape_proxy` 107 · `info_player_start` 100 · **`prop_dynamic` 59**. Doors in total: 622.

Those 59 `prop_dynamic` match exactly the count an unrelated Lua addon had measured in game for
props that `Entity:isDoor()` wrongly accepts — two independent measurements landing on the same
number, so the parser really is reading the map the server loads.

The 79 ms come from reading by offsets: 1036 bytes of header, then 1.5 MB of one lump. Nothing else
is touched.

## Milestone 2 — measurement, cross-checked three independent ways

Measured 11/08/2026 on the same map.

| What | Result | The witness |
|---|---|---|
| World extents (lump 14) | mins `(-15424, -15936, -6208)`, **802.6 m** across, 639,338 m² | a separate addon had read the same lump by hand: "the map is 802 metres", same mins |
| `prop_dynamic` | **59** | counted in game by `Entity:isDoor()` |
| `mapRevision` | **10863** | our TypeScript reader, and srctools, separately |
| Embedded pakfile | **15,258 files**, 1001.7 MB | lump 40 measures 1004 MB at milestone 1 |

The unit: **1 Hammer unit = 1 inch = 0.0254 m.** That is not a convention chosen for convenience;
it is the ratio that makes the map land on the 802 m measured by hand.

## The pakfile says how the map was compiled

`read_pakfile` opens lump 40 — an ordinary ZIP — and two of its counts are **evidence recoverable
from the file alone**, where you would otherwise have to trust someone's memory of the compile
settings:

- **345 `c-*.vtf`** → `buildcubemaps` was actually run;
- **3983 `.vhv`** → static prop vertex lighting was baked (`-StaticPropLighting`).

The rest of the inventory: 2840 `.vmt`, 2616 `.vtf`, 939 `.mdl`, 187 `.wav`, 63 `.mp3` — three club
tracks over 10 MB each — and one `.ain`, the NPC nodegraph.

## What the map reveals about its own compilers

`read_map_geometry` compares each lump to the ceilings in `src/public/bspfile.h` of the 2013 SDK,
read at the source. Three lumps are tight — `TEXINFO` **96.4%**, `VERTEXES` **95.0%**, `BRUSHES`
**84.4%**: this map cannot grow much further.

And one lump is **over**: `MODELS` at **1218 against a ceiling of 1024**, or 119%. The map loads
every day. So it is not a broken map — **it is evidence that the compilers which produced it raise
that ceiling.** The tool reports it in those terms rather than crying error, because "this file
violates a constant I read in a header" is what it knows, and "this map is broken" is not.

## Sightlines, and the three ways of being wrong before getting there

`read_sightlines` walks the BSP tree exactly as the engine does for a trace — the recursion is
`SV_RecursiveHullCheck`, unchanged since Quake. Three lumps suffice (PLANES, NODES, LEAFS): 1.6 MB
read out of 1.13 GB, tree loaded in **20 ms**, then 26,000 traces in 22 ms.

**The tracer is validated against dense sampling** — walking a segment point by point must return
the same verdict as a tree descent. Measured 11/08/2026: **1275 agreements out of 1276** on the
production map, the single disagreement being a wall thinner than the sampling step. And on the
probe map, a sealed room, a ray aimed outward **must** be blocked: that is the negative control,
without which a tracer answering "clear" everywhere would pass every other test.

What remained was **where to sample**. Three methods were tried, and all three returned confident,
wrong numbers:

| Method | What it returned | Why it was wrong |
|---|---|---|
| Entity origins (`info_player_start`, `path_track`) | 706 m | `path_track` runs up to z=3980 — those are elevator routes; the median spawn is at z=-380, a buried room |
| First surface under a downward trace | 852 m, ground up to z=7232 | from the sky, the first surface you hit is **the roof** |
| Lowest surface in the column | 820 m, median z=-6080 | the lowest point is the **skybox floor**, underneath the city |

The method kept relies on no invented convention: **the altitude where the mapper put the content.**
The median of 3452 entity origins lands at **z=195**, and street-level entities confirm it
independently — props at 76, doors at 121, ambiences at 168, streetlights at 232. A histogram of
walkable surfaces puts 320 of them in the `z=0` band, the second peak behind the void floor. Two
independent signals, one answer.

**What the tool does not know, and says so**: a `.bsp` has no notion of "street". `prop_static`
(3986 on this map) and brush entities are not in the world tree — a closed door reads as open. The
tool returns those caveats in an `excludes` field rather than letting anyone believe it measures
what it does not.

Result on `rp_nycity_day`, 512-unit step, 1051 points in built-up areas, 551,775 pairs in **387 ms**:
the longest clear line is **30,278 units = 769 m**. It is real — verified point by point — but it
crosses open ground, not an avenue.

## Built surfaces

`read_brush_volumes` reads the bounding box of each brush entity's model (`model` `"*N"`, lump 14).
On `rp_nycity_day`, **all 1217 models are attributed to an entity, 100%** — that is the oracle for
the join: an orphaned model would mean the correspondence is wrong.

| Class | n | Median footprint |
|---|---|---|
| `func_door_rotating` | 451 | 0.14 m² |
| `trigger_soundscape` | 211 | 208.1 m² |
| `func_door` | 171 | 0.14 m² |
| `func_brush` | 26 | 64.0 m² |

The door counts land back on milestone 1's histogram, and the magnitudes hold up: a door is a thin
slab, a soundscape covers a room. **These are bounding boxes, not real volumes** — an L-shaped room
measures as its enclosing rectangle, and the tool says so.

## A lump named wrong is worse than a lump unnamed

Found by a second reader on 11/08/2026, on three maps this repository had never seen.

`read_bsp_info` labelled lump 56 `LIGHTING_HDR`. In `src/public/bspfile.h`, 56 is
`LUMP_LEAF_AMBIENT_LIGHTING` and `LUMP_LIGHTING_HDR` is **53**. The two are not
interchangeable: 56 carries per-visleaf ambient lighting and is present in LDR maps as well,
so anyone auditing whether a map was compiled with HDR read the answer backwards, on every
LDR map, with nothing to flag it.

The production map is the discriminating case, and it was here all along:

| Lump | | Bytes |
|---|---|---|
| 56 | `LEAF_AMBIENT_LIGHTING` | 3,548,076 |
| 55 | `LEAF_AMBIENT_LIGHTING_HDR` | 663,908 |
| 53 | `LIGHTING_HDR` | **0** |
| 54 | `WORLDLIGHTS_HDR` | **0** |
| 58 | `FACES_HDR` | **0** |

`rp_nycity_day` has no HDR lighting at all. Under the old label it reported
"LIGHTING_HDR: 3.5 MB". And note lump 55, whose name ends in `HDR` and which is **non-empty
on this LDR map** — so neither ambient lump can answer the question. Only 53, 54 and 58 can,
which is what `hdrLighting` now reads.

**The cause was not the typo.** Two hand-maintained lump-name tables existed, one in
`bsp/header.ts` and one in `bsp/geometry.ts`, and they disagreed: geometry had 53 right while
header had 56 wrong. Nothing compared them, so the two tools built on them answered
differently and neither was checked against the other. There is one table now, and
`LUMP_SPECS` carries no name at all.

The test asserts the names against a list written out from `bspfile.h` rather than derived
from the table, because a table checked against itself checks nothing.

## The guard that stops a number being invented

A wrong structure size would produce a plausible, wrong count. So `read_map_geometry` only reports
a count when the lump length divides **exactly** by the record size, and says why when it does not.
It did exactly that on the first attempt, on `DISP_VERTS`: 944,944 bytes is not a multiple of the
expected 20, and no count was returned.

## Why the `prop_static` conversion list was not trivial

The first filter looked for the **presence** of the keys `targetname`, `parentname`, `defaultanim`.
It returned **0 candidates out of 59**, which looked like a result. Hammer in fact writes *every*
key of a class with its default value: all 59 props carry all three. Only a **non-empty value**
means anything — 29 parented, 14 named, 2 animated. The corrected filter returns **17 candidates**,
and the tool ships the list with a caveat: converting requires a recompile, and a model not
compiled with `$staticprop` cannot be converted at all.
