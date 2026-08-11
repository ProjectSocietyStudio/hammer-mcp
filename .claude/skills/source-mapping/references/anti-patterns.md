# Myths, open debates and detection

Source mapping carries more dogma than measurement. This page repeats no prohibition already stated
elsewhere — it takes apart what gets repeated without checking, says where the community itself has
not settled the question, and gives an agent concrete signals for spotting each mistake in a file
rather than guessing at it.

## The myths, taken apart

| Myth | What is actually true | Where it holds anyway |
|---|---|---|
| "Too many brushes = lag" | The raw count of world brushes is not the metric that matters — their effect on the VIS split is (`visibility.md`) `[consensus]` | `MAX_MAP_BRUSHSIDES` = 65536 faces is a hard compile limit `[engine]`: past it, this is no longer about FPS, the compile simply fails |
| "Props are always cheaper than brushes" | False in both absolute directions — Source does not batch the rendering of several `.mdl`, each isolated prop is a separate draw call; one cited comparison has a `func_detail` beating an equivalent displacement `[disputed, quantified once]` | A **combined static prop** (propcombine) almost always beats the equivalent in detailed brushes — draw call count decides, not the category (`performance.md`) |
| "Nodraw every hidden face, the gain is huge" | Documented good practice, but **no solid quantified benchmark** compares a fully nodrawed map to an untreated one at equal geometry `[disputed]` | Apparently free, so worth doing anyway — but not the first optimisation priority next to hint/areaportal/`func_detail` |
| "`func_detail` everything that is not a load-bearing wall" | A sound starting heuristic, false taken literally: a `func_detail` **never seals anything** and cannot form an areaportal (`visibility.md`) `[engine]` | On anything that takes part in neither the map's envelope nor an areaportal, the heuristic holds without reservation |
| "A giant skybox around the map fixes leaks" | Catastrophic: the map becomes one or two visleaves, VIS can no longer cut anything, everything is rendered permanently — the exact anti-solution to the problem it claims to solve `[engine]` | Nowhere — always fix the leak at its source through the pointfile (`compiling.md`) |
| "The 32768-unit limit" | That is an **extent**, not a bound: the world runs from −16384 to +16384 on each axis (`MAX_COORD_INTEGER`), and 32768 is the edge-to-edge distance `[engine, worldsize.h]` | Nowhere — building "up to 32768" from the origin leaves the world by a factor of two, in both directions |
| "`-fast` is enough for testing" | True for routine gameplay iteration; false as final validation — vvis does not test visibility and vrad ignores bounces, which produces visible noise on dark edges and displacements `[engine]` | Never sufficient as the last compile before an in-game test or a release (`compiling.md`) |
| "A leak still works" | False: a leaking map has no `.prt`, therefore no VVIS; VRAD then computes badly or direct-only — the map compiles, but it is unplayable in the affected areas `[engine]` | Nowhere — a leak invalidates everything after it in the chain, and `run_compile` stops at the offending stage on its own |
| "1 Hammer unit = 1 inch, the scientific basis for scaling" | The VDC documents the inconsistency itself: architecture is calibrated on 1 foot = 16 units, characters on 1 foot = 12 — applying 16 to the player would put their eyes 4 feet up, which corresponds to nothing `[disputed, VDC says so itself]` | A good rough estimate for pure architectural brushwork (doors, ceilings), never for player-relative placement (`level-design.md`) |

What these nine myths share: each confuses a gesture that **looks** safe (covering it up, nodrawing
everything, detailing everything, testing with `-fast`) with a gesture that **is** safe. The engine
never rewards apparent caution — it punishes what was not measured.

## The debates nobody has settled

Where claiming to know would be dishonest:

- **The real size of the nodraw gain** — everyone agrees on the practice, nobody quantifies it on a
  complete realistic map. Missing: a public before/after benchmark at identical geometry.
- **The threshold past which hint brushes become counterproductive** — the VDC and the community
  warn that excessive use increases rendering rather than reducing it, with no per-room or
  per-corridor figure. Missing: it depends on topology, judged case by case, no reference
  measurement.
- **Propcombine versus `func_detail` for repetitive scenery** — the often-cited comparison (brush
  faster than an equivalent displacement) predates propcombine becoming standard in modern
  toolchains. Missing: a rerun of that same comparison with current tools.
