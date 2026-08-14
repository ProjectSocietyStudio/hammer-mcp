# `hmcp_backyard` — what building the first map with a dehors was like

Round 5, 14/08/2026. New subject, not a fourth run of the bodega — because what rounds 1 to 3
proved is that a sealed interior box had stopped producing findings, and the round-4 brief said so
itself: *"the brief was the ceiling"*.

`hmcp_backyard` is a two-room house whose kitchen door opens onto a walled garden under the sky.
Four things in it no earlier round had: **an exterior sealed by `toolsskybox`**, **a door that is
an entity rather than a hole**, **terrain as displacements**, and **a building seen from outside**.
Every finding below comes from one of those four.

**The measurement is not comparable to rounds 1–3 and the honest reading has to say so.** This
session had read the three bodega rounds and `building.md` before starting. It is not *how much
does an unwarned agent pay*; it is *what does the toolkit still cost somebody who knows every trap
it has already produced*. Two of the six findings below are cases where that knowledge was
**wrong** — which is the more useful half.

## What it cost

| | Round 1 | Round 2 | Round 3 | **Round 5** |
|---|---|---|---|---|
| subject | bodega | bodega | bodega | **house + garden** |
| MCP calls | 53 | 51 | 41 | **89** |
| logged failures | 2 | 1 | 0 | **0** |
| hand-edits forced | 1 | 0 | 0 | **0** |
| `check_vmf_rules` passes at the default `step` | — | no | yes | **yes** |
| brushes · entities | 18 · 8 | 14 · 8 | 16 · 8 | **71 · 11** |
| total tool time | — | — | — | **32.3 s** |

89 calls is not a regression against 41: it is four times the brushes, a compile chain run four
times, and eight calls spent bisecting a single defect. The number worth reading is the second
row — **a second consecutive round with no failed call at all**, on a map that used displacements,
brush entities, an FGD lookup, an I/O check and the packing walk, none of which round 3 touched.

The audit log's worst repeat is `5× check_vmf_rules` with byte-identical arguments. Unlike round
1's nine identical `read_vmf_rooms`, **every one of those five was asked of a different map** — it
is the bisection, not a message that taught nothing. *The audit log cannot tell those two apart*,
which is round 1's finding 9 from a new angle and is recorded here rather than acted on.

---

## 1 · `mask: "sight"` treats a glass pane as opaque, so a sightline rule passes on a window you can see straight through — **bug**

The living room has a window onto the garden. The brief asks that the garden **not** be visible
from the sofa, so that you go through the kitchen to reach it.

`check_vmf_rules` reported `pass`. `read_vmf_trace` from the sofa to the garden, **with
`mask: "sight"` set explicitly**, says why:

```
hit: true, brushId: 178, material: "GLASS/GLASSWINDOW002A", fraction: 0.466
```

`mask` documents itself as the difference between *can they see the door* and *can they reach it* —
`sight` sees through clip brushes, `player` does not. It does not distinguish a translucent
material from an opaque one, so every glazed opening in a map blocks every sightline rule. A
`mustBe: "blocked"` that passes because of a window is worse than no rule: it is a green that
asserts the opposite of the truth.

Not hypothetical for this repo: `rp_nycity_day` is a city of shopfronts.

The narrow fix is a material-side test on `$translucent` / `$alphatest` / a `glass/` path. The
wider question is whether `sight` should mean *what a player sees* — in which case a fence with an
alpha mask is a second case with the same shape.

## 2 · A `counter` at the depth of the toolkit's own table collapsed the segmentation, and the cause was **not** depth — **bug**

The expensive finding, and the one that corrects the documentation written after round 3.

One `write_vmf_fitting` call, envelope `[422,40,0]`–`[446,200,56]`, `facing: "-x"`, three brushes,
`depth: 24`, no warning. Immediately after it:

| | before | after |
|---|---|---|
| `read_vmf_rooms` | 3 rooms, 2 portals | **1 room, 0 portals** |
| merges | 3, bars 96 / 96 / 96 | **9, bars 16** |
| `check_vmf_rules` | `overall: "pass"` | **`overall: "skipped"`** |

Isolated by deletion — skirting out (still 1), door frames out (still 1), counter and switch out
(**3 again**), counter back **alone** (**1 again**). Eight calls; nothing else in the map changed.

**`building.md` is wrong about the mechanism, and this round exists to say so.** It states that
*a run 48 units deep collapsed the segmentation where the same run at 32 did not*, and names
**depth** as the cause. This counter is **24** deep — under both numbers, and exactly
`COUNTER.depth` from the toolkit's own measured table. Depth was never the variable.

What actually happened is legible in the merge list. The counter ran from `y 40` to `y 200` in a
room whose far wall is at `y 224`, leaving a **26 × 24 alcove** at its end. That alcove's peak
clearance is 16 — one cell. It merges into the room as a not-a-constriction, and from then on the
merge **bar for the whole map is 16**: every real doorway measures 64 or 80, which "narrows
nothing" against a bar of 16, so every one of them is absorbed in turn. Nine merges, one room.

So the statement to keep is not about depth. It is:

