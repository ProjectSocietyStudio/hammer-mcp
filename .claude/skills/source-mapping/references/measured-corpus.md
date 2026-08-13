# Figures measured on production maps

The rest of this skill distinguishes `[engine]`, `[consensus]` and `[disputed]`. This page adds the
fourth mark, `[measured]`: numbers we took ourselves, on real maps, with `hammer-mcp`.

**Corpus**: three urban Garry's Mod roleplay maps by the mapper **Fishke**, measured 11/08/2026 on
the compiled `.bsp` extracted from the Workshop — `rp_unioncity` (2018, 0.78 GB), `rp_southside`
(2020, 1.03 GB), `rp_nycity` (2022, 1.14 GB). No source `.vmf`.

These figures were **attacked before they were written**: an adversarial pass tried to refute every
regularity. What follows is what survived. What fell is here too, further down — it is the most
useful part of the page. A second wave of measurements, taken after that pass with readers that did
not exist yet, corrected one dated fact (HDR, below) and added one figure (diagonal planes) without
changing any already written.

**The audit dossier these numbers come from is in this repository**, under
[`docs/audits/fishke/`](../../../../docs/audits/fishke/README.md): the raw readings, the analyses,
the adversarial pass and the reconstruction of the author's method. What is on this page is what
survived, together with what fell — the dossier carries the full reasoning. A figure that looks
doubtful to you may well be: every line here says how many maps it holds on, and the dossier says
how it was taken.

## The two warnings everything else depends on

⚠️ **A "per hectare" density is normalised by the `worldspawn` bounding box**, which includes the 3D
skybox and all the empty space. It is a **floor**, never a real street density. Any comparison
against your own map must redo the same biased calculation the same way, or it means nothing.

⚠️ **`prop_static` is measurable by no shipped `hammer-mcp` tool on a compiled `.bsp`**: it lives in
the `GAME_LUMP`, which `read_prop_survey` does not read. That is no longer a limit of principle —
the readers written since (`read_materials`, `read_lightmap_budget`, `read_visleaf_stats`) prove an
extra non-entity lump reader is writable without great effort, and a dependency walker now reads the
`GAME_LUMP` through srctools, returning **861 static models** on `rp_nycity_day` `[measured]`. But
`read_prop_survey` itself still returns zero without saying so. On an urban map, `prop_static` is
probably most of the scenery. **No static/dynamic ratio on this page is complete**, and none can be
until that reader is fixed.

## The figures that hold

| Figure | Value | Scope |
|---|---|---|
| Lump 0 entities vs `MAX_EDICTS` (2048) | 165% · 250% · 209% | a serious urban map **exceeds the stock runtime ceiling on its own**, before any player or addon `[measured]` |
| `MAX_MAP_MODELS` (1024) | exceeded on one map only: 1217 (118.8%) | a stock compiler would have refused that map `[measured]` |
| `MAX_MAP_LIGHTING` (16 MiB) | exceeded on **all three**: 158.6% · 298.2% · 201.3% | a detailed urban map leaves the stock lighting envelope **before** it runs out of models `[measured]` — corrected on the evening of 11/08/2026, see "what fell" |
| Diagonal cut, measured effect | 4 → 8 clusters with an axial hint, → 10 with a diagonal one, in the same room | a diagonal hint is not an axial hint rotated: it subdivides **more** `[measured]` on a test room, n=1 |
| Strict door density | 5.44 · 9.14 · 9.73 per ha | `func_door` + `func_door_rotating` + `prop_door_rotating`, `func_movelinear` excluded. A +68% jump, then a plateau at +6% `[measured]` |
| Door type used | `func_door` / `func_door_rotating` dominate throughout | 273 vs 24, then 552 vs 0, then 622 vs 0. `prop_door_rotating` is an abandoned experiment `[measured]` |
| `AREAS`, `AREAPORTALS`, `WORLDLIGHTS` | all below 40% of their ceiling, on all three | these lumps **never** constrain an urban map `[measured]` — ⚠️ do not read that as "no visibility optimisation", see the next line |
| Diagonal planes used as BSP splitters | 1.50× · 1.71× · 1.71× their availability, against 0.02× and 0.11× on two controls | Fishke's real visibility lever — hints placed diagonally, not areaportals `[measured]`, one comparable urban control |
| Material reuse between maps (inherited prefix) | 0% → 39% → 78% of materials, 0% → 67% → 89% of usage | a personal library built and reused, not rebuilt for each map `[measured]` |
| Luxels/ha | 68,161 → 80,709 → 99,609, +46% across three maps | a growing lighting budget, **not dependent on HDR** (absent from the most recent map, see below) `[measured]` |
| Pakfile share | 85.7% to 94.0% of the `.bsp` | on a map that embeds its content, geometry is a minority of the file `[measured]` |
| Visleaf split vs urban control | 1.3–1.6× denser (278 → 371–456 leaves/ha), against 4–6× versus a non-urban control | **do not mistake this for an authorial trait** — the gap is mostly the map genre |

