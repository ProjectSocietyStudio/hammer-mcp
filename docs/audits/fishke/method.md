# Fishke's method — what holds, and what does not

A synthesis of **method**, distinct from the raw readings (`reading-*.md`) and from the numeric
trajectory (`longitudinal-synthesis.md`). Sources: `longitudinal-synthesis.md` §5,
`comparatif-lumps.md` (three fresh readers on the compiled BSPs), `adversarial-pass.md` (what
survived an attack). Four traits hold, one expected trait does not — and that is the most important
of the five to write down honestly.

> ⚠️ **`comparatif-lumps.md` is not in this dossier and never was.** Four figures below cite it as
> their source: the material-reuse series, the luxel series, the diagonal-splitter ratio and the
> visleaf table. They are reproduced here as they were written, but the reading that carries them
> was never committed anywhere — treat them as unsourced until a reader reproduces them.

## What holds

### 1. A material library reused, not rebuilt

The count of distinct materials falls from one map to the next (1,723 → 1,680 → 1,411) while the map
grows (54.6 → 63.9 ha): materials per hectare drops from 31.6 to 22.1 (−30%). Reuse
(texinfo per material) rises in parallel: 6.80 → 6.80 → 8.34. And the reuse is not only internal to
each map: the cross-map weight (prefix `UNIONCITY*`) goes from 0% (2018, nothing to inherit) to 39%
of materials / 67% of usage (2020) then 78% of materials / **89% of usage** (2022). `[measured]` —
`comparatif-lumps.md` §3-4.

Fishke does not start from a blank sheet on each map: he builds a personal library
(`UNIONCITY` → `UNIONCITY2` → `UNIONCITY3`) and lets it carry most of the texture placement on the
next one.

### 2. A lighting budget that grows without depending on HDR

Luxels per hectare rise strictly across the three maps: 68,161 → 80,709 → 99,609 (+18% then +23%).
Luxels per lit face follows: 136.1 → 151.6 → 206.7. `[measured]` — `comparatif-lumps.md` §2.

⚠️ **Correction of an earlier fact**: `rp_nycity` (2022) is compiled **without HDR** — lumps 53
(`LIGHTING_HDR`), 54 (`WORLDLIGHTS_HDR`) and 58 (`FACES_HDR`) are absent from it, where
`rp_unioncity` and `rp_southside` have them. The opposite belief came from an earlier reader that
wrongly named lump 56 (`LEAF_AMBIENT_LIGHTING`, non-empty on all three maps) "LIGHTING_HDR".
`[measured]`, corrects `longitudinal-synthesis.md` §1. So the growth in luxel budget holds *without*
HDR on the most recent map — a growing lightmap budget counts for more than the rendering mode in
perceived density.

### 3. Forced diagonal cuts, a real visibility lever

On all three maps, the diagonal planes **available** in the geometry (5–6%) are used as **BSP
splitters** at 1.50–1.71× their availability — the signature of hints laid down diagonally, not a
mechanical effect of the geometry. An urban control by another author (`rp_pinescity_v2b`) has just
as many diagonals available (6.36%) but a ratio of 0.02×: it almost never lets them cut.
`[measured]` — `longitudinal-synthesis.md` §5. ⚠️ A single comparable urban control.

This is the point that corrects `longitudinal-synthesis.md` §2: the finding "areaportals always
below 40%" did not mean "no visibility optimisation", it meant "not *that* optimisation". Fishke's
lever is the diagonal hint, not the areaportal.

### 4. A city built in props, not in brushwork

Three signs converge, none sufficient on its own:

- point-entity props collapse on `nycity` (481 → 170, −65%) while the map grows and doors and lights
  keep rising `[measured]` — compatible with a conversion to `prop_static`, invisible to every
  current `hammer-mcp` tool (GAME_LUMP unread, see the warning in `measured-corpus.md`);
- the `.vhv` files (an indirect proxy for light baked per static prop, never a count) also fall
  (7,656 → 3,991) `[measured]`, which argues against a plain 1:1 reconversion;
- in game on `rp_nycity_day`, in wireframe, the props (cyan) visually swamp the world geometry
  (red) — a visual observation, **not a measurement**.

None of the three settles the exact cause of the drop in the point-entity count on its own
(`longitudinal-synthesis.md` §4 already says so and does not conclude), but together they sketch a
method: little structural brush geometry, a great deal of dressing in models — coherent with §3
(little need for areaportals on a simple brush shell, cutting planes worked because the little
brushwork that remains still has to be split well).

## What does not hold

### The visibility split is no finer than an urban control's

The starting hypothesis was that Fishke, working dense urban, would push his visleaf split (LEAFS)
further than another mapper of the same genre. The measurement says the opposite:

| | unioncity | southside | nycity | pinescity (urban control) | gm_construct (non-urban control) |
|---|---|---|---|---|---|
| Leaves/ha | 416.7 | 455.7 | 370.6 | **278.4** | 80.8 |
| Clusters/ha | 152.2 | 184.2 | 124.8 | **106.8** | 10.9 |
| Leaves/cluster | 2.74 | 2.47 | 2.97 | 2.61 | 7.40 |

`[measured]` — `comparatif-lumps.md` §1. Fishke is far ahead of the *non*-urban control (4–6×), but
only 1.3–1.6× ahead of another author's urban control — and Fishke's leaves-per-cluster ratio
(2.47–2.97) is of the same order as `pinescity`'s (2.61), a long way from `gm_construct` (7.40).
**The reading that holds**: it is the compartmented urban style that produces this fine split, not
Fishke's hand in particular. What really separates Fishke from the urban control is not the
fineness of the visleaf split, it is the diagonal-hint lever (trait 3) and the luxel budget
(trait 2) — two axes measured separately, not conflated with visleaf density.

This is the most important point on this page to write honestly: the audit's starting hypothesis
("his visibility split is the most interesting thing to learn from him") does not survive the
comparison as stated — what survives is more precise, but less spectacular.

## What to take from it for your own map

- **Build a material library from the first map addon and make it last.** Fishke's cross-map reuse
  goes from 0% to 78% of materials (89% of usage) in two iterations — a choice that compounded, not
  an emergency shortcut.
- **Do not read "areaportals under 40%" as "no visibility optimisation" in a map review.** Check
  `read_map_geometry` whole (the number of planes used as splitters, not only `AREAPORTALS`) before
  concluding a map did no visibility work — that is exactly the mistake
  `longitudinal-synthesis.md` made and then corrected in §5.
- **Lay diagonal hints along oblique corridors, not only axis by axis.** Fishke's usage ratio of
  1.5–1.7× against 0.02–0.11× for the two controls shows it does not happen by itself: it is a
  deliberate gesture on each map, not a by-product of the geometry. ⚠️ Verified against a single
  comparable urban control; do not generalise further.
- **Do not treat HDR as a precondition for a good lighting budget.** `rp_nycity` climbs to
  99,609 luxels/ha (+46% over `unioncity`) with no HDR compile: the lightmap budget is the lever
  that counts, not the rendering mode.
- **Do not mistake urban style for the author's hand when comparing a visibility split.** Fishke is
  only 1.3–1.6× denser in visleaves than a third-party urban control (278 → 371–456 leaves/ha), far
  from the gap against a non-urban control (4–6×) — without a control of the same genre, Fishke
  would have been credited with merit that belongs to the map genre.
