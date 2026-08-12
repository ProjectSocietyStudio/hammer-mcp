# Measuring a map that has not been compiled

Every spatial question this server could answer used to go through `src/bsp/trace.ts`. That
is a good tracer — it is the engine's own recursion over vbsp's own tree — and it can only
speak about the map **as it was when vbsp last ran**. An agent that has just moved a wall
cannot ask whether the corridor still fits without compiling, and a compile takes minutes.
So it does not ask, and it places by feel.

`src/space/` is the other half: a collision engine over the brushes of a `.vmf`. It needs no
compilation, no lump format and no toolchain, because a brush *is already* an intersection
of half-spaces — `src/vmf/solid.ts` reconstructs exactly that as its oracle.

## The rule that keeps the oracle honest

**Nothing under `src/space/` may import `src/bsp/`.**

The BSP tracer is this engine's independent witness: the same 5 000 rays go through both,
one reading text and one reading three lumps, written from different sources. The moment one
calls the other they stop being independent and the cross-check becomes decorative — while
still passing, which is the part that matters. `test/space.test.ts` walks the import graph
and fails if the edge ever appears.

## What a brush blocks

Source decides a brush's contents from `%compile*` flags in the material's `.vmt`, inside the
game's VPKs. Reading them is possible — `read_game_content` does — and it would make every
spatial question depend on a mounted game, which the tests would then have to skip. So the
classification is **by name**, from the tool textures Valve ships, and every tool reports what
it excluded rather than staying quiet about it.

| Mask | Includes | Excludes |
|---|---|---|
| `solid` | the world as vbsp builds it | clip brushes, triggers, hints, areaportals |
| `player` | the above **and** every clip brush | `block_los`, which people walk through |
| `sight` | the above **less** clip brushes, which you see through | same |

Three groups decide it, and the first match wins, exactly as one clip face makes the whole
brush a clip brush for vbsp:

- **Stops nothing**: `TOOLSTRIGGER`, `TOOLSSKIP`, `TOOLSHINT`, `TOOLSAREAPORTAL`,
  `TOOLSOCCLUDER`, `TOOLSBLOCKLIGHT`, `TOOLSCLIPLIGHT`, `TOOLSFOG` — and the classes
  `trigger_*`, `func_illusionary`, `func_ladder`, `func_occluder`, `func_areaportal*`,
  `func_dustcloud`, `func_smokevolume`, `func_precipitation`, `func_viscluster`.
- **Stops people only**: `TOOLSCLIP`, `TOOLSPLAYERCLIP`, `TOOLSNPCCLIP`, `TOOLSGRENADECLIP`.
- **Stops eyes only**: `TOOLSBLOCK_LOS`.

The trigger is the one that catches people out. Its brush is a real brush sitting in a
doorway, and counting it solid reports a blocked corridor that every player walks through.

## What is left out, always reported

- **Displacements.** A side carrying a `dispinfo` means the flat quad in the file is not the
  surface the game builds. Tracing against it puts a valley floor where its rim is, wrong by
  the whole depth of the terrain, in an answer that reads exactly like a correct one. Such
  brushes are dropped and counted in `excluded.displacement`.
- **Brushes that enclose no volume.** Dropped rather than repaired: `read_vmf_solids` is the
  tool that explains why one is broken, and inventing a hull would answer questions about a
  brush the map does not contain.
- **Nothing else.** Hidden brushes are kept — a visgroup hides a brush from the editor, not
  from vbsp, and a corridor is not clear because the pillar in it is hidden.

## The player is not a line

`traceRay` takes optional half-extents and then sweeps a box instead of a ray. It costs one
term, not a second implementation: a brush is `dot(n, x) <= d`, and a box of half-extents `h`
touches that half-space as soon as its most advanced corner does, which is `dot(|n|, h)`
further along the normal. So the swept case is the ray case with every plane pushed out by
its support. Exact for an axis-aligned box, being the Minkowski sum written as a plane
offset.

This is not a refinement. "Is this corridor wide enough" is a question about a 32×32×72
player; answered with a ray it reports a doorway as passable when the frame is 24 units
apart, and the number looks perfectly reasonable. Source's hulls: **32×32×72** standing,
**32×32×36** crouching.

## Epsilons, and where they come from

