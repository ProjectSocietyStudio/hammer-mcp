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
| 9 | Compile | `read_vmf_lint`, then `run_compile` with `fast: true` |
| 10 | Cross-check the seal | `read_leak` on the `.bsp` — two independent answers to one question |

Steps 3, 6 and 7 are cheap and they are the whole point of doing this offline. Run them after
every structural change, not at the end.

## Done is three greens

1. `read_vmf_leak` — `sealed: true`.
2. `check_vmf_rules` — `overall: "pass"`. **Not `errorCount: 0`**, which is also what you get
   when a rule matched nothing and when there is no rules file at all. `overall` is `skipped`
   in both of those, never `pass`.
3. `run_compile` — every stage exits 0.

Then `read_leak` on the result. A `.bsp` and no pointfile is the compiler agreeing with
`read_vmf_leak`, by an entirely different method.

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

**So: when a portal rule matches nothing, vary `step` before touching the geometry.** Try 32.
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

A standable surface above the floor — a counter top, a ledge — is no longer reported as a room:
it comes back under `unreachable`, because no walk of one cell reaches it. You no longer have
to make furniture 80 units tall to hide it from the room pass.

### Measure at body height, not at floor height

`measure_vmf_clearance` sweeps a player hull centred on the point you give. Give it a point on
the floor and the hull is buried in the floor. It now says `hullFits: false` and offers the
point that would have worked, rather than returning the hull's own width as if it were a
measurement — but the habit to build is *measure where a person's middle would be*.

### Sightlines are traced at eye height

Both ends are lifted by `eyeHeight` (64 by default, Source's own) before the trace. A rule
between two markers at z 48 traces at z 112, so a lintel at 112 blocks a line that looks clear
at floor level. The height is in every violation's message and it is an argument.

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
