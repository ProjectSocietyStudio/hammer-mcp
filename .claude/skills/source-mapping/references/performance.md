# Client and server performance

What costs frames per second and what costs milliseconds of server tick are two separate subjects —
one is measured in game on a client, the other across the 60-plus connected players. **Visibility**
(VIS, areaportals, hints, occluders) outranks everything else here: it decides whether a thing is
drawn at all, before you get to ask what it costs. Detail: [visibility.md](visibility.md) — not
restated here.

## The rule that sums up the client side

**Triangle count on screen is almost never the limiting factor.** The usual bottleneck is the number
of **draw calls** (one per material change, or per unbatched prop), the **fillrate** (overdraw,
transparency) and, server-side, the number of simulated entities. `[consensus]`

⚠️ **"Source has no `r_speeds`" is `[disputed]`.** The cvar does exist in the engine — a GoldSrc
inheritance — but it became uninformative on Source, where `+showbudget` and `mat_wireframe` replace
it in practice. Saying "Source has no r_speeds" copies an inaccuracy the community docs repeat; the
correct phrasing is "obsolete, not absent".

**No official Valve triangle budget for a whole scene was ever found.** The only Valve figures
identified (3000 to 7500 tris) are for **individual models** in HL2, dated 2004 — not a scene. The
"stay under 10,000/20,000 visible tris" thresholds circulating on mapping forums are folklore with
no primary source. `[disputed]` Do not quote a figure: the budget is **measured** on this map, with
`+showbudget` (the world-render category, in ms/frame) and `mat_wireframe 2` to see what is actually
drawn from the real player vantage points.

## `prop_static` / `prop_dynamic` / `prop_physics`

| | `prop_static` | `prop_dynamic` | `prop_physics` |
|---|---|---|---|
| Edict | no — no network entity after the compile `[engine]` | yes | yes |
| Batching | yes, prop combine possible at compile time | no | no |
| Cost per tick | close to nil | low, but a real entity even standing still | VPhysics simulation every tick |
| Lighting | bakeable to lightmap or per-vertex, a VRAD cost | dynamic | dynamic |
| When | anything that does not move, does not animate and has neither I/O nor a parent — the vast majority of the set | animation, parenting, changing skin or model at runtime | pick-up-able, pushable, breakable |

⚠️ **"`prop_static` is free" is an approximation.** No edict does not mean no cost: lightmaps per
LOD, VRAM, VRAD time with `-StaticPropLighting`. It is the cheapest class in the engine, not a class
without cost. `[engine]`

`func_lod` does what a fading `prop_static` does but **remains an edict** — reach for it only when
the model genuinely cannot become a prop. `[engine, VDC Func_lod]`

Measuring: `read_prop_survey` (hammer-mcp) lists the `prop_dynamic` with no name, parent, animation
or output — conversion candidates, never a verdict, since converting takes a recompile and a model
without static support cannot be converted at all. On `rp_nycity_day`: 59 `prop_dynamic`, 17
candidates identified, 42 justified (parented, named or animated) `[measured]`.

⚠️ **That survey does not see `prop_static` at all.** It walks lump 0, and a `prop_static` is not an
entity there: `vbsp` moves it into `GAME_LUMP` (35) at compile time. So a class breakdown that shows
zero `prop_static` on a map visibly full of them is the reader's gap, not an empty map — reading
`GAME_LUMP` is an open tooling gap in this repository. The independent oracle for
`rp_nycity_day` is **861** `prop_static` `[measured]`.

## Brush versus model

| | Brush (world or `func_detail`) | Model (`prop_static`) |
|---|---|---|
| VIS | natively benefits from visleaf culling | no impact on the subdivision (unless structural through `func_brush`, which has none) |
| Lightmapping | native, consistent with the rest of the world | lightmap per LOD, its own VRAM cost |
| Compile cost | subdivides visleaves when placed as a non-detail world brush | no VIS cost, benefits from model LODs |
| Good use | large flat surface, load-bearing structure | complex architectural detail, not blocking for gameplay |

**A radiator or a railing left as a world brush can fragment the VIS of an entire area** and drop the
framerate in places unrelated to the object — the reflex is to make it a `func_detail` or a model,
not to keep it as a world brush out of habit. The structural/detail split and its diagnosis
(`mat_leafvis`, `read_map_geometry`) are in [visibility.md](visibility.md) and
[brushwork.md](brushwork.md).

Do not systematically replace simple brushwork with models expecting a win: a model escapes VIS but
adds a draw call per renderable; for a large flat surface the brush is often still cheaper.

## Fade distance and LOD

`fademindist`/`fademaxdist` cuts the number of renderables handled per frame, with no recompile. The
fade "pops" rather than blending smoothly on low-end hardware, and a small object disappears closer
than a large one at the same fade distance. `[engine]`

