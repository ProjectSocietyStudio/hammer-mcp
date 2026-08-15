# `hmcp_rotunda` — friction log

Kept as it happened, 15/08/2026. Seventh round, and the first map here that is not an assembly
of boxes.

---

## 1 · `arch`'s `innerRadius` is the circumscribed radius, and the interior is smaller

**Wanted**: to stand in the middle of a round room.
**Call**: `arch` with `innerRadius: 256`, then an `info_player_start` at radius 254.
**Back**: `seed 180 -180 16 is inside a brush and was ignored ... no usable seed: nothing was
flooded, so nothing here says whether the map seals.`

An arch is a ring of **wedges**, so its inner boundary is a polygon inscribed in `innerRadius`,
not a circle of that radius. The usable interior is `innerRadius · cos(180/segments)` — at 16
segments that is 251, five units less. Nothing in the tool's description says which radius it
means, and on a coarse ring the difference is large: at 8 segments it would be 236.

**Not friction in the message.** The refusal is exactly right: it declined to flood from a buried
seed and declined to conclude anything about sealing, rather than reporting a sealed map from
zero cells. That is the shape every check here should have.

**Cost**: two moves of the spawn — the second one landed inside the plinth, which is a different
brush and the same lesson.

---

## 2 · `read_vmf_leak` said sealed. vbsp said leaked.

The round's headline, and the first time in seven rounds the two answers have disagreed.

```
read_vmf_leak   sealed: true, 18192 open cells
vbsp            **** leaked ****   Entity info_player_start (200 -100 0) leaked!
read_leak       escapes at [285, -56.6, 12]
```

The hole is a **lens a few units wide between the round wall's outer arc and the vestibule's
flat west wall** — the two touch tangentially at one point and diverge either side of it. At 16
units per cell the flood cannot see it.

**The tool says it can do this**, in as many words: *"a wall thinner than that is not resolved,
and a cell is free only when its whole interior is. Space is lost against surfaces rather than
gained through them, because inventing a leak is worse than missing one."* Six maps of boxes
never produced a wall thinner than a cell. **Round meets square does, immediately, and by
construction.**

**Cost**: one failed compile, one `read_leak`, one geometry fix. Nothing wasted — this is the
fourth green earning its place, and the account of why it is not redundant with the first.

---

## 3 · A square plinth under a round cone is a crawlspace the checker is right to fail

**Wanted**: a chamfered plinth under the central pier, to exercise `move_vertices`.
**Back**: `check_vmf_rules` failed twice — `circulation_width` unmeasurable (the hull clips the
cone) and `headroom: 1`.

Both were **true**. The plinth's square corners stick out past the cone's round base, its
chamfer is a walkable 26° ramp up onto them, and the cone leaves one unit of headroom there.
A person can get to a place they cannot stand in.

Two attempts to save it — shrinking the top, then steepening the chamfer past 45.57° — each
moved the failure rather than removing it. Deleted, and the chamfer moved to the door reveal
where the brief actually wanted it.

**Not a tool finding.** Recorded because the *first* instinct was to suspect the checker, and
the checker was right three times running. `move_vertices` reported `planarityError: 0` on all
four attempts, which is the one thing it promises.

---

## 4 · `ungroupedSolids` counts every solid, not the ungrouped ones

**Wanted**: to confirm the sixteen wall segments were one group.
**Call**: `group_solids` on 16 ids, then `read_map_organisation`.
**Back**:

```
groups: [{ id: 353, solidCount: 16 }]
ungroupedSolids: 39
```

The map has 39 brushes. Sixteen are in the group. `ungroupedSolids` should be 23.

A caller checking whether a grouping took gets a number that never moves.

---

## 5 · `group_solids` warns you cannot verify it, and you can

Its description says *"srctools cannot read this back: its writer emits `groupid` and its parser
looks for `group`, so the sidecar reports no group membership on any map."*

True of the sidecar, and it reads as *you have no way to check this*. `read_map_organisation` is
TypeScript and read the group back correctly on the first call. The warning is about a reader
the caller was not about to use, placed where it discourages the one that works.

---

## 6 · The tour puts a camera inside the central pier, and says so

```
DOOR 0-2 FROM 0: insideSolid: true
"the eye came out inside a brush even after standing up. That is a frame of the inside of a
 wall, not of the room."
```

The camera for a doorway view is placed part way from the room's centre to the col. On a round
room with something *in* its centre — which is what a rotunda is — that line starts inside the
pier. The placement stands the camera up; it does not step it clear of a solid.

**The reporting is right and the note is unprompted.** One frame in seven was a wall, and the
sheet said which.

---

## 7 · What the flat renderer cannot show, stated before looking

Every frame of the tour shows the sixteen-segment wall as sixteen flat plates, because the
renderer is flat-shaded per face and has no lighting model beyond one directional term. That is
not a defect — it is the documented limit — but it means **the round's central question cannot
be asked offline**:

- do the smoothing groups make the wall read as a cylinder?
- does group 2 keep its arête where the cone meets the pier, or bleed across it?
- are the horizontal bands at the wall/floor junction z-fighting, or an artefact of this
  renderer?

Recorded here, before the game was opened, so that whatever the answer is it cannot be read back
into the tools as if they had known.