| Constant | Value | Where it is from |
|---|---|---|
| `DIST_EPSILON` | `0.03125` | Quake's hull check, unchanged in Source. Backs a contact off the surface so a point left there is outside the brush. `src/bsp/trace.ts` uses the same value, which is why the two engines agree far closer than the cross-check demands |
| `ON_EPSILON` | `0.01` | Source's own, via `src/vmf/solid.ts`. A point within it of a face counts as inside — otherwise the surface reads as empty space and a voxel flood beside a wall walks through it one cell at a time |

## Two results that are deliberately not numbers

**`startSolid` names no brush.** A point inside a wall is usually inside several brushes at
once, and picking one would report the search order as if it were the map. `pointInSolid`
answers that question deliberately.

**A tie goes to the lowest brush id.** Two brushes meeting at a corner are hit at exactly the
same fraction by any box sweep that reaches the join — on a map made of boxes, most of them.
Taking whichever the search reached first makes the answer depend on the traversal, so the
tree and brute force name different walls while agreeing on the distance. That is the one
disagreement the cross-check could not tell apart from a real fault.

## The broadphase

A BVH, binned SAH, sixteen bins on the axis the centroids spread over most, four brushes to
a leaf. A uniform grid is the obvious choice and the wrong one: a Source map puts door frames
eight units thick inside a skybox sixteen thousand across, so any cell size is wrong for one
of them.

Nodes are emitted depth-first, parent before children, so **the left child is always
`node + 1`** and the array stores the **right** one. Storing the left index and assuming
`left + 1` for the right traverses the wrong half of the tree: no crash, roughly a third of
the map missing, every result plausible.

A broadphase is an optimisation, so it has exactly one correctness requirement — it must not
change any answer. The tests compare it with brute force **bit for bit** rather than to an
epsilon, because a tree that is nearly right drops a wall every few thousand rays and an
epsilon is precisely what would hide that. It also has a second requirement no correctness
test can see: it must actually prune. `TraceStats` exists so that has a number too.

## How it is proven

| Claim | Witness |
|---|---|
| The tracer is right | 5 000 rays through `src/space/trace.ts` and `src/bsp/trace.ts`, on `hmcp_probe.vmf` and its committed `.bsp`. Agreement on hit, and on distance to under **0.5 units**; the six axis rays agree to under **0.001** |
| The tree changes no answer | 4 000 rays and 800 box sweeps, identical to the bit against brute force |
| The tree earns its keep | fewer than 60 of 600 brushes tested per ray |
| The box sweep is not a ray | a 32-wide hull refused by a 24-unit gap a ray goes straight through |

The cross-check neutralises three known divergences by construction rather than by widening
a tolerance — a tolerance loose enough to cover them would cover a sign error too. Outside
the map is solid to vbsp and empty to a `.vmf`, so every ray starts inside the sealed room.
Brush entities are separate models and `readTree` reads only model 0, so the scene is
restricted to `world` and `func_detail`. Displacements are dropped on both sides.

# Looking at the map

`docs/PIEGES.md:47` records what happens without a picture: a visual diagnosis built from the
code alone, **entirely wrong** — it accused draw density, and the real faults were a missing
blur, icons that never arrived and a paperdoll four times too small. The rule written down
that day was *no diagnosis of appearance before there is an image*. `render_vmf_view` is the
first image this server can produce, and it needs no game.

## What it shows

Flat colour per face, one directional light, no textures, no lightmaps, no fog, no props. It
shows **form and occlusion** — what stands where, what hides what, how much room there is at
eye height. It does not show atmosphere, and no amount of work here would; that is what a
capture from the running game is for. Every call says so in its own output, because a
flat-shaded rendering looks enough like a game frame to be read as one.

A face's colour is a **stable hash** of its material name, shaded half-Lambert. Stability is
the point: the same wall is the same colour in two renderings taken an edit apart, so the two
can be compared. A palette handed out in draw order would make every rendering incomparable
with every other one, while looking perfectly sensible.

Half-Lambert rather than Lambert, so a face turned away is dark rather than black — in a
flat-shaded picture a black face reads as a hole, and a hole is what a leak looks like. The
background is dark blue-grey for the same reason.

## The camera is Source's, not ours

**+x forward, +y left, +z up**; `angles` is pitch, yaw, roll in degrees; **positive pitch
looks down**; `fov` is the **horizontal** field of view, so the vertical one follows from the
aspect ratio. That is what gmod-mcp's `read_view` reports for a player's eye, so a rendering
and a `capture_screen` from the same numbers frame the same thing and can be laid over each
other.

