# Building a map from nothing

Every other page here is about a map that already exists. This one is the order to do things
in when there is no file yet, and it is written from two real builds of the same brief rather
than from what the tool list suggests — 53 calls the first time, 51 the second, and the
account of both is in
[`docs/dogfood/2026-08-13-bodega/`](https://github.com/ProjectSocietyStudio/hammer-mcp/tree/main/docs/dogfood/2026-08-13-bodega).

Read it before starting a map. Most of what follows is a place where the obvious order costs
an hour.

## Write the brief first, and write it twice

In prose, and as `<map>.rules.json` beside the `.vmf`. The second is what `check_vmf_rules`
reads, and writing it is itself a test: the schema admits five measurements —
`circulation_width`, `clearance_in_front`, `headroom`, `sightline`, `room_area` — and any
sentence of the brief that has no form among them is something you will not be able to check.
Better to know that before building than after.

A rule with neither `min` nor `max`, or a sightline missing an end, is refused at load. That is
deliberate: such a rule reads as enforcement and is not.

## The order

| # | Do | With |
|---|---|---|
| 1 | Create the file | `write_vmf` — nothing else can. `write_vmf_solid` reads its target first and refuses a file with no `world` block, so an absent or empty file is not a starting point |
| 2 | Build the shell: floor, ceiling, four walls | `write_vmf_solid` |
| 3 | **Check it seals, now** | `read_vmf_leak` — seconds, no compiler. Do not wait for the compile |
| 4 | Cut the openings, add the divider | `clip_solids`, or three brushes around the gap |
| 5 | Place the spawn and the named markers | `edit_vmf` |
| 6 | Ask what the map *is* | `read_vmf_rooms` — and read `merges`, see below |
| 7 | Judge it against the brief | `check_vmf_rules` — read `overall`, not `errorCount` |
| 8 | Furniture, materials, lights | `write_vmf_solid`, `set_face_material`, `set_solid_class` |
| 9 | **Finish it** | `write_vmf_fitting` — casings, counters, skirting. See below; skipping this is what made three maps in a row look unbuilt |
| 10 | **Look at it** | `render_vmf_tour` — one call, the whole place at eye height |
| 11 | Compile | `read_vmf_lint`, then `run_compile` with `fast: true` |
| 12 | Cross-check the seal | `read_leak` on the `.bsp` — two independent answers to one question |

Steps 3, 6 and 7 are cheap and they are the whole point of doing this offline. Run them after
every structural change, not at the end.

## Done is three greens and a look

1. `read_vmf_leak` — `sealed: true`.
2. `check_vmf_rules` — `overall: "pass"`. **Not `errorCount: 0`**, which is also what you get
   when a rule matched nothing and when there is no rules file at all. `overall` is `skipped`
   in both of those, never `pass`.
3. `run_compile` — every stage exits 0.
4. **`render_vmf_tour`, and say what you see.** In writing, before you conclude. Name what is
   in each frame and what is missing from it.

Then `read_leak` on the result. A `.bsp` and no pointfile is the compiler agreeing with
`read_vmf_leak`, by an entirely different method.

### Why the fourth one is not optional

Three builders reached the first three greens on this brief. All three maps were sealed,
satisfied every rule, and compiled clean. Loaded in game, the third one had **a door painted
flat on a wall** — no frame, no reveal, no lintel — counters and shelving that were each a
single box, and not one skirting board in any shot. The diagnosis took one look at three
screenshots and no tool calls at all.

`render_vmf_view` had existed the whole time. Across those three sessions, **145 tool calls
between them, it was called once.** Nothing in the loop asked anybody to look, so nobody
looked, and every report said the map was finished.

A count of greens cannot see proportion, articulation or absence. You can. Use the eye you
have.

## The traps, each of which cost real time

### The room pass segments at one cell size, and not the default

This is the big one. It cost roughly two thirds of both builds.

`read_vmf_rooms` and `check_vmf_rules` split space by a watershed on a voxel grid, and **the
answer depends on the cell size in a way that is not monotone**. Measured on a shop of two
256×224 rooms joined by a 64-wide doorway:

| `step` | rooms | portals |
|---|---|---|
| 8 | 1 | 0 |
| 16 (the default) | 1 | 0 |
| **32** | **2** | **1** |
| 64 | 1 | 0 |

One working value, with failing neighbours on both sides. Neither "finer" nor "coarser"
converges, and `step`'s own description — *"16 is the coarsest that resolves a 32-unit
doorway"* — points the wrong way.

**So: when a portal rule matches nothing, read the note first, then vary `step`.** The note
now says whether a merge closed an opening and where — that is the geometry answer, and it is
the one that was missing when a third builder spent five `step` calls on advice that is right
often enough to be on this page and was wrong that time. If no merge closed anything, try 32,
and bound that search: three or four values giving the same answer means it is **not** a
resolution problem.
`check_vmf_rules` now reports the `segmentation` it used and says so in a note, and both tools
take `minRoomArea` so a diagnosis and the verdict it explains can be run at the same settings.
Open as [#53](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/53); one builder
rebuilt its divider three times and moved its shelving twice before finding that none of it
was the problem.

### Read `merges`, not just the room count

`read_vmf_rooms` returns every merge it made with the comparison that decided it —
*"the opening between them is 32 units where the narrower of the two spaces is 32, so it
narrows nothing"* — and the cell it happened at. A room count that surprises you is a merge
you have not looked at. Before this existed, one builder called `read_vmf_rooms` **nine times
with byte-identical arguments**: the same question, because the answer never said why.

### Furniture placement is constrained by the algorithm, not only by the design

A block standing in the middle of a room splits that room around itself — the watershed doing
exactly what it is for, on a pillar you did not think of as a pillar. Put shelving flush to a
wall and run a counter to the end of its wall unless you mean to divide the space.

⚠️ **Flush to a wall is not enough, and this page said it was.** A third builder followed that
instruction exactly and still lost a doorway: three shelf runs, all against walls, none near
the divider, turned `rooms: 2, portals: 1` into `rooms: 1, portals: 0`. The culprit was
**depth**, not position — a run 48 units deep collapsed the segmentation where the same run at
32 did not, from about 200 units away from the doorway that disappeared.

So the rule to build is: **furniture deep enough to matter narrows the room it stands in**, and
the room pass reads that narrowing as the map's real shape. If a portal disappears after a
furniture change, suspect the furniture's *depth* before anything else — and note that the
`step` sweep will not find it, because it is not a resolution problem.

**`read_vmf_rooms` now reports the portal that stopped existing.** Every merge across a
boundary carries `closed`: the width and position of the opening it swallowed, measured at the
widest cell of that boundary. When no portal is reported at all and a merge closed one, both
`read_vmf_rooms` and `check_vmf_rules` say so in a note, with the widest one's position —
so the first move after a doorway goes quiet is to read that, not to sweep `step`. Bisection
by deleting brushes is no longer the only way.

A standable surface above the floor — a counter top, a ledge — is no longer reported as a room:
it comes back under `unreachable`, because no walk of one cell reaches it. You no longer have
to make furniture 80 units tall to hide it from the room pass.

### Measure at body height, not at floor height

`measure_vmf_clearance` sweeps a player hull centred on the point you give. Give it a point on
the floor and the hull is buried in the floor. It now says `hullFits: false` and offers the
point that would have worked, rather than returning the hull's own width as if it were a
measurement — but the habit to build is *measure where a person's middle would be*.

`check_vmf_rules` says the same thing now, and it did not use to: a `circulation_width` or
`clearance_in_front` violation whose hull did not fit reports `measured: null` and
`evidence.startsInside` naming the brush, instead of the bare `0` that cost a builder its first
hypothesis. When the hull *does* fit, `evidence` still carries `facing` and `yawDegrees` — so a
marker that measures 0 because it faces the wrong way is distinguishable from one standing in a
counter. A subject with no `angles` of its own is swept along +x, and the violation says so.

### Sightlines are traced at eye height

Both ends are lifted by `eyeHeight` (64 by default, Source's own) before the trace. A rule
between two markers at z 48 traces at z 112, so a lintel at 112 blocks a line that looks clear
at floor level. The height is in every violation's message and it is an argument.

### Read a doorway's `widthUnits`, never its `approxWidthUnits`

The voxel ruler loses up to a cell against each surface, on purpose — a cell counts as free
only when its whole interior is, and losing space against a wall is safer than gaining it
through one. Measured: a doorway **built 80 wide reports 64** at step 16, so a rule asking for
64 could fail a doorway built at exactly 64 and pass one built at 80.

**Each portal now carries both numbers.** `approxWidthUnits` is the cell count — a multiple of
`step`, rounded down, and the number the segmentation itself used. `widthUnits` beside it is a
swept player hull at the same col, exact to a thirty-second of a unit: a doorway built 100
wide reports `approxWidthUnits: 96` and `widthUnits: 100`. `render_vmf_plan` labels the
measured one. Judge a doorway on `widthUnits`; `null` there means no body fits at the col at
all, which is a finding of its own.

What that does **not** fix is *where* the col is. The grid localises it to within a cell, so a
verdict within one cell of its bar can still flip at another `step` — `check_vmf_rules` now
says so in a note when a room or doorway lands that close, pass or fail
([#61](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/61)).

### Build to Source's scale, which is not the real world's

Measured on 13/08/2026 with `read_model_info`, on three unrelated models Valve ships:

| Model | Real | Measured | Ratio |
|---|---|---|---|
| `props_interiors/furniture_desk01a` | 30 in desk | 39.601 | 1.320 |
| `props_doors/door01_dynamic` | 80 in door leaf | 108.000 | 1.350 |
| `props_interiors/vendingmachinesoda01a` | 72 in machine | 96.578 | 1.341 |

**Heights are built at four thirds of real.** The player hull is 72 units for a six-foot
body — **one to one**. So Valve's architecture stands a third taller than the player it is
built around, and a room built to honest real-world heights reads as a crawlspace through a
Source camera. That is what a 176-unit ceiling did to this brief.

**The factor does not hold in plan.** Four casework models come back at real-world inches for
depth (sink 23.877, cabinets 23.220 and 21.110, fridge 33.828). A counter is 24 deep and 56
tall, and neither is a compromise.

Numbers worth knowing without looking them up: **door leaf 48 × 108** (both models agree,
and 48 wide is what a 32-wide player needs), **shop counter 56 tall**, kitchen run 48,
**shelving 19 deep**. The whole table, with each number's provenance, is
`src/vmf/fittings/dimensions.ts`.

### Finish with fittings, not with boxes

`write_vmf_solid` makes **one convex shape per call**. So an agent that thinks "counter"
writes a box — which is exactly what happened three times running. Detail in Source lives
between 4 and 16 units: a worktop with a nosing, a body, a recessed kick.

`write_vmf_fitting` takes the same `mins`/`maxs` you would have given a box and articulates
it. **You own the envelope, it owns the articulation** — every internal dimension comes from
the measured table, and those are precisely the numbers there is no way to know.

| Fitting | What you get |
|---|---|
| `door_frame` | jambs, head, on both wall faces, around a hole you already cut. Optional threshold |
| `counter` | worktop oversailing the body, over a kick set back on the side you name |
| `skirting` | a run round the inside of a room, or a cornice at its ceiling. `omit` the walls with doorways in them |

Two things it refuses, both of which pass every per-brush check: parts that share an interior,
and parts that fail to join up into the number of pieces the fitting says it should be.

⚠️ **A doorway is a hole plus a frame.** Cutting the hole is `clip_solids` or three brushes;
the frame is a separate step and it is the one everybody skips. A bare rectangular hole with
sharp arrises is the single clearest tell that a map was left unfinished.

### Materials, per brush or per role

`write_vmf_solid` takes a single `material` for every face, or `materials: {top, bottom, sides}`
for the case a single string cannot say — a floor whose top is tile and whose sides are nodraw.
The roles are the ones `set_face_material`'s `facing` selects, at the same threshold. Anything
finer than that still wants `set_face_material` afterwards.

### The spawn is what the flood starts from

No `info_player_start` means no seed, which means every room rule reports that it checked
nothing — and `overall` is `skipped`, not `pass`. Place it early. Its origin is lifted 16 units
to find the air above the floor it rests on, and the tools say so.

## What is worth doing even though nothing enforces it

- **`read_vmf_solids` after a batch of writes.** `write_vmf_solid` already refuses a solid that
  does not close, but a `clip_solids` or a `move_vertices` on top of it is where an invalid
  brush comes from.
- **`render_vmf_plan` once the rooms are right.** A dimensioned floor plan read by a person
  catches what no rule was written for. `render_vmf_view` does the same from a camera.
- **`validate_io` before shipping anything with entity wiring.** An output into a name nothing
  has is silent everywhere else.
