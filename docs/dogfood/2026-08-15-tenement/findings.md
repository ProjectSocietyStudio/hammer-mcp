# `hmcp_tenement` — what building two storeys was like

Round 6, 15/08/2026. A two-storey tenement round a light well, with a stair between the floors —
the first map here that had to be **optimised** rather than merely built.

Round 5 gave these tools a dehors. This one gives them **verticality**, and with it the visibility
cluster: `write_hint_brush`, `write_portal`, `read_visleaf_stats`, `read_map_report` and
`read_lightmap_budget` had never been called once, in any round, on any map.

## What it cost

| | R1 | R2 | R3 | R5 | **R6** |
|---|---|---|---|---|---|
| subject | bodega | bodega | bodega | house + garden | **tenement, two storeys** |
| MCP calls | 53 | 51 | 41 | 89 | **47** |
| logged failures | 2 | 1 | 0 | 0 | **0** |
| hand-edits forced | 1 | 0 | 0 | 0 | **0** |
| brushes · entities | 18 · 8 | 14 · 8 | 16 · 8 | 71 · 11 | **101 · 16** |
| compiles run | 1 | 1 | 1 | 4 | **8** |

Third round with no failed call. Eight compiles because the round's deliverable *is* the
before/after: every visibility change was compiled and measured rather than asserted.

---

## The measurement this round exists for

Four states of the same map, same geometry, same 101 brushes. Only the structural/detail split
changes.

| state | leaves | clusters | visdata | avg clusters visible | median leaf volume |
|---|---|---|---|---|---|
| stair structural, no trim | 122 | 46 | 927 B | 38 | 442 368 |
| **stair → `func_detail`** | **74** | **23** | **327 B** | **16** | **884 736** |
| trim added, structural | 188 | 83 | 2 459 B | 41 | 89 088 |
| **trim → `func_detail`** | **73** | **23** | **327 B** | **16** | **884 736** |

Read it twice, because it says two different things.

**Sixteen stair brushes — a quarter of the map — produced 39 % of its leaves.** Moving them to
`func_detail` halved the cluster count, cut the visdata by 65 %, and doubled the median leaf
volume. One call.

**Thirty-seven brushes of trim — door casings and skirting — took the map from 74 leaves to 188,
and cut the median leaf volume by a factor of ten.** These are the exact fittings
`write_vmf_fitting` was built to produce, because three maps in a row looked unbuilt without them.
Nothing in that tool, in `building.md`, or in any round's brief had ever mentioned that they must
not be structural. `hmcp_backyard` shipped with all twenty-five of its own still in the world.

Moving them recovered **all** of it: 188 → 73.

That is the first measured statement in this repository of what the largest lever in Source
actually costs, and the number to carry is the second one: **finish work left structural is worth
more leaves than the building it decorates.**

## The areaportal, and what it does not do

Two `func_areaportal` in the ground-floor doorways, the only two links between the hall and the
ring. vbsp accepted them and `areas` went from 2 to **3**.

`read_visleaf_stats` was **byte-identical** before and after: 23 clusters, 29 portals, 327 B.

Correct, and worth stating because it is the trap: an areaportal is a *runtime* mechanism. It
changes nothing vvis computes and everything the engine does with the result. A round that
measured only `read_visleaf_stats` would have concluded the areaportals did nothing. The number
that moved is `areas` in the compile's own budget table, and no reader here surfaces it except
`read_map_report`'s lump fill.

`write_portal` warned correctly and unprompted about the failure mode that stops a compile —
*"an areaportal must fill its opening exactly"* — and the compile passed first time.

## The hint that made the map worse

A hint slab across the light well at floor level, to stop the two storeys seeing each other
through the shaft. Measured:

| | before | after the hint |
|---|---|---|
| clusters | 23 | **27** |
| portals | 29 | **33** |
| visdata | 327 B | **443 B** |
| avg clusters visible | 16 | **20** |

**Four clusters and 35 % more visdata, and nothing sees less.** A vertical shaft is transparent to
itself: cutting it horizontally makes more leaves that all still see one another. The hint was
removed.

`write_hint_brush` says this itself — *"a hint that changes neither the leaf count nor the cluster
count did nothing, and a hint that does nothing still costs a plane in the tree"*. The measured
case is worse than the one it warns about: this hint changed both counts, in the wrong direction.
Recorded because a negative result on the fussiest tool in the set is worth as much as a positive
one, and nothing in the toolkit or the skills carried one.

---

## The findings

### 1 · The walkable step is a function of `step`, not of the engine — **bug**

`STEP_CELLS = 1` in `src/space/rooms.ts`: a walk may climb **one cell**. The comment says *"at the
default 16-unit grid that is a 16-unit step, and Source lets a player climb 18 without jumping"* —
which is true at 16 and at no other value.

Measured on this map's stair, 16 treads of 10 rise on 16 run:

| `step` | what the room pass does with the stair |
|---|---|
| 16 | walks it: room 1 extends to z 72 |
| 8 | **fragments it into three unreachable slivers** at z 36–148 |

At `step: 8` the allowance is 8 units and a 10-unit rise stops the walk. At `step: 32` it would be
32, and a 30-unit ledge no player can climb would read as walkable.