- **The "ideal" lightmap scale** — 16 is the historical default, but no universal recommended value
  exists beyond "adapt it face by face" (`lighting.md` already carries that table).
  Missing: a consensus on where lowering it is worth the compile cost.
- **`WARNING: node without a volume`, `Cluster portals saw into cluster`, `FindPortalSide error`** —
  behaviours observed at compile time, with no dedicated VDC page explaining the exact mechanism
  (full catalogue: `compiling.md`). Missing: a primary source, not just community
  treatment.
- **The Hammer GUI versus a command line / compile wrapper** — no source documents any difference
  in engine output between the two; both call the same `vbsp`/`vvis`/`vrad` executables. The real
  difference is ergonomics (logs, prerequisites), not the compiled result — frequently and wrongly
  presented as a technical choice.

What these debates share: the community knows **which effect makes sense** (nodraw helps, a badly
placed hint can hurt) but none has a published threshold. An agent quoting a precise figure for any
of them is inventing a precision the source does not have.

## The detection table

For an agent inspecting a `.vmf`, a compiled `.bsp`, or a log — the signal to look for, not the
judgement to pass.

| Observable symptom | Probable error | The tool that reveals it |
|---|---|---|
| Visleaf count abnormally low for the map size | giant skybox, or a map with too little structural geometry | `read_visleaf_stats`, `read_map_extents` (hammer-mcp) |
| `LEAK` / `leaked!` in the log, non-empty `.lin` | sealing broken — a wall marked detail, an undoubled displacement, a badly sealed areaportal | `read_compile_log`, `read_leak` (hammer-mcp) |
| Structural/detail ratio extreme in either direction | everything world brush (VIS not optimised) or everything detail (enormous visleaves) | `read_map_geometry` (hammer-mcp) |
| Brush face count close to 65536 | high-resolution geometry (cylinders, arches) left as world brushes | `read_brush_volumes` (hammer-mcp) against the table in `brushwork.md` |
| A referenced `.vmt` missing from the pakfile, purple-black chequerboard in game | incomplete packing — a file referenced by the material was not embedded | `read_pakfile` (hammer-mcp), `read_console` (gmod-mcp) |
| A `-fast` compile flag on what is presented as the final build | final validation done on a degraded compile | `read_compile_log` (hammer-mcp) — look for the logged flags |
| Flat `lightmapscale` histogram (everything at 16, or everything at 4) | no face-by-face discrimination, wasted budget or banding | `read_lightmap_budget` (hammer-mcp) |
| `env_cubemap` present but the cubemap lump empty in the compiled `.bsp` | `buildcubemaps` never run after the last compile | `read_pakfile`, `read_bsp_info` (hammer-mcp); `run_console_command` (gmod-mcp) to replay `buildcubemaps` |
| Two entities sharing one `targetname` | phantom I/O — both receive every input addressed to the name | `read_bsp_entities` (hammer-mcp), `read_vmf_lint` |
| Networked entity count near the runtime edict limit | too many entities, or confusion with `MAX_MAP_ENTITIES` (compile-time, not runtime) | `read_bsp_entities` (hammer-mcp) for compile time, `read_entities` (gmod-mcp) for the real runtime |
| `sky_camera` present more than once in the file | a second `sky_camera` blocks nav mesh generation across the whole map | `read_vmf` (hammer-mcp) |
| A displacement on the skybox boundary with no nodraw world brush facing it | leak through a non-sealing displacement | `read_vmf`, `read_leak` (hammer-mcp) |
| `trigger_multiple`/`trigger_once` without the `Clients (Players)` flag ticked | trigger inert for the player, with no compile or console error at all | `read_vmf_lint` if the rule is covered; otherwise `spawn_entity` then observe the missing output (gmod-mcp) |
| Many `prop_dynamic` with no parent, no name, no animation | candidates never converted to `prop_static`, wasted edict and physics cost | `read_prop_survey` (hammer-mcp) — a candidate, never a verdict |
| `water_lod_control` present more than once in the file | guaranteed compile failure — only one is allowed per map | `read_vmf` (hammer-mcp) |
| A `water` brush whose bounding box is not a rectangular prism | broken water plane rendering | `read_vmf` (hammer-mcp), cross-checked against the non-water faces expected to be `toolsnodraw` |
