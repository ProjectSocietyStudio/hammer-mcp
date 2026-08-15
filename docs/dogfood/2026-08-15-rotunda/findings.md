# `hmcp_rotunda` — what building something that is not boxes was like

Round 7, 15/08/2026. A round brick cistern with a conical roof, a central pier, one arched door
and a square annexe. Six maps built with these tools before it, every one of them boxes pushed
against each other.

**The first round to end in the game**, and it had to: the question it was built to ask cannot
be asked offline.

## What it cost

| | R1 | R3 | R5 | R6 | **R7** |
|---|---|---|---|---|---|
| subject | bodega | bodega | house + garden | tenement | **rotunda** |
| MCP calls | 53 | 41 | 89 | 47 | **44** |
| logged failures | 2 | 0 | 0 | 0 | **0** |
| brushes · entities | 18 · 8 | 16 · 8 | 71 · 11 | 101 · 16 | **38 · 8** |
| compiles run | 1 | 1 | 4 | 8 | **2** |
| **compiles that failed** | 0 | 0 | 0 | 0 | **1** |

Fewest brushes of any map since round 3, and the first failed compile since round 1 — which is
the round in one line: shape is not size.

---

## The headline: the offline picture was right and the diagnosis it would have produced was wrong

The tour showed the ring wall as sixteen flat plates. So did the game. **For unrelated reasons.**

The renderer is flat-shaded per face and cannot show smoothing; that is documented and was
written into the friction log *before* the game was opened, precisely so the answer could not be
read back into the tools afterwards. The prediction on the table was therefore: *if it reads
faceted in game, the smoothing groups are wrong.*

They are not. In game there is a continuous gradient across each facet — the smoothing is
working. What breaks the curve is the **texture**: `align_faces` in `mode: "face"` gives every
facet its own axis pair and its own offset, so the brick course restarts at each of the sixteen
seams. The joints are texture discontinuities, and they dominate the read completely.

