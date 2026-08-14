# `hmcp_tenement` — the brief

A two-storey tenement built round a light well. You come in off the street into a hall, a stair
in the north wing takes you up, and both floors look down into a courtyard open to the sky.

Round 5 gave these tools a **dehors**. This one gives them a **second storey**, and with it the
first map here that has to be *optimised* rather than merely built.

## Why this subject and not another

Thirty-four of the seventy-four tools have never been called once, and the largest cluster is
the one `source-mapping` names as the first of the three things that decide a map:

| Cluster | Never called until this round |
|---|---|
| **visibility** | `write_hint_brush`, `write_portal`, `read_visleaf_stats`, `set_visgroup`, `read_map_organisation`, `set_cordon` |
| **lighting budget** | `read_lightmap_budget`, `set_lightmap_scale`, `set_smoothing_groups` |
| **shipping** | `read_map_report`, `read_compile_log`, `read_materials` |
| **measuring** | `measure_vmf_approach`, `read_vmf_sightlines`, `read_vmf_surfaces`, `read_entity_report` |

And a finding is already sitting in the last map. `hmcp_backyard` has 71 brushes, of which some
twenty-five are door casings, skirting, a counter and window reveals — **every one of them
structural**. Each splits the BSP tree and spawns visleaves for nothing. The single largest lever
Source gives a mapper is not pulled once in any map these tools have built, and nothing in the
toolkit ever mentioned it.

## What is new, beyond size

- **Two storeys.** The room pass has only ever seen one floor. A slab with a stairwell through
  it asks whether a watershed on a 3D voxel grid separates floors at all, and whether a portal
  between them is a thing it can name.
- **A stair.** `write_vmf_solid`'s `stairs` shape has never been used. Twenty steps of 8 is
  Source's own tread, and whether the room pass walks it is a real question — its neighbours
  step one cell, which at 16 is under Source's 18.
- **A light well.** One volume open from the ground to the sky through two floor slabs and a
  roof. Both storeys see into it and therefore into each other, which is exactly the case
  areaportals and hints exist for.
- **Optimisation as work, not decoration.** Every visibility change is measured: compile,
  `read_visleaf_stats`, change one thing, compile again. A hint that moves no leaf count did
  nothing, and the tool says so itself.

## What must be true

The machine-readable half is [`hmcp_tenement.rules.json`](hmcp_tenement.rules.json), a sibling
of the `.vmf`.

- **Both storeys have at least 112 units of clear headroom**, everywhere a person can stand.
- **Every doorway is at least 64 units wide.**
- **Every habitable room has at least 24 000 square units of floor.**
- **There is 48 units of clear floor at the foot of the stair.** You have to be able to stand
  there before you climb.
- **From the upstairs landing, the courtyard is visible.** That is what the light well is for.
- **From the entrance hall, the upstairs landing is not visible.** A tenement's stair does not
  put the street in the bedrooms.

## What cannot be checked, and is required anyway

Carried forward as its own finding, because the protocol says a requirement with no checkable
form is one:

1. **The stair is climbable.** No rule reaches Source's 18-unit step; the room pass's own
   one-cell neighbourhood is the closest thing and it is a segmentation parameter, not a check.
2. **The visibility split is good.** `read_visleaf_stats` counts leaves and clusters. Whether
   the split is *right* is a judgement — this round's job is to make the counting honest, not
   to automate the judgement.
3. **The light well lights anything.** VRAD decides that, and only a compile with lighting and
   an eye can say.

## What must be built, and not just measured

- **Nothing a person touches is a single brush**, and every doorway has a frame. Carried from
  round 4, unchanged, and now with a stair to add to the list.
- **The trim is `func_detail`.** This is the round's central instruction. A door casing that
  splits the BSP tree is a bug in the map, not a style. `set_solid_class` moves it, and the
  cost of not doing it is measured here for the first time.
- **⚠️ A `func_detail` brush does not seal.** Move a wall into one and the next compile leaks.
  `read_vmf_leak` after every reclassification, not at the end.
- **Materials from the game's own content**, and this time **resolved**: `read_game_content`
  with `details` now reports whether a material's textures exist, which is #77 and which round
  5 met as a purple checkerboard waiting to ship.
- **Build to Source's scale.** Door leaf 48 × 108, stair tread 8 × 12, storey height generous:
  a tenement with 112 units of headroom reads as a basement on both floors.

## What is left open

The footprint, the wall thickness, where the rooms divide, which materials, how the stair turns,
what is in the courtyard, and every visibility decision — where a hint goes and which doorway
gets an areaportal is exactly the judgement no tool makes.

## What the map must name

| `targetname` | What it marks |
|---|---|
| `hall` | inside the ground-floor entrance hall |
| `landing` | the first-floor landing at the head of the stair |
| `courtyard` | the middle of the light well |
| `stair_foot` | the bottom step, with `angles` — clearance is measured along its yaw |

Plus an `info_player_start` in the hall: the room pass floods from spawn entities, and without
one every room rule reports that it checked nothing.

## Done

1. `read_vmf_leak` — `sealed: true`, and again after every `func_detail` move.
2. `check_vmf_rules` — `overall: "pass"`, nothing in `matchedNothing`.
3. `run_compile` — vbsp, vvis and vrad without an error.
4. `read_leak` on the `.bsp`.
5. **`read_visleaf_stats` before and after each visibility change**, with the numbers written
   down. This is new, and it is the round's real deliverable: the first measured account of
   what `func_detail`, a hint and an areaportal are worth on a map these tools built.
6. **`render_vmf_plan` and `render_vmf_tour`, and write down what you see**, frame by frame,
   before concluding.

In game is out of scope, as in round 5: `srcds` is shared and no client is running. Every
measurement above is offline, including all of item 5 — `read_visleaf_stats` reads the `.bsp`.