This costs nothing to honour now and cannot be retrofitted: changing it later invalidates
every rendering anyone has looked at. A vertical `fov` would give a picture that is right at
4:3 and subtly wrong at every other shape — the kind of error nobody sees and everybody
measures against.

## How a picture is checked

The rasteriser fills an `Int32` **id buffer** alongside the pixels: the brush visible at each
one. That is not a debugging extra, it is the oracle. For a sample of pixels the test rebuilds
the primary ray and asks `src/space/trace.ts` what it hits, then demands the same brush.
Scan-conversion with a z-buffer and a BVH descent share the camera and nothing else — and the
ray side is itself cross-checked against the engine's own tracer. **The chain of oracles ends
at the game.**

| Claim | Witness |
|---|---|
| The picture shows what is there | 2 000 pixels, id buffer against a traced ray, **over 99 %** agreement (measured: 100 % on the probe; the allowance is for silhouette pixels) |
| The camera is right | the near face of a 256-unit cube seen from 1024 away at 90° lands where the arithmetic says, to **0.001 px** |
| The PNG is a PNG | encoded, then inflated back and compared with the framebuffer byte for byte, at a width that is a multiple of nothing |

The third one exists because of the filter byte. Every PNG scanline is prefixed with one, and
`0` means no filtering. Omit it and the file is still valid, deflate still compresses, the CRC
still checks out — and every row shears one byte further than the last. Only reading the bytes
back shows it.

## What is deliberately not in the picture

No text. A banner with the position and angles was planned and dropped: the JSON beside the
image already carries them, and a second copy in pixels is the duplication this repository
treats as a regression — the two would eventually disagree and the pixels would be believed.

# Places, not coordinates

Everything above answers about points, rays, boxes and pixels. This layer answers about
**places** — is this map sealed, how many rooms has it, how wide is that doorway, which of
these faces is a floor somebody walks on.

## Three layers, and only the third is a guess

**Facts.** Brushes, faces, materials. Nothing inferred.

**Surfaces.** A face is a floor when its normal's z is at least **0.7** — roughly cos(45.6°),
the slope past which Source stops letting a player stand, and the same threshold
`FaceSelector.facing` already used. Whether a face is *real* is decided by probing: sample it
on a 16-unit grid, step one unit along its own normal, ask whether that point is inside
anything. A map is boxes pushed against each other, so most of what a `.vmf` contains is
buried — the underside of every slab, the back of every wall — and counting those doubles a
building's floor area in a number that reads perfectly ordinary.

The sampling pays for itself twice: when a probe lands *inside* a brush, that brush is the
neighbour, and the map's **brush adjacency graph** falls out of the same pass. Nothing here
knew it before.

*"Exposed" means open space in front, and that includes the outside of the map.* A ceiling
slab's upper face is an exposed floor, because it is the roof. Deciding what is *inside* is
not a property of a face.

**Rooms.** Heuristic, and every answer says so along with the parameters that produced it.

## Sealed, without compiling

Today the only thing that can say a map leaks is vbsp — a toolchain, minutes, and a refusal
to run vvis afterwards. A flood fill from a point inside either stays inside or it does not,
and where it got out is the leak. `read_vmf_leak` returns the path in the same shape as the
`.lin` pointfile, for the same reason: something to follow.

Seeds come from the map's own `info_player_start`. That is the one point an author has
guaranteed is inside — a map that spawns players in the void does not work at all. Falling
back to the middle of the extents is a guess, and the answer says so.

**16-unit cells, 6-connected, and a cell is free only when its whole interior is.** Each of
those is load-bearing:

- *16* is the coarsest grid that still resolves a 32-unit doorway, and it is a Hammer grid
  size, so nothing lands between cells for reasons of arithmetic.
- *6-connected* because a 26-connected flood steps diagonally across the line where two
  brushes merely touch — through a join no player can pass.
- *The whole interior* because testing the centre point lets a wall thinner than the grid fall
  between two centres, and the flood walks through a sealed map. Over-blocking loses a little
  space and can **miss** a leak; under-blocking **invents** leaks in maps that are fine. Only
  one of those cries wolf, so the resolution is reported and the limitation stated.

