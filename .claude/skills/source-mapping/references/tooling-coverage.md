# What we can verify, and what we cannot

Knowing a rule is useless if you cannot say whether it is being followed. This page ties every
family of rules in the skill to its checking method, and names outright what nothing checks.

Three statuses, and only one is comfortable:

| Status | What it means |
|---|---|
| **offline** | a `hammer-mcp` tool answers from the file, with no engine and no server |
| **in game** | the running engine is required: `gmod-mcp`, therefore the shared server |
| **human** | no tool settles it. Saying so is the only honesty available |

## By area

| Skill rule | How it is checked | Status |
|---|---|---|
| Lump fill against vbsp ceilings ([brushwork](brushwork.md)) | `read_map_geometry` | offline |
| Real extent, leaving the world ([brushwork](brushwork.md)) | `read_map_extents` | offline |
| Class or keyvalue unknown to the FGD ([entities](entities.md)) | `read_vmf_lint`, `read_fgd_class` | offline |
| Output aimed at a target that does not exist ([entities](entities.md)) | `read_vmf_lint` | offline |
| Entity inventory and positions ([entities](entities.md)) | `read_bsp_entities`, `read_vmf` | offline |
| Map sealed, hunting a leak ([compiling](compiling.md)) | `read_leak` on the pointfile, `read_compile_log` | offline |
| What a compiler message really means ([compiling](compiling.md)) | `read_compile_log` | offline |
| Sightline lengths ([visibility](visibility.md)) | `read_sightlines` | offline |
| Is a brush closed, convex, inside the world, on grid ([brushwork](brushwork.md)) | `read_vmf_solids` | offline |
| Does a map hold its budget, and which one ([performance](performance.md)) | `read_map_report` | offline |
| Did a hint change anything ([visibility](visibility.md)) | compile before/after, compare `read_visleaf_stats` | offline |
| Dynamic props convertible to static ([performance](performance.md)) | `read_prop_survey` | offline |
| Footprint and volume of brush entities ([performance](performance.md)) | `read_brush_volumes` | offline |
| Cubemaps built, static lighting baked ([lighting](lighting.md)) | `read_pakfile` — counts the `c-*.vtf` and the `.vhv` | offline |
| Was the map compiled with HDR ([lighting](lighting.md)) | `read_bsp_info` → `hdrLighting`, from lumps 53/54/58 | offline |
| Where the lightmap budget went ([lighting](lighting.md)) | `read_lightmap_budget` | offline |
| Materials used and how often ([assets](assets.md)) | `read_materials` | offline |
| Assets referenced but not packed ([assets](assets.md)) | `read_map_dependencies` | offline |
| Nav mesh still valid after a compile ([gmod](gmod.md)) | `read_nav` | offline |
| What a Workshop archive holds, and getting one file out ([gmod](gmod.md)) | `read_gma`, `run_gma_extract` | offline |
| Toolchain, FGD, game profile available ([compiling](compiling.md)) | `health`, `read_source_games` | offline |
| The real visleaf split ([visibility](visibility.md)) | `mat_leafvis`, `r_lockpvs`, **client console** | in game |
| What is actually drawn ([performance](performance.md)) | `mat_wireframe`, `+showbudget`, **client console** | in game |
| Server cost under load ([performance](performance.md)) | `read_runtime`, `read_players`, `read_entities` | in game |
| Cubemaps to rebuild ([lighting](lighting.md)) | `buildcubemaps` via `run_console_command` | in game |
| Purple chequerboard, ERROR model ([assets](assets.md)) | `capture_screen`, `read_console` | in game |
| Sound, fog, water ([atmosphere](atmosphere.md)) | `capture_screen`, `read_view`, human listening | in game |
| Should this structural brush be `func_detail` ([visibility](visibility.md)) | — | human |
| Where to place a hint, an areaportal ([visibility](visibility.md)) | — | human |
| Which lightmap scale a surface deserves ([lighting](lighting.md)) | — | human |
| Is the lighting good, is the city readable ([level-design](level-design.md)) | — | human |
| Scale, composition, flow ([level-design](level-design.md)) | — | human |
| Is the displacement well sewn ([displacements](displacements.md)) | — | human |

