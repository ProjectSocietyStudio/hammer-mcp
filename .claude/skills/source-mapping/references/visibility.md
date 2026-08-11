# Visibility

Source only draws what the player can see, and "can see" is decided **at compile time**, not at
render time. `vbsp` cuts the world into convex visleaves using the *world* brushes; `vvis` then
computes which pairs of visleaves can see each other and embeds that table in the `.bsp`. All
visibility optimisation consists of helping that computation conclude "no".

**The rule that comes first: only world brushes cut the BSP tree.** Displacements, point entities,
brush entities and `func_detail` take no part in it — they sit inside leaves that are already
drawn, without creating new ones. `[engine]`

## Structural versus `func_detail`

The most profitable split in a map, and a genuine human judgement.

- **Structural**: the skeleton — walls separating two rooms, floors, ceiling, the hull that seals.
- **`func_detail`**: the rest — mouldings, furniture, brush-built pipework. Moved into the world as
  `CONTENTS_DETAIL`, ignored by `vvis`, cutting nothing. `[engine]`

Rule: *if removing it does not open a line of sight between two rooms, it is detail.*

⚠️ **`func_detail` never seals anything** — not the void, not an areaportal's area. Neither do
displacements, nor a translucent texture. An exterior wall or an areaportal face marked detail
leaks. `[engine]`

Measured on the probe map, a sealed box: **all six brushes are load-bearing, the floor included**,
since the void is directly beneath it. A bare closed room has no brush that is safe to detail.
`[measured]`

⚠️ **A map that is all detail is no better than a map with no split at all**: with no skeleton to
cut against, `vbsp` produces a handful of enormous visleaves — everything sees everything, all the
time. The goal is balance, not maximum detail. `[consensus]`

Verifying: `read_map_geometry` gives the structural/detail ratio and `read_visleaf_stats` the leaf
and cluster counts; neither says which wall is which — that stays a human judgement, to be held
against the plan. `set_solid_class` flips one brush and reports the effect, but read its comparison
narrowly: a detailed pillar disappears from `vvis`, not from `FACES` and not from the lightmap bill.

## Hints and skip

A hint brush forces a visleaf cut where `vvis` would miss one. Texture it entirely in
`tools/toolsskip` except the intended cutting face in `tools/toolshint` — skip faces render nothing
and only affect the brush's geometry, and only the hint face acts on subdivision. `[engine]`

⚠️ **In a corner, the hint must intercept the diagonal, not follow the corridor.** A cut angle
below 180° always leaves a straight line between the two adjacent visleaves — the hint blocks
nothing while still costing compile time. It needs to be above 180°; at exactly 180°, two hints are
required. This is the classic L-corridor mistake. `[engine]`

A diagonal hint is not an axial hint rotated. Measured on one room, stock compilers: no hint 29
leaves / 4 clusters, axial hint 33 / 8, 45° hint 35 / 10. `[measured]`

Placement depends on the real lines of sight in the plan — **automate the counting, not the
choice**. `read_sightlines` gives the longest clear lines of sight, to be checked in game against
`mat_leafvis 3` to confirm the hint actually separated the two leaves.

## Areaportal, occluder, hint, `func_detail` — when to use which

| | Cost | Cuts | Constraint |
|---|---|---|---|
| `func_areaportal` | compile time, ~zero in game | everything (brushes, props, entities) | must seal an opening airtight, one brush only |
| `func_occluder` | **runtime, per frame and per model tested** | props only | no sealing constraint |
| Hint brush | compile time only | a visleaf cut across the geometry | angle above 180° in a corner, otherwise useless |
| `func_detail` | ~zero, ignored by `vvis` | nothing — never cuts | never seals, never replaces a load-bearing wall |

- Door, window, clean separation between two played areas → **areaportal**, the best
  effort-to-gain ratio in an interior map.
- Isolated prop or open volume where an areaportal does not apply → **occluder**, as a last resort
  and sparingly.
- Corridor corner, a purely geometric cut with no opening → **hint**.
- Furniture, ornament, anything that must not affect structure → **`func_detail`**.

## Areaportal

A single brush, no displacement, entirely surrounded by world brush on both sides — each area it
closes must be airtight to the grain: a 0.1-unit gap between two brushes is enough to leak it into
a neighbouring leaf. `[engine]`

