# `hmcp_backyard` — the brief

A small house with a garden behind it. You stand in the living room; a doorway leads through to
the kitchen; a door in the kitchen's back wall opens onto a walled garden with the sky over it.

That is the whole map. There is no street, no upstairs, no neighbour. It is small on purpose —
small enough to build in one sitting — and it is deliberately **not** the bodega: three rounds
of that brief proved a sealed interior box, and everything this one adds is something those
three rounds never touched.

## Why this subject and not another

Four things, none of which a two-room interior can ask for:

- **a dehors.** The garden is open to the sky, so the map is sealed by a `toolsskybox` shell
  rather than by a ceiling. Sealing an exterior is a different problem, and it has its own
  known trap ([#62](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/62)).
- **a door that opens.** Not a hole: a `prop_door_rotating`. The first entity in any of these
  maps that does something, and therefore the first use of `read_fgd_class` and `validate_io`.
- **terrain.** The garden's ground is a displacement — four tools (`write_displacement`,
  `sculpt_displacement`, `paint_displacement`, `sew_displacements`) that no dogfood round has
  ever called, and a trap the tool announces itself: *a displacement does not seal*.
- **an outside to the building.** A façade, a roof, a window, a step down into the garden.
  `write_vmf_fitting` builds a door casing, a counter and skirting, and nothing else. Whatever
  is missing will be missing loudly.

## What must be true

Each of these is checkable, and the machine-readable half is
[`hmcp_backyard.rules.json`](hmcp_backyard.rules.json), a sibling of the `.vmf`.

- **Two rooms indoors, one doorway between them**, plus the garden.
- **Every doorway is at least 64 units wide.** Two people meeting at one should not take turns.
- **Ceilings are at least 112 units clear** wherever a person can stand.
- **There is 48 units of clear floor in front of the sink.** Somebody stands there to use it.
- **From the garden door, the garden is visible.** That is what the door is for.
- **From the sofa, the garden is not.** The living room looks at the street side; you go through
  the kitchen to reach the garden, and that is what makes the garden feel behind the house.
- **Every room, garden included, has at least 24 000 square units of floor.**

## What cannot be checked, and is required anyway

Three sentences of this brief have no form in the rules schema. They are written here on
purpose — the protocol says that a requirement with no checkable form is itself a finding, and
these are this round's first three.

1. **The garden is open to the sky.** No check reads a `toolsskybox` face.
2. **With the door shut, the garden is not visible from the kitchen.** The tracer sees neither
   props nor brush entities, so a closed door reads as an open hole. The rules can only ever
   describe the map with every door removed.
3. **The house is watertight seen from outside.** `read_vmf_leak` answers it, and no rule can.

## What must be built, and not just measured

Carried over from `brief-round-4.md`, because it is the part that stops a map looking unbuilt,
and extended for the things a dehors adds.

- **Nothing a person touches is a single brush.** The kitchen counter is a worktop over a body
  over a recessed kick — `write_vmf_fitting` supplies every internal dimension.
- **Every doorway has a frame**, inside and out. A rectangular hole with sharp arrises is not a
  doorway, it is an absence.
- **Both rooms have skirting.** `omit` the walls that openings are in.
- **The house has an outside.** Seen from the garden it needs a façade material that is not its
  interior one, a roof that is not a flat slab, and a window that is glazed rather than open.
- **Build to Source's scale, not the real world's.** Heights are four thirds of real, the player
  is one to one. Door leaf 48 × 108, counter 56 tall, casework 24 deep. The table with each
  number's provenance is `src/vmf/fittings/dimensions.ts`; do not invent a height that is in it.
- **Materials from Garry's Mod's own content**, browsed with `read_game_content`. Three walls of
  `DEV/DEV_MEASURE` is a map that was never finished.

## What is left open

Deliberately. A brief that fixes every coordinate measures typing, not tooling.

The footprint, the wall thickness, where the counter and the sofa go, which materials, how the
roof is shaped, how rough the garden's ground is, and whether the garden has anything in it
beyond ground and walls.

## What the map must name

| `targetname` | What it marks |
|---|---|
| `garden_door` | the doorway from the kitchen out to the garden |
| `garden` | a point in the middle of the garden, away from the door |
| `sink` | the kitchen sink, with `angles` — clearance is measured along its yaw |
| `sofa` | where somebody sits in the living room |

Plus an `info_player_start`: the room pass floods from spawn entities, and without one every
room rule reports that it checked nothing — `overall: "skipped"`, never `pass`.

## Done

1. `read_vmf_leak` — `sealed: true`, without a compiler.
2. `check_vmf_rules` — `overall: "pass"`, and nothing in `matchedNothing`.
3. `run_compile` with `fast: true` — vbsp, vvis and vrad without an error.
4. `read_leak` on the `.bsp` — the same question answered by a different method.
5. **`render_vmf_plan`, then `render_vmf_tour`, and write down what you see**, frame by frame,
   before concluding. What is in it and what is missing from it. This is the only step that can
   see a door painted flat on a wall, and three rounds of three greens did not see one.

In game is out of scope for this round: `srcds` is shared with other sessions.