⚠️ **The "human" column is not a weakness of the tooling, it is the nature of the craft.** An agent
dressing an aesthetic judgement up as a metric produces a wrong number and false confidence. "I
cannot settle this, look at it" is a valid answer and often the right one.

⚠️ `mat_leafvis` and `mat_wireframe` are **client** render cvars. A dedicated server has no
renderer, so sending them server-side does nothing whatever `sv_cheats` says.

## What the compiled file has permanently lost

A `.bsp` is not a map, it is the result of a map. Auditing a map you have no `.vmf` for means
accepting these blind spots:

| Lost | Why |
|---|---|
| structural vs `func_detail` | vbsp merges detail into the world at compile time |
| hints and skips | consumed by vvis, absent from the final file |
| visgroups, cordon, working organisation | exist only in the `.vmf` |
| per-face lightmap scale | the lump size is measurable, the per-surface decision is not |
| the mapper's intent | no file contains it |

Faced with one of those questions on a compiled map, the answer is **"not determinable from a
`.bsp`"**, not an estimate.

## The tooling gaps, recorded and unfilled

Position at the end of 11/08/2026, from the `hammer-mcp` catalogue. This is not a work plan: it is
what you need to know before promising a check that does not exist.

Five gaps from the morning version were closed during the day and are removed from this table
rather than struck through: the **material table** (`read_materials`), **brush geometry** (no
longer a refusal — see below), the **lightmap budget** (`read_lightmap_budget`), **referenced
asset detection** (`read_map_dependencies`, which also drives `run_pack --auto`), and the
**`.gma` reader** (`read_gma`, `run_gma_extract`).

| Gap | What it prevents |
|---|---|
| `read_prop_survey` does not read the `GAME_LUMP` | it returns zero `prop_static` on any compiled map **without saying so**, and on an urban map that is most of the scenery |
| no reading of a `.nav`'s geometry | `read_nav` only reports freshness, not coverage |
| displacements, visgroups, cordon, occluders | read or counted at best, never created or edited |
| areaportals | counted by `read_map_geometry`, never functionally validated |
| cubemap and nav mesh generation | out of scope by construction — the engine is required, therefore `gmod-mcp` |
| `vprof` reader | considered, never written, for lack of a real sample to calibrate it against |

## The refusal on brush geometry, and why it fell

`hammer-mcp` refused to create brushes, with the reason written at the head of its write path:
placing planes and texture axes **with no oracle** produces maps that compile and are wrong.

The argument was sound; its conclusion expired, because the oracles exist now. Four of them, and
they are independent:

| Oracle | What it catches |
|---|---|
| **the algebra** — `read_vmf_solids` | it goes from planes back to volume where the writer goes from volume to planes: a sign error cannot hide in both directions |
| **the compiler** — vbsp | a closed room built entirely by the tool compiles without a leak, and leaks the moment a wall is removed |
| **the engine** | the room boots, or it does not |
| **the eye** | everything else, and it is still required |

Consequence for this skill: **the "human" column has not shrunk.** What changed is that an agent
can now *act* on what it diagnoses — place a `func_detail`, a hint, a volume — instead of only
naming it. Deciding **where** to place them stays a judgement.

⚠️ Do not conclude that a tool-built map is good. The four oracles answer "closed, convex, inside
the world, sealed". None answers "beautiful", "readable", or "in the right place".

⚠️ **`write_lump_patch` produces a valid file whose in-game effect is unproven.** The `.lmp` codec
is measured; that Garry's Mod actually honours it is not. Until that gate is passed, do not build a
delivery plan on it.

⚠️ **Only Garry's Mod has actually been run here.** The BSP and VMF readers are generic Source, but
the other games' profiles are plausible and unverified. A claim of the form "for CS:S, do X" has
been tried by nobody in this workshop — say so if you write it.
