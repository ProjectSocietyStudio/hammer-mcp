# Optimising visibility

Source only draws what the player can see, and "can see" is decided at compile time. All
optimisation consists of helping vvis conclude that two places cannot see each other.

## Structural versus `func_detail`

The most profitable split, and the only genuinely human judgement on this page.

- **Structural**: what forms the skeleton — the walls that separate, floors, ceiling, the box that
  seals. vvis cuts the world along it.
- **`func_detail`**: everything else — mouldings, posts, stairs, brush-built furniture. Merged back
  into the world as `CONTENTS_DETAIL`, **invisible to vvis**, cutting nothing.

Rule: *if removing it does not open a line of sight between two rooms, it is detail.*

⚠️ **A `func_detail` does not seal.** A map with an exterior wall marked as detail leaks. And no
static check can rule that out, because sealing is a property of the whole hull: on the probe map,
a sealed box, all six brushes are load-bearing including the floor.

`set_solid_class` flips a brush between the two and reports the visibility effect. Measured on one
pillar in the probe room:

| | leaves | clusters | VISIBILITY |
|---|---|---|---|
| empty room | 29 | 4 | 44 B |
| pillar, structural | 33 | 7 | 74 B |
| pillar, `func_detail` | 29 | 4 | 44 B |

Read that narrowly: **vvis no longer sees the pillar, which is not the same as the pillar costing
nothing.** It is still drawn, still counts in `FACES`, still costs its lightmap. `read_map_report`
answers the wider question.

`read_map_geometry` gives the ratio; it does not say which wall is which.

## Hints and skip

A brush textured `toolshint` on one face and `toolsskip` on the others forces a visleaf cut where
you want one. It is the tool for the L-shaped corridor: without a hint, vvis cuts badly and the two
branches see each other.

A diagonal hint is not an axial hint rotated. Measured on the same room, stock compilers:

| | leaves | clusters | VISIBILITY |
|---|---|---|---|
| no hint | 29 | 4 | 44 B |
| axial hint | 33 | 8 | 84 B |
| 45° hint | 35 | 10 | 124 B |

Placement depends on the real lines of sight — **automate the counting, not the choice**.

## Areaportals and occluders

Two mechanisms that are often confused:

| | `func_areaportal` | `func_occluder` |
|---|---|---|
| When | at compile time, actually cuts visleaves | at runtime |
| What it hides | everything | **props only** |
| Constraint | must seal an opening airtight | none |

An areaportal in a doorway, tied to the door, is the best effort-to-gain ratio in an interior map.
Badly sealed, it fails the compile.

## Props

`read_prop_survey` lists the `prop_dynamic` that have no name, no parent, no animation and no
output: those are dynamic for nothing. Each is a real server entity ticking every frame and counted
by every `ents.GetAll()` sweep, where a `prop_static` costs nothing.

**But converting requires a recompile**, and a model without static support cannot be converted at
all. The list is a starting point, not a verdict — the tool says so itself.

On `rp_nycity_day`: 59 `prop_dynamic`, of which **17 candidates**. The other 42 are parented, named
or animated.

## Measuring

Offline: `read_map_geometry` (counts, headroom before the ceilings), `read_sightlines` (the longest
clear lines of sight), `read_visleaf_stats` (leaf and cluster counts, leaf volume distribution).

In game, and therefore through `gmod-mcp`: `mat_leafvis`, `+showbudget`, `cl_showfps 2`,
`r_speeds`, `vprof_generate_report`. All of those outputs are parsable text — but they need a
running server, shared, which is not restarted on your own initiative.

⚠️ `mat_leafvis` and `mat_wireframe` are **client** render cvars. A dedicated server has no
renderer, so sending them server-side does nothing whatever `sv_cheats` says. The working sequence
is `sv_cheats` on the server, which replicates, then the render cvar in the **client** console.
