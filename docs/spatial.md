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

## What this does not do

It does not know what a **room** is, where a **door** is, or how wide a **pavement** is. It
answers about points, rays, boxes and pixels. The layer that turns those into places is the
scene graph, and it is not written yet.
