# Longitudinal synthesis — three Fishke maps (2018 → 2022)

> ⚠️ **This document was contradicted after it was written, then revised twice.** Two of its claims
> are refuted and six are judged fragile: read [adversarial-pass.md](adversarial-pass.md) **before**
> taking any figure from here. A second wave of measurements (§5, dated 11/08/2026) corrects §2's
> reading of "visibility optimisation" — not less optimisation, a different lever. A **third**, on
> the evening of 11/08/2026, corrects §4: `MODELS` was not the corpus's only exceeded ceiling, all
> three maps also exceed `MAX_MAP_LIGHTING`, and the data had been in our own readings from day one.
> What survived the passes is consolidated in [`method.md`](method.md) (the author's method) and in
> `measured-corpus.md` of the `source-mapping` skill (reference points for our own maps).

Sources: `reading-*.md` (authoritative on the figures) and `analysis-*.md` (interpretations, taken
with care). Every density is normalised by the XY bounding-box extent measured by
`read_map_extents` (an upper bound on real playable area for all three maps — no tool separates
built area from 3D skybox on a compiled .bsp, and the caveat holds for all three).

## 1. Comparative table

| Quantity | `rp_unioncity` (2018) | `rp_southside` (2020) | `rp_nycity` (2022) |
|---|---|---|---|
| File size | 782.45 MB | 1032.14 MB | 1142.85 MB |
| XY bbox extent | 545,565 m² (54.56 ha) | 603,776 m² (60.38 ha) | 639,338 m² (63.93 ha) |
| Max horizontal span | 755.4 m | 780.3 m | 802.6 m |
| Total entities (lump 0) | 3,388 | 5,122 | 4,287 |
| — density per ha | 62.1 | 84.8 | 67.1 |
| — vs MAX_EDICTS (2048) | 165.4% | **250.0%** | 209.3% |
| Strict doors (func_door + func_door_rotating + prop_door_rotating, movelinear excluded) | 297 | 552 | 622 |
| — density per ha | 5.44 | 9.14 | 9.73 |
| Lights (light + light_spot + dynamic + environment) | 1,159 | 1,759–1,761 | 2,106 |
| — density per ha | 21.2 | 29.1 | 32.9 |
| Point-entity props (`propTotal`, dynamic + physics (+ door_rotating)) | 372 | 481 | 170 |
| — density per ha | 6.82 | 7.97 | **2.66** |
| `.vhv` files (static-lighting proxy, not a count) | 7,426 | 7,656 | 3,991 |
| Cubemaps (lump, samples) | 361 | 239 | 168 |
| — density per ha | 6.62 | 3.96 | 2.63 |
| Pakfile (real content) | 664.8 MB / 18,028 files | 841.1 MB / 17,942 files | 1023.7 MB / 15,135 files |
| — % of file size | 89.4% (lump) | 85.7% (lump) | 94.1% (lump) |
| — MB/ha | 12.19 | 13.93 | 16.01 |
| Max sightline | 403.4 m | 712.9 m | 769.1 m |
| — % of max span | 53.4% | 91.4% | 95.8% |
| MODELS (lump, fraction of the 1024 ceiling) | 52.2% (535) | 98.4% (1008) | **118.8% (1217, exceeded)** |
| Lumps at ≥ 80% of their ceiling (count) | 7 | 6 | 4 (1 of them exceeded) |

## 2. Fishke's constants

- **TEXINFO consistently above 93%** (95.3% / 93.0% / 95.8%). Across three maps of growing size, the
  number of distinct texture/UV combinations stays wedged just under the compiler ceiling: Fishke
  works with a material budget he pushes to the limit every time rather than one he under-uses and
  then fills. Stable, so method rather than chance.
- **VERTEXES and BRUSHES always ≥ 80%** (80.4/96.0/94.8% and 97.9/91.4/84.6%). Same reading: the
  brush geometry is built right up against the `vbsp` ceiling, whatever the extent. It is a
  constraint he knows and exploits systematically, not a side effect of one particular map.
- **One `sky_camera` per map**, one `light_environment` (a single sun): constant scene discipline,
  none of the three maps multiplies suns or skybox cameras.
- **AREAS/AREAPORTALS/WORLDLIGHTS/TEXDATA_STRING_TABLE always below 40%**: Fishke never pushes
  visibility optimisation (areaportals) or the baked dynamic-light budget near their ceiling, on any
  of the three maps — that is not the axis on which he works his margin.
- **`func_door`/`func_door_rotating` always dominant over `prop_*` doors**: the brush entity remains
  the main door vector on all three maps; `prop_door_rotating` (24 on `unioncity`, 0 elsewhere) was
  never the dominant mode, only an isolated experiment (§4).
- **Lights-to-doors ratio stable around 3.2–3.9** (1159/297 = 3.90; 1759/552 = 3.19;
  2106/622 = 3.39): whatever the scale, Fishke lights each block roughly in the same proportion as
  he cuts doors into it — the signature of a constant detail rhythm rather than a disproportionate
  densification of one aspect.

## 3. The trajectory — what drifts from 2018 to 2022

- **Lights: 21.2 → 29.1 → 32.9 per ha, monotonic.** Continuous, regular progression (+37% then
  +13%). Hypothesis: acquired technique — lighting more finely costs little once the method is
  practised (all three maps bake nearly 100% of their static sources into WORLDLIGHTS, the
  measured-to-baked gap is marginal every time), so Fishke simply adds more with each iteration.
- **Strict doors: 5.44 → 9.14 → 9.73 per ha.** A sharp jump (+68%) then near-stagnation (+6%) —
  covered in detail in §4; it is not a smooth monotonic line.
- **Pakfile weight per hectare: 12.19 → 13.93 → 16.01 MB/ha, monotonic**, while the number of
  embedded files *falls* (18,028 → 17,942 → 15,135). Each file weighs more on average with each map
  (more and longer uncompressed music, larger textures). Hypothesis: a change in aesthetic and sonic
  ambition rather than a technical constraint — Fishke has the means (download bandwidth, disk) to
  embed heavier content and does.
- **Max sightline / span: 53.4% → 91.4% → 95.8%, monotonic.** Covered in detail in §4.
- **Point-entity props per ha: 6.82 → 7.97 → 2.66, non-monotonic** (peak then fall) — this is really
  a break, not a smooth trajectory; see §4.

## 4. The breaks

> ⚠️ **This section was corrected on the evening of 11/08/2026. The original version, kept below,
> claimed `MODELS` was the corpus's only exceeded ceiling. That is false, and the data refuting it
> had been in our own readings from the start — nobody had compared it against its ceiling.**

**All three maps exceed `MAX_MAP_LIGHTING`.** Measured again on 11/08/2026, on the three `.bsp`,
with tooling corrected since (the lump-name table used for the readings confused lump 56 with
`LIGHTING_HDR`):

| Map | `LIGHTING` (lump 8) | vs `MAX_MAP_LIGHTING` = 16 MiB | HDR (53/54/58) |
|---|---|---|---|
| `unioncity` | 26,612,388 B (25.4 MiB) | **158.6%** | present |
| `southside` | 50,034,400 B (47.7 MiB) | **298.2%** | present |
| `nycity` | 33,779,412 B (32.2 MiB) | **201.3%** | **absent** |

Two consequences, and the second overturns a conclusion this document had retracted.

**`MODELS` is not the only overrun** — it was only the one the tool of the day could evaluate.
Ceilings were applied only to lumps whose record size is known, and `MAX_MAP_LIGHTING` counts bytes.
The figure was asleep in the readings.

**`southside` was already outside the stock envelope.** The adversarial pass demolished the dating
"after southside, before nycity" on the grounds that 98.4% of `MODELS` is compatible with a stock
compiler. That was right about `MODELS`. It is not right about `LIGHTING`: at 298%, `southside` is
the corpus map that exceeds **most** plainly, and a stock vrad would have refused to write it. So
the tool change is **at or before `southside`**, not after.

⚠️ A competing explanation is not ruled out: **the compilers shipped with Garry's Mod may already
raise these ceilings**, in which case the three maps prove nothing about Fishke's *personal* tools.
Nothing here settles the two, and checking it means compiling a control map past 16 MiB with the
game's own vrad. That is doable and was not done.

<details><summary>The original version, wrong, kept</summary>

**The MODELS ceiling only gives way between `southside` and `nycity`.** `unioncity` (52.2%) and
`southside` (98.4%, but still *under* the limit) stay inside the SDK 2013 stock envelope; no other
lump, on any of the three maps, ever passes 100% of its compiler ceiling — MODELS on `nycity`
(118.8%, 1217/1024) is the **only** overrun observed in the whole corpus. Southside already grazes
the wall (1008/1024, a margin of 16 models) without crossing it: so Fishke changed compile tools
*after* `southside` and *before* `nycity` — dated by elimination on these two maps; a stock compiler
would have refused `nycity` as it stands.

</details>

**Point-entity props collapse on `nycity` (481 → 170, −65%) while the map grows (+6%) and the count
of doors and lights keeps rising.** Two readings, neither settled by measurement alone: (a) a
conversion of `prop_dynamic` furniture to `prop_static` (free in edicts) made possible by the new
compiler — but the `.vhv` files (an indirect sign, not a count, of light baked per static prop) fall
*too* (7,656 → 3,991), which argues against a plain 1:1 reconversion; (b) a real cut in decorative
furniture in favour of the budget spent on doors, buttons and brushes (626+183+25 interactive
elements on `nycity`, against 481 props). Both readings are compatible with the figures; neither is
proved.

**The lump 0 entity total peaks on `southside` (5122, 250% of MAX_EDICTS) then falls back on
`nycity` (4287, 209%)**, despite a larger map. That is the same break seen from another angle:
`southside` is the corpus's point-entity over-fill point, and `nycity` partially corrects — without
ever going back under the stock runtime ceiling.

**`prop_door_rotating` disappears after `unioncity`** (24 → 0 → 0), on a single model
(`door_interior_112_01.mdl`). Contrary to what the initial lead suggested, it is **not** the engine
of the door densification: the 24 `prop_door_rotating` account for only 8% of unioncity's total
(297), and their disappearance on `southside` does not stop the density doubling anyway (5.44 →
9.14 per ha, strict doors excluding movelinear and excluding prop_door_rotating on both sides). It
is a one-off, minor change of method (abandoning a technique tried once), separate from the real
densification, which comes from `func_door`/`func_door_rotating`.

**Door density densifies hard once (2018→2020, +68%) then nearly plateaus (2020→2022, +6%) —
settled in favour of "densification then plateau", not a definition artefact.** The computation is
redone under a strictly identical definition on all three maps (`func_door` +
`func_door_rotating` + `prop_door_rotating`, `func_movelinear` excluded throughout, including on
`southside`/`nycity` where the original analysis had wrongly included it despite `GTarget1/2` names
and shooting-range targets that are not doors). The gap this correction introduces is negligible
(554→552, 626→622): the plateau is real, not a counting artefact.

**The max sightline climbs from 53% to 96% of the span — the sampling parameters are comparable, so
it is not a tooling artefact.** `spacing=512`, `eyeHeight=64`, `elevationTolerance=512`,
`requireNearbyContent=true` across the three readings; only `limit` differs (15/15/20), which
affects only the length of the returned list, not the maximum value. On all three maps, the longest
line is in fact a single corridor measured several times (the same X/Y bounds repeated in the top
15–20) — the measurement phenomenon is structurally identical on all three. Only its proportion of
the span changes, so it is a real growing urban openness from one map to the next, not a sampling
bias.

## 5. Revision of 11/08/2026 — a different lever, not less optimisation

Three measurements taken after this document was written, with readers that did not yet exist when
§1–§4 were, force a revision of §2's reading of visibility optimisation. **The document is not
erased**: what follows says what was written, why it seemed true, and what changed.

### What §2 said

> "AREAS/AREAPORTALS/WORLDLIGHTS/TEXDATA_STRING_TABLE always below 40%: Fishke never pushes
> visibility optimisation (areaportals) or the baked dynamic-light budget near their ceiling, on any
> of the three maps — that is not the axis on which he works his margin."

The figure (< 40%, holds, see `adversarial-pass.md`) was read as "he does not optimise visibility".
That was true of the *mechanism* measured (areaportals), false as a *conclusion* generalised to all
visibility optimisation — because another mechanism, unmeasured at the time, was outside the reach
of the available readers.

### The new measurement: diagonal cutting planes

Classification of the planes **actually used as BSP tree splitters**, diagonal planes available vs
diagonal planes actually chosen as separators:

| Map | diagonals available | used as splitters | ratio |
|---|---|---|---|
| rp_unioncity | 6.13% | 9.22% | 1.50× |
| rp_southside | 5.03% | 8.61% | 1.71× |
| rp_nycity | 5.74% | 9.79% | 1.71× |
| rp_pinescity_v2b (urban control, another author) | 6.36% | 0.11% | 0.02× |
| gm_construct (non-urban control) | 3.52% | 0.38% | 0.11× |

Across Fishke's three maps the ratio is **stable around 1.5–1.7×** — not a trend; what counts here
is that it is present on all three and absent from both controls. The urban control by another
author (`pinescity`) has just as many diagonals *available* (6.36%, comparable to Fishke's 5–6%) but
almost never lets them cut (0.02×): the difference is not the starting geometry, it is the choice to
lay hints diagonally to force the splitter to use them. ⚠️ A single comparable urban control — the
finding holds on this corpus, not beyond.

### Corrected reading

**Fishke did not optimise visibility less, he changed lever.** Areaportals stay under 40% on all
three maps (constant, not decreasing — see `adversarial-pass.md`, where the claim "holds"), but the
forced use of diagonal planes as BSP splitters is present and stable across all three corpus maps.
Fishke's visibility lever is the **deliberately laid diagonal hint**, not the areaportal — a reading
that extends §2 rather than cancelling it: the finding "areaportals under 40%" stays true, only the
inference drawn from it ("no optimisation") falls.

This correction is consistent with an in-game observation on `rp_nycity_day` (visual, not a
measurement): in wireframe, the props (cyan) largely swamp the world geometry (red) — the city is
built in models, not in brushwork. A relatively simple brush shell, finely split by diagonal hints,
carries streets dressed in props: that explains why Fishke's visibility lever needs no dense
areaportal mesh (few brush volumes to separate) while still demanding a careful BSP split (many
visible faces, carried by few brushes). See `method.md` for the method synthesis and the refuted
trait that goes with it (a visleaf split no finer than an urban control's).

A third measurement, unrelated to visibility optimisation but taken in the same batch, corrects one
point of fact in §1: `rp_nycity` **has no HDR compile** (lumps 53 `LIGHTING_HDR`, 54
`WORLDLIGHTS_HDR` and 58 `FACES_HDR` absent), where `rp_unioncity` and `rp_southside` do. The
opposite belief came from an earlier reader that wrongly named lump 56 (`LEAF_AMBIENT_LIGHTING`,
always non-empty on the three maps) "LIGHTING_HDR" — a tool naming error, not a measurement. So §3's
growing luxels-per-hectare budget (68,161 → 80,709 → 99,609) climbs *despite* HDR being dropped on
the most recent map, which makes the growth more notable, not less real.

## What stays unconcluded

The `prop_static` count (GAME_LUMP) is absent from all three readings — no available tool exposes
it; `.vhv` files are an indirect sign of it, never a figure. The exact cause of the point-entity
prop drop on `nycity` (technical conversion vs artistic choice) cannot be settled by measurement
alone. The exact content of the 3D skybox inside each map's bbox (its real share of the playable
extent) is measurable by no tool on a compiled .bsp — so every density in this document remains a
floor, not an exact street-density value.