> **A single small alcove anywhere in the map lowers the merge bar for every boundary in it.**
> Once one region peaks at one cell, no doorway in the map is a constriction any more. It need not
> be near anything it destroys.

That is #48 / #60 stated more sharply than any of the three earlier rounds managed — round 1 found
it varies with cell *order*, round 2 with cell *size*, round 3 with *geometry 200 units away*, and
all three described a symptom. This is the mechanism: **the bar is global, the alcove is local.**

The mapper's fix is one line and `building.md` already gives it for the wrong reason — *run a
counter to the end of its wall*. Running it wall to wall restored `rooms: 3, portals: 2` and merge
bars of 80 and 64.

The tool's fix is smaller than it looks: the merge already **knows** it is closing a 128-unit
doorway with a bar of 16 and says so in `why`. Refusing to let a bar below some multiple of the
player hull close an opening wider than itself, or reporting that cascade as its own finding,
would have turned eight calls into zero.

## 3 · `door_frame`'s own threshold makes its own doorway unmeasurable — **bug**

`threshold: true` lays a strip 2 units tall across the doorway floor — `DOOR.thresholdHeight`,
from the measured table. `check_vmf_rules` then cannot measure that doorway at all:

```
doorways-wide-enough: measured: null, at [352, 224, 36.531]
"The 32x32x72 hull centred at [352, 224, 36.531] is already inside brush 568 (world)"
evidence: { hullFits: false, startsInside: { brushId: 568, owner: "world" } }
```

The measuring point is placed from the floor **below** the threshold, at `z 0`, rather than from
the surface a person actually stands on, at `z 2`. The hull's underside lands inside the sill.

Two things to say about it, and they pull opposite ways. **The message is excellent** — the
[#59](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/59) fix from round 3 named the
brush instead of returning a bare `0`, and the diagnosis took one read where round 3 spent a whole
hypothesis. **The situation is not**: the toolkit's finishing tool and its checking tool disagree
about the same doorway, and the map lost a correct detail — I deleted the sill to get a green.
That is round 1's finding 5 again (*the shop's furniture was dictated by an implementation detail
of the watershed*), now with both tools inside this repository.

Together with §2 this is a pattern rather than two accidents: **`write_vmf_fitting` was added
because maps looked unbuilt, and twice in one map it produced geometry `check_vmf_rules` could not
read.** Nothing in either tool knows about the other.

## 4 · A door buried to its waist passed every check there is — **gap**

`prop_door_rotating` at `origin z 0`, on a floor at `z 0`. `read_model_info` on the model it
carries:

```
models/props_c17/door01_left.mdl   mins [-5.996, -1.25, -54.25]   maxs [5.996, 47.25, 54.25]
```

The origin is at the model's **centre**. Half the door was underground.

`read_vmf_lint` clean · `validate_io` clean · `check_vmf_rules` `pass` · vbsp, vvis and vrad all
exit 0 · `read_leak` no pointfile · `render_vmf_tour` seven frames, **the door in none of them**,
because nothing offline draws a model.

`read_model_info` says the thing outright in its own description — *"a prop placed at a floor's
height sinks by however far its origin sits above its lowest point, and nothing downstream reports
that"*. This round is the concrete case: a known gap, unmitigated, and the *only* reason it was
caught is that I went looking for why the door was absent from the tour.

The cheap fix is a lint rule: for every point entity with a `model`, read the model's bounds and
report an origin whose `z` puts the model's minimum below the nearest floor. `read_vmf_lint`
already has the sidecar, the FGD and `read_model_info` beside it.

## 5 · `read_game_content` lists a material whose textures do not exist — **bug**

The tool exists, in its own words, so that *"a wrong one is a purple checkerboard nobody sees until
a player loads the map"*. It reported `NATURE/BLENDGRASSDIRT01` as present. After compiling,
`read_map_dependencies`:

```
missing: materials/nature/forest_grass_01.vtf     <- materials/nature/blendgrassdirt01.vmt
         materials/nature/forest_dirt_02.vtf      <- materials/nature/blendgrassdirt01.vmt
         materials/nature/blendtexture01.vtf      <- materials/nature/blendgrassdirt01.vmt
```

The `.vmt` ships with Garry's Mod. Its three `.vtf` do not. The garden ground would have been a
checkerboard, and the browser whose purpose is to prevent exactly that said it was fine.

`read_map_dependencies` already walks VMT chains to the `.vtf` and resolves them against the same
mount. `read_game_content` resolves one level and stops — which its `details` flag does not fix
either, since that reads the `.vmt` for its base texture name without checking the file is there.

Sharpened by *where* it bites: **blend materials are terrain materials**, mostly from HL2 forest
content Garry's Mod ships only half of. No interior map would ever have met this, which is why five
rounds took to find it.

## 6 · The renderers cannot show the two things this map exists to have — **gap**

The look-at-it step is the round-4 addition and the one that catches what no check can. On this map
it is blind twice.