`face` was the right call — `world` squashes a brick on a 22.5° facet by cos 22.5°, sixteen
times, each differently. Both modes are per-face, and **a curve needs a run**: correct scale per
facet, with each one's offset carrying on from where its neighbour stopped. That is arithmetic,
not judgement, and nothing here does it
([#93](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/93)).

The lesson is not "look at the map" — round 4 established that. It is sharper:

> **A picture tells you what is wrong. It does not tell you why, and the obvious why is
> available and plausible and can be the wrong one.**

I would have shipped a fix to the smoothing groups.

---

## The findings

### 1 · `read_vmf_leak` said sealed. vbsp said leaked. — **not a bug**

The first disagreement between the two in seven rounds.

```
read_vmf_leak   sealed: true, 18192 open cells
vbsp            **** leaked ****
read_leak       escapes at [285, -56.6, 12]
```

A lens **a few units wide** between the round wall's outer arc and the vestibule's flat west
wall — two surfaces that meet tangentially at one point and diverge either side of it. At 16
units per cell the flood cannot see it.

The tool says it can do this and the trade is correct: *"space is lost against surfaces rather
than gained through them, because inventing a leak is worse than missing one."* Six maps of
boxes never produced a wall thinner than a cell; on an axis-aligned map at that grid it is close
to impossible. **Round meets square produces one immediately, by construction.**

This is the fourth green earning its place, and the first measured account of why it is not
redundant with the first. What is missing is a sentence: `sealed: true` reads the same on a map
that cannot hide a leak from this method and on one that can
([#91](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/91)).

### 2 · `ungroupedSolids` counts every solid — **bug**

39 brushes, 16 grouped, `ungroupedSolids: 39`. It should be 23. Grouping reaches nothing
downstream — vbsp ignores it, the lint does not count it, the sidecar cannot read it — so this
field is the entire feedback loop, and it never moves
([#88](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/88)).

### 3 · The tour puts a camera inside whatever stands in the middle of the room — **bug**

A doorway view is placed part way from the room's centre to the col, with a comment saying a
point on that line *"is inside the room by construction"*. True of a convex room. **A rotunda is
a room whose centre is solid** — as is any hall with a column or a courtyard with a monument.

One frame in seven was the inside of the pier. The reporting is right and unprompted —
`insideSolid: true` and a note saying which frame — but the tile is still spent, and on a
nine-tile sheet that is 11% of the only look anybody takes
([#90](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/90)).

### 4 · `arch`'s `innerRadius` is the circumscribed radius — **docs**

An arch is a ring of wedges, so the usable interior is `innerRadius · cos(180/segments)` — 251
where 256 was asked for, at 16 segments; 236 at 8. The first thing anyone does with a round room
is stand in the middle of it, and a marker placed "just inside the wall" is buried
([#92](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/92)).

The refusal was excellent and is not the complaint: `read_vmf_leak` declined to flood from a
buried seed *and declined to conclude anything about sealing*, rather than reporting a sealed
map from zero cells.

### 5 · `group_solids` warns you cannot verify it, and you can — **ergonomics**

Its description ends by saying srctools cannot read groups back. True of the sidecar, and it
reads as *you have no way to check this*. `read_map_organisation` read the group back correctly
on the first call — and `group_solids`'s own `nextStep` says so, so the description and the next
step disagree ([#89](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/89)).

### 6 · A floor material on a vertical curve, never aligned — **the map's fault**

The pier and its cone carried `CONCRETE/CONCRETEFLOOR003C` with world axes. In game: severe
horizontal banding, in every screenshot. `align_faces` is exactly the fix and it was run on the
ring and not on the pier.

Recorded because **the offline render showed the banding and it was dismissed as a possible
artefact of the flat renderer.** It was real. A doubt written down as a doubt is worth having;
this one was, in the friction log, before the game was opened.

---

## What the checker got right and I did not

Three times running, `check_vmf_rules` failed the map and was correct each time, and the first
instinct each time was to suspect it.

A square plinth under a round cone: its corners stick out past the cone's base, its chamfer is a
walkable 26° ramp onto them, and the cone leaves **one unit of headroom** there. `circulation_width`
unmeasurable, `headroom: 1`. Both true. A person could reach a place they could not stand in.

Two attempts to save the plinth — shrinking its top, then steepening the chamfer past Source's
45.57° — each moved the failure rather than removing it. Deleted, and the chamfer moved to the
door reveal, where the brief had wanted it all along.

`move_vertices` reported `planarityError: 0` on all four attempts, which is the one thing it
promises.

## What the map is

Sealed, `overall: "pass"` at the default `step`, 39 brushes all valid at `grid: 1`, vbsp/vvis/vrad
all exit 0 on a full compile, no pointfile. Three rooms — rotunda 91.0 m², vestibule 41.8,
annexe 48.1 — two doorways, 87 clusters, 2 673 bytes of visibility.

It is dark: three lights for three rooms. Defensible for a buried cistern and not measured
against anything, because no profile here carries a calibrated threshold for how lit a room
should be — which `read_map_report` says of luxel density in as many words, and is right to.

## The findings, sorted

| | Class | Issue | Needed a curve? |
|---|---|---|---|
| 1 · sealed / leaked disagreement | not a bug | [#91](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/91) | yes — impossible on a box map |
| 2 · `ungroupedSolids` | **bug** | [#88](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/88) | no — never called |
| 3 · tour camera in the pier | **bug** | [#90](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/90) | yes — needs a solid centre |
| 4 · `arch.innerRadius` | **docs** | [#92](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/92) | yes |
| 5 · `group_solids`'s warning | **ergonomics** | [#89](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/89) | no — never called |
| 6 · no alignment runs around an arc | **gap** | [#93](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/93) | **yes — and only the game found it** |

Six issues raised, none fixed: this round stops at the measurement. Finding 6 is the one that
justifies the trip into the game, and it is the only one no offline reading could have produced.