A cell is *standable* when it is free, has solid directly under it, and has 72 units of room
above. Both halves matter: without the ceiling test a ventilation duct is a room; without the
floor test the air above a courtyard is.

## Rooms: watershed, not components

The obvious method is connected components of the open space. In a sealed map that returns
**one** — which is what sealed means. Correct, and useless.

So the split has to come from shape. `clearance(c)` is the distance from a standable cell to
the nearest place a person cannot stand. A room is somewhere **locally wide**: the field peaks
in the middle of a room and saddles in a doorway. Growing regions from the local maxima in
order of decreasing clearance puts every boundary at a narrow place — so **the doorways are
not searched for, they are what is left over**.

Three details, each of which was wrong first and each of which produced a plausible answer:

| Detail | What it fixes |
|---|---|
| Walking is **four directions**, with a step of one cell up or down absorbed into each | Written as twelve offsets, a flat floor's every cell had a non-standable neighbour one cell up, so every cell was a boundary and **the clearance field was 1 everywhere**. The watershed still returned rooms of roughly the right size |
| Ridges are grouped **8-connected** | The field is a BFS distance, so it is Manhattan, and a Manhattan ridge runs diagonally. Grouped 4-connected it breaks into isolated cells, one seed each, and a 512-unit room comes back as eight |
| **A portal that narrows nothing is not a doorway** | Each doorway mouth raises the corridor's clearance by a cell, which is a local maximum, which splits the corridor there. The fixture's 2048-unit corridor came back as five rooms joined by portals 256 units wide — its own width |

The last one is a statement about the map rather than a threshold tuned until the fixture
passed: a doorway is a *constriction*, and if an opening is as wide as the narrower of the two
spaces it joins, they are one space.

## How it is proven

`test/support/rooms.ts` builds a map whose dimensions **are** the expected answers: two rooms
512 across, a corridor 256 wide, two doorways of 96, and a variant with a 64-unit hole in one
wall. Every expectation is a number from that file, never one recorded from a previous run.

| Claim | Witness |
|---|---|
| Three rooms, two doorways | the fixture's own plan |
| Doorway width | **exactly 96 units**, and nothing in the algorithm was told that |
| Room half-width | **exactly 256**, for rooms built 512 across |
| The graph | one space touches both others; they do not touch each other |
| Leak found | the path out ends inside the 64-unit hole, and starts at the seed |
| Sealed reads sealed | `hmcp_probe.vmf`, which compiles clean and boots |

Six sabotages redden it: 26-connected flood, no headroom test, no ridge grouping, no
portal-narrowing merge, and the two clearance faults above. Two of them needed **scenes of
their own** — the three-room fixture cannot tell a 26-connected flood from a 6-connected one,
because its walls are thicker than a cell and the whole-interior test already blocks the
diagonal. The scene that does show it has two blocks meeting at a cell *boundary* inside a
sealed shell, and both of those properties had to be right before the test could distinguish
anything.

## What is still a guess

The watershed can split a hall that has a pillar in the middle, and it can swallow an alcove.
Nothing here has been checked against an independent implementation — the plan's oracle, a
recomputation from mutual visibility on the compiled map, is not written. Until it is, the
room count is **partly proven**: exact on a fixture that states its own answer, unjudged on a
real map.

# The plan

The perspective view says what a place looks like from somewhere. A plan says **where things
are**, and it is the drawing you can measure with. Both are wanted and neither replaces the
other: an agent with only the perspective is back to judging by eye.

## One drawing, two back ends

A plan is wanted in three forms that pull in different directions — a raster to **look** at, a
text form to **keep**, and numbers to **assert** on. Three drawings would mean three chances
to disagree, and the one nobody looks at would be the one under test.

So there is one **display list** — polygons, lines and labels in page coordinates — and two
back ends. `svg.ts` writes text, `paint.ts` writes pixels, and neither decides anything: every
coordinate, colour and string is already in the list. The tests assert on the list, which is
the only one of the three where *"room 2's label is inside room 2's outline"* is a statement
about numbers rather than about ink.

**The y flip happens exactly once**, in `fitPage`. Hammer's +y is north; every raster format
counts rows from the top. A sign that changes in two places eventually changes differently.

## The section, and why there is no second hull routine

A brush's section at `z = k` is the intersection of its half-spaces with `z <= k` and
`z >= k`. So it is `hullFromPlanes` again with two planes added — the routine
`read_vmf_solids` is already checked by — rather than a polygon clipper written for this file
and wrong in some other way.

