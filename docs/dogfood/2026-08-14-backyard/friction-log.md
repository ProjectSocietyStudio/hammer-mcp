# `hmcp_backyard` — friction log

Kept as it happened, 14/08/2026. Not a builder who was cold: this session had read the three
bodega rounds and `building.md` before starting, and the reading of the numbers has to say so.
What that buys is a different measurement — not *how much does an unwarned agent pay*, but
*what does the toolkit still cost somebody who knows every trap it has already produced*.

---

## 0 · The build was stale, and `health` said so

**Wanted**: to start.
**Call**: `health`.
**Back**: `tools.build.stale: true`, build 14:16 against source 14:19, with the note naming
`pnpm build` and the reconnect.
**Cost**: one `pnpm build`, no reconnect needed — the tool count had not changed.

Not friction. This is finding 1 of round 1, fixed, working. Recorded because a fix that keeps
working is evidence too.

---

## 1 · `write_vmf`'s skybox check now runs, and [#62](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/62) did not reproduce

**Wanted**: a file, with a sky the compiler would accept.
**Call**: `write_vmf`, default `skyname`.
**Back**: `skybox: {checked: true, found: true, missingSides: []}` plus a note distinguishing
*present* from *usable*.
**Cost**: none. The compile drew no skybox complaint.

---

## 2 · `set_face_material` cannot name a direction in plan, so a wall's two faces cost five extra calls

**Wanted**: brick outside, plaster inside — the most ordinary thing a building wall does.
**Call**: `set_face_material` with `facing`.
**Expected**: some way to say "the +y face".
**Back**: `facing` takes `up` / `down` / `side` / `any`. Both faces of a wall are `side`.
**Workaround**: split every exterior wall down its middle with `clip_solids` (4 calls), then
paint the inner halves by `solidIds` (1 call). Five calls and nine extra brushes to express one
sentence.

The vocabulary exists elsewhere in the same toolkit: `write_vmf_fitting`'s `counter.facing` and
`skirting.omit` both take `+x` / `-x` / `+y` / `-y`.

---

## 3 · `clip_solids` with `keep: "both"` does not say which half is which

**Wanted**: to know whether the kept `id` or the new `otherId` is the front.
**Back**: `{id, otherId, volumeBefore, volumeAfter, volumeOther}` — volumes, no bounds, no side.
**Workaround**: one `read_vmf_solids` with `include: "all"` to read the bounds back.
Answer, for the record: **the kept `id` is the front**, the side the normal points towards.
**Cost**: one call, and a wrong guess would have painted nine exterior faces plaster.

---

## 4 · A `counter` at the depth of the toolkit's own table collapsed the room segmentation

The expensive one. Full account in `findings.md` §2.

**Wanted**: a kitchen worktop.
**Call**: `write_vmf_fitting`, `counter`, envelope `[422,40,0]`–`[446,200,56]`, `facing: "-x"`.
**Back**: three brushes, `depth: 24`, no warning.
**Then**: `check_vmf_rules` went from `pass` to `skipped`, `rooms: 3 → 1`, `portals: 2 → 0`.

**What I did**, and what it cost: read the note first as `building.md` says, which correctly said
*geometry, not resolution* and *do not sweep `step`* — that saved the round-2 trap outright. Then
bisected by deletion: skirting out (still 1), door frames out (still 1), counter + switch out
(**3 again**), counter back alone (**1 again**). Four deletes, four `read_vmf_rooms`. Eight calls
to name three brushes.

**The cause was not depth.** 24 is under both numbers `building.md` gives. It was the
**26 × 24 alcove left between the counter's end and the far wall**, whose peak clearance of 16 —
one cell — became the merge bar for the whole map.

**Fix**: run the counter wall to wall. `rooms: 3`, `portals: 2`, merge bars back to 80 and 64.

---

## 5 · `door_frame`'s threshold makes its own doorway unmeasurable

**Wanted**: a raised sill on the garden door, which is what `threshold: true` is for.
**Back**: a brush `[320,224,0]`–`[400,240,2]`, 2 tall — `DOOR.thresholdHeight` from the measured
table.
**Then**: `check_vmf_rules` → `fail`, `doorways-wide-enough`, `measured: null`,
`startsInside: {brushId: 568}`, at `[352, 224, 36.53]`.

**Not friction in the message** — the [#59](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/59)
fix from round 3 did exactly its job: it named the brush instead of returning a bare `0`, and the
diagnosis took one read. Friction in the **situation**: the finishing tool and the checking tool
disagree about the same doorway, and the map paid for it — I deleted a correct detail to get a
green.

---

## 6 · Nothing offline draws a prop, so a door buried to its waist passed every check

**Wanted**: to see the door.
**Back**: `render_vmf_tour`, seven frames, no door in any of them — the renderers draw brush
geometry only, and say so.
**Then**, on a hunch, `read_model_info props_c17/door01_left.mdl`: `mins z: -54.25`, the origin
at the model's centre.

My door was at `origin z 0`. **Half of it was underground**, and `read_vmf_lint`, `validate_io`,
`check_vmf_rules`, three compile stages and `read_leak` all passed.
**Cost**: one call to find, one `edit_vmf` to fix (`z 54`, `yaw -90`). The cost that matters is
the one not paid: nothing would have told me.

---

## 7 · `write_vmf_fitting` has no window, and a window is a doorway's twin

**Wanted**: a window onto the garden, finished.
**Back**: three fittings exist — `door_frame`, `counter`, `skirting`.
**Workaround**: eight `write_vmf_solid` boxes for jambs, head and sill on both wall faces —
exactly the shape `door_frame` builds, plus a sill. One call, but only because I already knew
the six numbers it would have supplied.

---

## 8 · `read_game_content` lists a material whose textures do not exist

**Wanted**: grass for the garden's displacements.
**Call**: `read_game_content nature/blendgrass*` → `NATURE/BLENDGRASSDIRT01`, listed as present.
**Then**, after compiling: `read_map_dependencies` → **3 missing**,
`materials/nature/forest_grass_01.vtf`, `forest_dirt_02.vtf`, `blendtexture01.vtf`, all
referenced by that `.vmt`.

The `.vmt` is in the game. Its textures are not. The garden would have been a purple
checkerboard, and the browser that exists precisely to stop that reported it as present.
**Fix**: `set_face_material` to `NATURE/BLENDGRASSGRAVEL001A`, recompile, `missingCount: 0`.
**Cost**: two calls, and it would have shipped had I not run `read_map_dependencies` at all.

---

## 9 · The renderers cannot show the two things this map exists to have

**Terrain**: *"4 displacement brush(es) are not drawn: their flat quad is not the surface the game
builds"*. Honest, and it means the look-at-it step is blind to every displacement.

**Sky**: `skyFraction: 0` in all seven tour frames and in a hand-aimed view whose top third is
`toolsskybox`. Whatever that field counts, it is not what a mapper means by "how much sky do I
see", and on an outdoor map that is the question.

---

## What the trap list was worth

`building.md`'s *"read the note before sweeping `step`"* was decisive: the note said `geometry,
not resolution`, I believed it, and the round-2 trap cost nothing. Its *"furniture depth is the
usual cause"* was **wrong for this map** — the depth was 24 and the cause was an alcove — but the
sentence still pointed at furniture, which is where the culprit was. Right neighbourhood, wrong
street.