⚠️ **An areaportal cannot cross a water surface.** Two are needed, one on each side of the water
plane. `[engine]`

Always open (`Initial State: Open`) at the end of a corridor into a large area, tied to a door
otherwise. `MAX_MAP_AREAS` = 256, `MAX_MAP_AREAPORTALS` = 1024 — compile limits, not design
budgets. `[engine, src/public/bspfile.h]`

A badly sealed areaportal breaks the compile with `Brush <n>: areaportal brush doesn't touch two
areas` — full catalogue of compiler messages: `references/compiling.md`.

## `func_occluder`

Computes its occlusion **at runtime**, unlike the precomputed areaportal. Every frame the engine
traces a line to each model on screen to find out whether it is hidden — a cost that grows with the
number of models tested, independent of their complexity. A badly placed occluder costs **more than
no occluder at all**. `[engine]`

To check it pays: `net_graph 1` or `+showbudget` in game, compared against
`ent_fire func_occluder toggle`. A per-subsystem budget breakdown lives in
`references/performance.md`, not here.

## `func_viscluster`

Forces `vvis` to treat every leaf it covers as mutually visible — cuts VIS compile time at the cost
of less precise runtime culling and a potentially longer VRAD. Must cover at least ~10% of a leaf's
volume to act; must never cross water or an areaportal, on pain of breaking underwater reflections.
`[engine]`

⚠️ **Not advised if the game runs VVIS++.** VVIS++ already handles large open areas without the
exponential blow-up in compute time; a viscluster there degrades runtime optimisation without
speeding up the compile. Check the toolchain in use (`stock` vs `plusplus`) before placing one —
detail in `references/compiling.md`.

## 2D skybox and 3D skybox

The **2D skybox** is a static image on the six faces of an infinite cube, seen through any face
textured `tools/toolsskybox`. The **3D skybox** is an area built at small scale outside the
playable bounds, scaled up by the engine and rendered behind normal geometry — never a replacement
for the 2D skybox, always drawn in front of it. `[engine]`

Default scale **1/16**, **1/32** on Left 4 Dead. `[engine]`

⚠️ **One `sky_camera` in the entire map**, and it lives in the 3D skybox. A second one in the main
world blocks nav mesh generation across the whole map. `[engine]`

3D skybox geometry is **neither occluded nor culled** like the rest of the map — too much detail or
translucency in there costs, and no hint or areaportal can help. `[engine]`

## Leak

**A map must be sealed without a gap, the sky included.** Any leak into the void stops `vvis` from
running: no `.prt` (portal file), a `.lin` (pointfile) instead. The classic causes: a wall left as
`func_detail` instead of world, a displacement with no nodraw brush behind it, a badly sealed
areaportal, or a map with no entity at all (the compiler then has no inside/outside reference
point). `[engine]`

A leak invalidates everything after it in the chain: `vrad` works badly or direct-only, and the map
is generally unplayable. `read_leak` turns the raw pointfile into a named entity with its position —
the compilers themselves only give a coordinate trace. `run_compile` stops at the offending stage
rather than continuing on a leaking map.

## Measuring and diagnosing

| Question | Tool |
|---|---|
| The structural/detail ratio | `read_map_geometry` (hammer-mcp) |
| Leaf and cluster counts, leaf volume distribution | `read_visleaf_stats` (hammer-mcp) |
| The longest clear lines of sight | `read_sightlines` (hammer-mcp) |
| The VMF before compiling — misoriented hints, an open areaportal | `read_vmf_lint` (hammer-mcp) |
| Where and why a compile leaked | `read_leak`, `read_compile_log` (hammer-mcp) |
| The player's leaf/area/cluster, in game | `mat_leafvis 1/2/3` in the **client** console (gmod-mcp) |
| The PVS actually rendered from a frozen point | `r_lockpvs 1`, compared to `r_novis 1` (gmod-mcp) |
| The runtime cost of an occluder | `net_graph 1` / `+showbudget` (gmod-mcp) |
| Where to put a hint or an areaportal | human judgement, not tooled |

⚠️ `mat_leafvis`, `r_lockpvs` and `r_novis` are **client** render cvars. A dedicated server has no
renderer, so sending them server-side does nothing whatever `sv_cheats` says.