The cut is taken **48 units above the lowest standable floor**, not above the map's minimum:
the map's minimum is the bottom of the floor slab, and a cut there is solid everywhere. At
that height a doorway reads as a gap and a waist-high obstacle reads as solid. Anything
entirely above or below is not on the drawing at all, so the cut height is always reported.

## What makes it a plan rather than a picture

A scale bar in round units, a grid you can count, a north arrow, and **the width written on
every doorway**. Without the numbers you can see that a doorway is narrower than a corridor
and cannot say by how much, which is the question.

Legibility is checked, not hoped for: two labels that overlap are not two numbers, so
overlapping ones are dropped and the drop is reported — the caller can ask for a bigger page
instead of quietly getting less.

## How it is proven

| Claim | Witness |
|---|---|
| The drawing is the geometry | the polygons' area, measured **on the page** and converted back, equals the sections' own area |
| It draws sections, not bounding boxes | a 24-sided prism comes out between the inscribed and circumscribed areas for 24 sides — 21 % under its own bounding box |
| Labels are where they belong | every room label falls inside that room's outline |
| Labels are readable | no two label boxes overlap, at any page size |
| Both back ends draw the same thing | one SVG element per list item, every `data-role` preserved |

Four sabotages redden it, and **two of them needed new cases**. Drawing bounding boxes instead
of sections passed everything, because every brush in the rooms fixture is an axis-aligned box
whose section *is* its bounding box. Removing the label-overlap check passed too, because at a
comfortable page size nothing collides — the page has to be squeezed before the check has
anything to do.

# Measuring

Every number in this layer follows one rule, and the rule is what makes it exact:

> **The voxel localises. The swept hull measures.**

The clearance field says *where* the narrow point of a corridor is, to within a cell —
sixteen units, which is plenty to find a place and useless as an answer. The swept box then
measures *there*, against the real planes.

Skipping the second half is the failure this exists to avoid. The fixture's 96-unit doorway
is six cells wide, so `6 × 16` gives 96 **by luck**. Build it 100 units instead and the voxel
answer is still 96 — and nothing about it looks approximate. A test asserts exactly that case.

Skipping the first half is worse: without somewhere to measure, "how wide is this corridor"
has no defined answer, because a corridor is wide one way and long the other.

## Every measurement has an operative definition

Not an intention. *"Enough room to get past"* is an intention. *"The distance a 32×32×72 box
travels from this point along this axis before it touches something"* is a measurement, and
two people who run it get the same number.

| Measurement | Definition |
|---|---|
| Free width | two swept-hull probes in opposite directions, **plus the box's own footprint** |
| Narrowest width | the smallest of those over 16 horizontal directions, 11.25° apart |
| Headroom | the same measurement turned on its side, with a flat probe box |
| Clearance in front | swept from the entity's origin, **lifted to standing height above the floor beneath it**, along its yaw |
| Nearest obstacle | exact closest point on the polytope, not a sample |

Three of those rows are corrections to an obvious wrong version:

**The box's own footprint.** A 32-wide hull that travels 32 units each way is standing in a
96-unit gap, not a 64-unit one. Omitting the term under-reports every width by exactly one
player — the width most likely to be the one that matters.

**Sixteen directions.** A corridor measured along y when it runs diagonally reports the
diagonal's projection, which is wider than the gap.

**The lift.** An entity's origin sits at its base. A sweep from there goes through the floor
slab and returns zero, which reads as "completely blocked" for every entity in the map.

## The epsilon that had to come back

The tracer backs every contact off by `DIST_EPSILON` so a point left there is outside the
brush. That is right for a tracer and **wrong for a measurement**: it makes every distance
short, and a width — two sweeps — short by twice that. The 256-unit corridor measured
255.9375, which is close enough to read as rounding and is in fact a systematic bias.

The correction is `DIST_EPSILON / |n · d|`, not a flat epsilon: the nudge is along the plane's
normal, so its cost along the direction of travel grows for a glancing hit. Adding back a flat
value fixes the axis-aligned case and leaves every oblique one wrong.

`headroom` is written as `widthAcross` turned on its side for the same reason. Its first
version read the contact *point* and was 0.0625 short while the widths beside it were exact.
One measurement path, one place for the correction to live.

## How it is proven