**What this changes in practice.** The first figure is the most useful of the set: it says a map of
this size is **impossible** under a stock Source engine, and exists only because Garry's Mod raises
the edict ceiling. Any ambitious urban map has to account for that during scoping, not discover it
on first load.

The lump that saturates **is not the same from one map to the next**: `BRUSHES` at 97.9% on one,
`LEAFBRUSHES` at 99.8% and `MODELS` at 98.4% on the second, `MODELS` at 118.8% and `TEXINFO` at
95.8% on the third. Watching one lump would miss the other cases — read `read_map_geometry` whole,
not a line of it.

## A dated fact corrected on 11/08/2026: no HDR on the most recent map

`rp_nycity` (2022) is compiled **without HDR** — the `LIGHTING_HDR`, `WORLDLIGHTS_HDR` and
`FACES_HDR` lumps are absent, where the two earlier maps have them. The opposite belief came from an
earlier reader that wrongly named lump 56, `LEAF_AMBIENT_LIGHTING` (non-empty on all three maps),
"LIGHTING_HDR". `[measured]` — a tool naming error, not bad data upstream; the upstream audit
documents were corrected accordingly.

Note that lump 55, `LEAF_AMBIENT_LIGHTING_HDR`, whose name ends in `HDR`, is also non-empty on an
LDR map. Neither ambient lump can answer the HDR question; only 53, 54 and 58 can, which is what
`read_bsp_info`'s `hdrLighting` reads.

## What fell, and why that is the most instructive part

| Attractive claim | Why it does not hold |
|---|---|
| "The compiler change dates to between 2020 and 2022" | The 2020 map is at 98.4% of the `MODELS` ceiling — compatible with a stock compiler **as much as** with an already-modified one. The dating was an inference dressed as a finding. **Follow-up, evening of 11/08/2026**: the same map is at 298% of `MAX_MAP_LIGHTING`, so it was already outside the stock envelope. The dating stays wrong, but in the other direction — the change is at or before that map, not after |
| "`MODELS` is the only ceiling exceeded in the corpus" | False, and instructive about how one goes wrong: it was the only ceiling the tool could **evaluate**. Limits were applied only to lumps whose record size is known, and `MAX_MAP_LIGHTING` counts bytes. The number had been in the readings since day one. A tool that does not measure something and an object that does not do it look too much alike |
| "Fishke methodically builds right up against the ceilings" | The "near the limit" threshold is the tool's own: the claim recycled the instrument's definition as though it were a signal. And the real spread is wide — 80.4% to 96.0% depending on the map |
| "The lights-to-doors ratio is stable, it is a detail rhythm" | Three points, 22% between min and max, and the two underlying series diverge. A fourth point would very probably blow the ratio apart |
| "The city opens up across the maps" | The maximum sightline is an **extreme** statistic: one pair of points out of hundreds of thousands tested. A corridor getting longer says nothing about general openness. No median was taken |

⚠️ **Three points do not make a trend.** That is the general lesson of this audit: on a corpus of
three, a monotonic progression has a fair probability of being noise, and a causal explanation is
almost never testable against the trivial alternative "the map is bigger".

## Two delivery facts

- One map's nav mesh is **current**: the BSP size recorded in the `.nav` matches the shipped `.bsp`
  exactly `[measured]`.
- Its lighting variant's nav mesh is **orphaned**: the recorded size matches no `.bsp` in the
  archive, by 11.7 MiB `[measured]`. A recognised mapper therefore ships a nav mesh that goes with
  nothing they deliver — checking `read_nav` before picking up a third-party map is not a
  theoretical precaution.

## What this corpus will never say

These maps are compiled. The structural/`func_detail` split, the hints, the visgroups, the per-face
lightmap scale were all destroyed by vbsp. **We measure what Fishke shipped, not what he did.** The
quality of his visibility split — probably the most interesting thing to learn from him — stays out
of reach without loading the maps in the engine.

For what the tooling can and cannot measure, see
[tooling-coverage.md](tooling-coverage.md).