So the segmentation parameter silently changes the *body model*. `step` is documented as a
resolution knob — "16 is the coarsest that resolves a 32-unit doorway" — and it is also, undocumented,
the definition of what a person can climb. The fix is one line: derive the allowance from Source's
18 and the cell size, rather than from the cell size alone.

### 2 · Portals are reported at points outside the rooms they join — **bug**

Every first-floor portal on this map names a ground-floor region:

```
portal [3,6] at [96, 176, 176]     room 3 bbox: z 8..24      room 6 bbox: z 168..184
portal [2,3] at [528, 176, 176]    room 2 bbox: z 8..24      room 3 bbox: z 8..24
portal [2,6] at [320, 416, 176]    room 2 bbox: z 8..24
```

A portal must lie in both regions it joins. `[3,6]` is reported 150 units above the top of room 3's
own bounding box, and `[2,3]` is reported at z 176 where **both** rooms top out at 24. The rooms'
own output refutes the portals' own output, in the same reply.

Same family as round 1's finding about `into` being mapped through a table that only holds
surviving regions: a region id space that is remapped for `rooms[]` and not for `portals[]`. It was
invisible while every map was one storey, because on one floor every id happens to line up.

**`render_vmf_plan` inherits it**: cut at z 64, a ground-floor height, it lists and dimensions
portals at z 176 and drops three room labels for overlapping — because it is drawing two storeys
on top of each other. Its own description calls it *"the drawing you can measure with"*.

### 3 · A portal's col can land inside solid geometry — **bug**

Before the stair was moved against the north wall, `check_vmf_rules` returned `fail`:

```
doorway 1-2: measured: null, at [432, 416, 36.531]
"the hull ... is already inside brush 401 (world)"
```

Brush 401 is the **top step of the staircase**. The segmentation put a boundary along the stair's
flank and reported the col inside it — a doorway that is not a doorway, at a point that is not
open, failing a rule on a map with no defect.

The #75 fix (sweep the hull to find the floor) is working here — it is the reason the message names
the brush — but it cannot help when the col itself is inside a solid. A portal whose col fails
`pointInSolid` is not a portal and should not be reported.

### 4 · `unreachable` does not answer the question it states, and ignores `seeds` — **bug**

The output says *"no walk reaches them from a spawn"*. On this map:

- the region containing the **middle of the stair** is `unreachable`, while the first floor above
  it — reachable only through it — is a `room`;
- passing `seeds: [[320, 480, 168]]`, a point on the first floor, returned a **byte-identical**
  result: same five rooms, same three unreachable regions, same portals.

Whatever the classification is computed from, it is not the seeds the caller passed, and it is not
consistent with the connectivity the same call reports. Related to §1 — a walk that cannot climb
the stair explains half of it — but not all: the first floor would then be unreachable too, and it
is not.

### 5 · `read_map_report` prints `null` where a byte-denominated lump's numerator goes — **bug**

```
lump-fill:LIGHTING   value: 0.006   message: "null of 16777216."
lump-fill:VISIBILITY value: 0       message: "null of 16777216."
```

The fraction is computed, so the numerator exists — vrad printed `LDR lightdata 108148` for the
same map. Three criteria are affected, and they are exactly the three lumps measured in bytes
rather than in records. A verdict whose evidence reads `null` is one the reader has to take on
faith, which is the opposite of this tool's stated purpose.

Everything else about that tool held up: 23 pass, 0 warn, 0 fail, and the one `skipped` is a model
of the repository's own rule — *"no profile here carries a calibrated threshold for this ... a
made-up threshold would return a confident verdict about nothing."*

### 6 · The tour cannot show a map with two storeys — **gap**

Nineteen views on a nine-frame sheet. Ten omitted, and the omitted list contains **duplicates** —
`DOOR 1-2 FROM 1` twice — because two distinct portals share one pair of room ids (§2), so a
reader cannot tell which is which or ask for one by name.

The first floor gets one frame in nine, and it is a bare wall: the camera stands 128 units from the
wall it faces. And **the light well appears in no frame at all** — every camera is horizontal at
eye height, so on a map whose whole subject is a vertical void, nothing looks up.

`skyFraction` (#78, fixed this session) reads 0 in all nine, correctly: no camera can see the sky
from inside, which is itself the observation.

---

## What the map is

Sealed. `overall: "pass"` at the default `step`, seven rules, nothing in `matchedNothing`.
vbsp/vvis/vrad all exit 0 on a full compile, no pointfile. `read_map_report`: 23 pass, 0 fail.

101 brushes — 46 structural, 53 in `func_detail`, two areaportals — 16 entities, 9 lights, 3 areas,
73 leaves, 23 clusters, 327 bytes of visibility, 16 216 luxels. Five rooms: hall 65.7 m², west and
north 59.8, east 46.3, light well 20.6, first floor 65.6.

## The findings, sorted

| | Class | Reachable from a one-storey map? |
|---|---|---|
| 1 · the walkable step scales with `step` | **bug** | no |
| 2 · portals reported outside the rooms they join | **bug** | no |
| 3 · a portal's col inside solid geometry | **bug** | no |
| 4 · `unreachable` ignores `seeds` and contradicts itself | **bug** | no |
| 5 · `read_map_report` prints `null` for byte lumps | **bug** | yes — never looked |
| 6 · the tour cannot show two storeys | **gap** | no |

Five of six need a second floor to appear at all. The sixth needed only for somebody to call the
tool, which in seventy-four tools and six rounds nobody had.