A model's LOD (`$lod` in the QC) is not triggered by raw distance to the camera but by
`(100 / screen-pixels-per-unit)` — so it depends on resolution, FOV and on-screen size, not on Hammer
units alone. Up to 8 levels per model. `[engine, VDC $lod]`

Measuring: compare the framerate with `fademaxdist` on and off, or `r_drawothermodels 0/2` to isolate
what props weigh in the current frame (`gmod-mcp` → `run_console_command`).

## Fillrate and overdraw

Overdraw scales with the **pixel area** of the stacked layers, not with triangle count — low-poly
foliage with several alpha layers can cost more than a massive opaque set piece. `[consensus]`
Transparency, refraction (expensive water), specular reflections and HDR are the classic sources of
double rendering.

Water: `WaterCheap` has neither real-time reflection nor refraction (a degraded reflection through
`$envmap` remains possible); expensive `Water` does both. The player can force the cheap fallback
from the video options — **always place `env_cubemap`** even when counting on expensive water, because
the fallback leans on them. `[engine]`

Measuring: `mat_fillrate 1` (also `mat_measurefillrate` depending on the version) colours pixels by
how many times they were redrawn; combine it with `+showbudget` to put a number in ms (`gmod-mcp` →
`run_console_command`).

## Shadows and expensive materials

`prop_static` shadows on the lightmap cost VRAD time, not render time — the budget to watch is the
compile's (`-StaticPropLighting`), not the client's. Per-prop lightmaps can be higher-resolution than
brush and displacement lightmaps, with a VRAM cost per LOD. `[engine]`

A normal-mapped material disables per-vertex lighting on `prop_static` on some engine branches; on
the branches that allow it, **one normal-mapped prop makes every other prop be treated as
normal-mapped**, which lengthens VRAD for the whole map. `[engine]`

## Server load — a separate subject

What matters at 60 connected players is not what matters on a lone client:

- **The server loop (networking, physics, Lua) is single-threaded.** More cores barely help the tick
  — only single-thread frequency counts. `[consensus]`
- **`prop_physics` in bulk**: each instance adds a physics cost per tick (collision, integration) on
  top of the edict and network cost. An accumulation in sandbox is fixed by a gameplay limit, not by
  raising the tickrate — the tickrate does not fix an O(n) simulation that is blowing up.
  `[consensus]`
- **The Source 1 network edict limit is 2048** (`MAX_EDICTS`, `src/public/const.h` l.65-67)
  `[engine]`. The effective runtime value on the server's GMod branch is not verifiable in this
  repository (closed engine) — measure it through `gmod-mcp`, do not quote it from memory.
- **Raising the tickrate without cutting the simulated load saturates the CPU** rather than
  improving perceived smoothness. The symptom is not a network one: `net_graph 4` shows the `sv` line
  flashing red when the server is spending its whole tick budget.

Measuring server-side: `net_graph 4` (the `sv` line), `vprof_generate_report` (a `.txt` per
subsystem, useful post-mortem outside a live session), and the map's entity count
(`read_bsp_entities`, hammer-mcp) set against the edict limit. Per-Lua-hook detail — the real CPU
cost of a `Think` or a `PlayerTick` — is not this page's subject: see
the `glua` skill's `references/perf.md` — in the server workshop, not in this repository — which
documents `r_harness_hookcost` and `vprof` (HolyLib) for that, and warns about `fprofiler` not doing
what it is credited with.

## Measuring, in one table

| Question | Tool |
|---|---|
| Frame budget per engine subsystem | `+showbudget` (`gmod-mcp` → `run_console_command`) — force `mat_queue_mode 0` while measuring, or multithreading skews the breakdown |
| What is actually drawn (not merely in the PVS) | `mat_wireframe 2` |
| Overdraw / fillrate | `mat_fillrate 1` |
| What props weigh in the frame | `r_drawothermodels 0` versus `2` |
| Live server network/CPU load | `net_graph 4`, the `sv` line |
| Per-subsystem server profile, outside a live session | `vprof_generate_report` (writes a `.txt` into the gamedir) |
| `prop_dynamic` → `prop_static` candidates | `read_prop_survey` (hammer-mcp, offline) |
| Structural/detail ratio, raw counts | `read_map_geometry` (hammer-mcp, offline) |
| Entity count against the edict limit | `read_bsp_entities` (hammer-mcp, offline) |
| Cost per Lua hook (`Think`, `PlayerTick`…) | out of scope here — the `glua` skill, elsewhere |
| Where to cut: which model to make a `prop_static`, which fade level to pick | human judgement, not tooled |

No `read_vprof` tool exists in this repository: `vprof` is driven from the console
(`run_console_command`) and read through `vprof_generate_report`, not through a dedicated
`hammer-mcp` or `gmod-mcp` reader — such a tool is contemplated, not built.