**Terrain.** `render_vmf_view`: *"4 displacement brush(es) are not drawn: their flat quad is not
the surface the game builds, so drawing it would show terrain that does not exist."* Correct, and
honest — and it means every displacement in a map is invisible to the only tool that looks. It also
made my first reading of the tour wrong: I wrote that the terrain *"reads as dead flat"*, when it
was not drawn at all.

**Sky.** `skyFraction: 0` in all seven tour frames, and again in a hand-aimed view whose top third
is `toolsskybox`. Whatever that field counts, it is not what a mapper means by *how much sky do I
see* — and on a map whose whole argument is that it has a dehors, that is the question.

Both are gaps, not bugs: nothing claims to do either. They are here because §4 is what happens when
the looking step has holes in it, and this map has three of them at once — no props, no terrain, no
sky.

---

## The three unwritable requirements, as predicted

The brief named three sentences with no form in the rules schema, and building the map confirmed
all three. Kept as a finding about the **schema**, per the protocol:

1. *the garden is open to the sky* — no check reads a `toolsskybox` face;
2. *with the door shut, the garden is not visible from the kitchen* — the tracer sees neither props
   nor brush entities, so the rules can only describe the map with every door removed;
3. *the house is watertight seen from outside* — `read_vmf_leak` answers it and no rule can.

To which building it added a fourth, which the brief did not foresee: **a doorway 64 units wide,
as the brief requires, cannot be filled by the 48-unit leaf the fittings table measures.** The
garden door is 80 wide with a 48 leaf hinged on its west jamb, and 33 units of it stand open. Two
numbers in the same toolkit, both correct, that do not fit the same hole — and nothing relates them.

## What the map is

Sealed, `overall: "pass"` at the default `step`, vbsp/vvis/vrad all 0, no pointfile, no missing
asset. 71 brushes, 11 entities, 3 rooms — living room 28.6 m², kitchen 22.8 m², garden 85.4 m² —
two 80-unit doorways, four displacements sewn with no seam, one working light switch, and a
`prop_door_rotating` that no tool in this repository can look at.

## The findings, sorted — and what happened to them

All seven issues were raised and all seven are closed, 15/08/2026, each with a test seen red
first.

| | Class | Issue | What landed |
|---|---|---|---|
| 1 · `mask: "sight"` is opaque to glass | **bug** | [#73](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/73) | a see-through class in `maskFor`, the mirror of a clip brush. It needs **every** face to agree, unlike the others: a window frame glazed on its reveal is a wall |
| 2 · one pocket sets the merge bar for the whole map | **bug** | [#74](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/74) | the peak is carried through the union, and the criterion gets the one cell of slack the broken bookkeeping was supplying. **This closed #48 and #53 too** |
| 3 · `door_frame`'s threshold defeats `check_vmf_rules` | **bug** | [#75](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/75) | the floor is found by sweeping the hull, not tracing a ray. A body stands on what its footprint hits |
| 4 · a prop sunk by its own origin passes everything | **gap** | [#76](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/76) | a `prop-below-floor` lint rule: the sidecar returns the model bounds, this side finds the floor |
| 5 · `read_game_content` does not resolve a material's textures | **bug** | [#77](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/77) | `details` now walks every texture parameter and reports `resolves` with what is missing |
| 6a · `skyFraction` reads 0 in a frame that is a third sky | **bug** | [#78](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/78) | it counts sky faces; the old number kept its meaning as `voidFraction` |
| 6b · no renderer draws terrain | **gap** | [#79](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/79) | displacement grids are triangulated from their own vertices and rasterised |

Six findings, five of them reachable only from a map with an outside. The other reading is the one
in the table at the top: **the toolkit no longer fails**, and every hour of this session went on
the map's problems or on the toolkit's *judgement*, never on its plumbing.


## What the second finding turned out to be worth

Finding 2 was written up here as "the sharpest statement yet of #48/#60". It was better than
that: it was the **cause**.

`peak` is indexed by union-find root, and the union points the larger id at the smaller — so a
merged region inherited whichever peak had the lower id, for the rest of that pass. Everything
three rounds had recorded as separate symptoms is that one line:

- **round 1** — the segmentation varies with cell *order*. It varies with cell *index*, which
  is the same thing seen through the union-find.
- **round 2** — it varies with cell *size*, non-monotonically. Which `step` worked was a fact
  about which ids the cells happened to get. `hmcp_bodega` went from working at 32 and nowhere
  else to monotone and right at the default. That was
  [#53](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/53), and it cost round 2
  most of its session.
- **round 3** — geometry 200 units away destroys a doorway. A pocket anywhere lowered the bar
  everywhere.
- **round 5** — a counter at the depth of its own table. Same pocket, same bar.

`test/watershed.test.ts` had pinned it since round 1 with two `it.fails` and a prediction: the
one-line repair turns them green and breaks sixteen assertions, because the criterion had been
calibrated against peaks that shrink. **That prediction was exact — sixteen, measured.** It
also named where the real fix had to land, and it was right about that too. Both `it.fails`
are now `it`.

The lesson is about the method rather than the code. Round 1 could not have fixed this: it had
the symptom and no mechanism. What made it possible was five accounts of the same defect from
five different angles, plus a test that refused to go green on the wrong answer.