| Claim | Witness |
|---|---|
| A corridor built 256 wide | measures **256** |
| A doorway built 96 | measures **96**, and the room pass independently found where it is |
| A doorway built **100** | measures **100**, where the voxel estimate would still say 96 |
| A ceiling 256 up | measures **256**, and 128 when beams hang at 128 |
| A 32-wide gap | crossed by a crouching hull, refused to a standing one |

Five sabotages redden it: measuring with a point instead of a hull, dropping the footprint
term, dropping the epsilon correction, not lifting off the floor, and taking the first
direction instead of the narrowest.

# The map's own rules

*"Four metres of pavement, no entrance obstructed, the view from the lobby preserved"* is a
design brief, and until this layer it had no form anything here could check.
`<map>.rules.json` gives it one.

## Per map, never global

The file is a **sibling** of the `.vmf`. No walking up the directory tree, no defaults, no
built-in bar. A residential street and a warehouse have different right answers for every
number in it, and a shared default would be wrong for both **while looking authoritative**.

No rules file means *no checking*, not *checking against something reasonable*. The tool says
so explicitly rather than returning a clean report.

## It reports; it never refuses

The writing tools do not consult it and must not. A mapper may want a narrow alley, and
turning a design choice into a write error is how a tool stops being usable.

This is the exact opposite of the geometry checks, which *do* refuse — and the difference is
the point: **a non-planar face is not a choice, and 96 units of corridor is.** A test writes a
map that violates every rule it has and asserts the edit goes through.

## A rule that cannot fail is refused at load

Three shapes are rejected rather than ignored, because each would sit in the file reading as
enforcement while passing on every map:

- a bound-less rule (`min` and `max` both absent);
- a selector that matches nothing syntactically (no `select` at all);
- a `sightline` missing one of its ends.

Two rules with the same `id` are refused too: an id names a rule in its violations, and a
duplicate makes a finding impossible to trace back.

A rule that matches nothing *at runtime* — a rule about a room the map does not have — is
reported as a finding about the rules, not counted as a pass.

## The loop closes

Every violation carries **the worst point**. `render_vmf_view` and `render_vmf_plan` both take
a position, so:

> measure → locate → look

and none of it needs a compiler.

```json
{ "version": 1,
  "rules": [
    { "id": "door-clearance", "what": "clearance_in_front",
      "select": { "classname": "prop_door" }, "min": 192, "severity": "error",
      "note": "A person has to be able to stand in front of a door and open it." },
    { "id": "corridors", "what": "circulation_width",
      "select": { "room": "*" }, "min": 96, "severity": "warning" },
    { "id": "lobby-view", "what": "sightline",
      "from": { "entity": "spawn_lobby" }, "to": { "entity": "reception" }, "mustBe": "clear" }
  ] }
```

## The fault this layer found in the layer below

A room's widest cell, a doorway's col and an entity's origin are all **places on the floor**,
not body positions. A hull centred there extends half its height below the floor, starts
inside the slab, and every sweep returns zero — so the 256-unit corridor measured **32**,
which is the hull's own footprint and nothing else. A plausible number produced by measuring
nothing.

`standingAt` is now one function rather than a line repeated at each call site, and
`clearanceInFront` — which had the lift already — uses it too.

## How it is proven

| Claim | Witness |
|---|---|
| The bar is the map's | a corridor built 256 passes a 192 rule and fails a 320 one, quoting both numbers |
| Doorways are measured as doorways | both come back at **96**, against a 128 bar |
| The door into a wall is found | **112** units in front, which no compiler mentions |
| A broken view is named | the sight line reports the brush in the way |
| It never refuses | an edit goes through on a map violating every rule it has |

Six sabotages redden it: a global default bar, searching up the tree, accepting a rule that
cannot fail, skipping the lift, counting a rule that matched nothing as a pass, and dropping
the point to look at.

## What this does not do

It does not know what a **street** is, or a **pavement**, or a **shop front** — and now it
does not need to. Those are not derivable from geometry; they are what the rules file names.
`outdoor` is derivable (a ray up from a standable cell meets the skybox) and is the one such
concept the code owns.

Nor does it judge whether a map is *good*. "Sealed, 96 units wide, clear from the spawn" is
not "beautiful", "legible" or "in the right place". The stack does not make that judgement
possible; it removes the excuse of confusing it with a measurement nobody took.
