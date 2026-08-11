# Compiling

Driving the tools — `run_compile`, Wine, stock/Hammer++, `cull` — lives in
`source-map/references/compiling.md`. Here: what each pass actually does, which flags change
anything, how to hunt a leak, and the message catalogue.

## The three passes

- **vbsp** turns brushes into polygons, generates the visleaves and detail props, absorbs most
  internal entities into the world, patches `WorldVertexTransition` materials off displacements, and
  writes the `.lin` if it finds no seal. The `.bsp` it produces is playable but **with no VIS and no
  light**. `[engine]`
- **vvis** tests visibility between visleaves (clipping their planes) and writes the result into the
  `.bsp`. Without `-fast`, this is the pass that takes time — minutes to hours on a large outdoor
  map. `[engine]`
- **vrad** computes lightmaps, per-vertex prop lighting and ambient samples; it is generally **the
  slowest of the three**, and an unsealed or badly optimised map makes it longer still. `[engine]`

## The flags that really change something

| Situation | Flags | Real effect |
|---|---|---|
| Iterating on gameplay, not lighting yet | `vvis -fast`, `vrad -fast` | vvis does not test visibility (just a coarse first pass); vrad ignores bounces. Produces random colour blotches in the dark and on displacement edges — **never ship with `-fast`**. `[engine]` |
| Shipping | `vrad -final` | Equivalent to markedly finer prop sampling (`-staticpropsamplescale 16` on several games) — a real time cost, not a label. `[engine]` |
| Props with wrong shadows (coarse collision: grates, fences) | `-staticproppolys` (+ `-textureshadows` if alpha) | vrad shadows from the prop's render mesh rather than its hitbox. `-textureshadows` generally needs `-staticproppolys` to be visible. `[engine]` |
| Curved prop shapes shading badly | `-staticproplighting` | Switches props to per-vertex lighting — compile time grows with their count; save it for late passes. `[engine]` |
| Only entities changed, geometry and lighting already good | `vbsp -onlyents` | Re-embeds the entity block only; keeps existing VIS and lighting. Marks the `.bsp` *stale* (in-game warning) — the alternative to a lump patch when you have the source. `[engine]` |
| Map intended for HDR | `-both`, never `-hdr` alone for a release | On pre-deprecation branches, loading a map compiled `-hdr` only with HDR disabled client-side forces `mat_fullbright 1` on **every subsequent map** until cheats are enabled. `[engine]` |
| Shared machine, long compile | `-threads <n-1>` or `-low` | Keeps the machine responsive during the compile; slightly longer. `[consensus]` |
| Excess T-junctions (`func_detail` touching the world) | do not reach for `-notjunc` by default | `-notjunc` disables the seam fix-up and produces visible shimmering in the dark, especially with bump mapping — a last resort, not a solution. `[consensus]` |

⚠️ **`-leaktest` is not what produces the `.lin`.** It only makes vbsp stop dead at the first leak
found; the pointfile is written either way, flag or no flag. Without it, vbsp runs to completion and
vvis then refuses to run. `[engine]`

## Reading vvis progress

Useful for telling a run that is progressing from one that is stuck — vvis prints little, and on a
large map this counter can be the only sign of life:

| Console output | What it measures |
|---|---|
| `number portalclusters` | the effective visleaf count (a `func_viscluster` merges several leaves into one) `[engine]` |
| `BasePortalVis: 0...10` | the coarse first pass, trivially eliminating what cannot see — **not run with `-fast`** `[engine]` |
| `PortalFlow: 0...10` | the real visibility computation — the long part, absent with `-fast` `[engine]` |
| `Building PAS...` | the Potentially Audible Set, after the PVS `[engine]` |
| `visdatasize: N compressed from M` | embedded visibility data size; hard ceiling of 16 MiB on Source 2013 branches `[engine]` |

⚠️ `-onlyprops` on vbsp produces no `.prt` — chained with a normal vvis, vvis **fails** rather than
skipping the pass. Reserve it for a `.bsp` you only ever recompile for props. `[engine]`

## Hunting a leak

⚠️ **The entity named in `leaked!` is never the cause.** vbsp flood-fills from the void inward and
reports the first entity it meets on that path — deleting it simply moves the message to the next
one. Sealing theory: `references/visibility.md`. `[engine]`

1. `read_compile_log` on vbsp's output: the first `**** leaked ****` is the one that counts, not the
   ones after — vvis refuses to run on a leaking map, and the run stops on its own.
2. `read_leak` correlates the pointfile (`.lin`) with the entities and names the one standing on the
   path. The file traces coordinates line by line: the first is the starting point in the void, the
   last the entity it reached — the reported position is **where the ray got through**, not
   necessarily where the hole is. `[engine]`
3. If the pointfile leads nowhere obvious, the causes that are construction accidents rather than
   sealing theory:
   - **desynchronised origin** — a brush entity with an origin helper (`func_door_rotating`,
     `func_rot_button`) leaks if its origin is outside the world even when the brush body is inside.
     Typically after a move in Vertex Tool mode, which does not move the origin. `[engine]`
   - **a translucent face turned towards the void** — one translucent face is enough to break the
     seal, whichever side; the pointfile goes straight through the brush. `[engine]`
   - **an uncovered `func_detail`** — a `func_detail` with no world brush behind it leaks, since it
     never seals anything itself. `[engine]`
   - **no entity in the map at all** — vbsp then has no inside/outside reference and can report a
     leak where there is none geometrically. Always keep at least one spawn. `[engine]`
   - **false positive** — rare: copy the map into a new file and recompile; if the leak disappears,
     the original file was corrupt. `[consensus]`
   - **`func_viscluster` crossing an areaportal or water** — not a leak cause in itself, but the
     combined symptom is easily confused at the pointfile; check it crosses neither. `[engine]`
4. An entity whose origin falls **exactly** at `0 0 0`, or inside a solid brush, never leaks — it is
   ignored for inside/outside determination, which explains some baffling "non-leaks" on badly
   placed props. `[engine]`

## The message catalogue

| Message | What it really means | What to do |
|---|---|---|
| `**** leaked ****` / `Entity <class> (id) leaked!` | An open path to the void; the entity named is the flood-fill's starting point, not the cause. | `read_leak`, follow the pointfile, seal with world brush. Never delete the named entity. `[engine]` |
| `LEAKED` with no usable `.lin` (0 bytes) | The leak exists but vbsp could not trace a clean path — often several simultaneous leaks, or massive off-grid geometry. | Bisect with a cordon, look for an isolated brush far from the rest. `[disputed]` |
| `Displacement found on a(n) <class> entity — not supported` | A displacement ended up on a brush that is no longer world (wrongly converted to `func_detail`/`func_brush`). Displacements live only on world geometry. | `read_vmf_lint` identifies the real brush — the index the compiler prints is useless (always 0). Convert it back to world. `[consensus]` |
| `Too many t-junctions to fix up!` | Too many `func_detail` intersecting the world for the seam fix-up to stay within its internal limit. | Convert some `func_detail` to `func_brush` (different fix-up), or to props. `-notjunc` only as a last resort. `[consensus]` |
| `MAX_MAP_BRUSHSIDES` / `MAX_MAP_PLANES` / `MAX_MAP_*` exceeded | A lump hit its hard limit, coded in `bspfile.h`, not a command-line setting (`BRUSHSIDES`/`PLANES`/`NODES`/`LEAFS` = 65536; `ENTITIES` = 8192; `AREAPORTALS` = 1024). | `read_map_geometry` says which and by how much — including the byte-denominated ceilings like `MAX_MAP_LIGHTING`, which record-count checks miss. Reduce geometry (detail, props, instances); Hammer++ raises some of these limits, never all. `[engine]` |
| `no entities in the map` | No valid `worldspawn`, or no inside/outside reference entity — vbsp can then report a leak with no geometric hole. | Check the `.vmf`'s integrity, guarantee at least one spawn. `[engine]` |
| `material not found: <path>` | The referenced material exists in no VPK or folder mounted for the `-game` used — the compile continues with a fallback texture (chequerboard). | Check `-game`/`read_source_games`, path case (case-sensitive under Wine/Linux), the `.vmt`/`.vtf`. `read_map_dependencies` separates "packed", "provided by the game" and "missing". `[consensus]` |
| `Bad surface extents` | Lightmap footprint too large for a face — an aberrant texture scale (often outside `[0.1, 10]`), or a displacement with near-coincident vertices. | Realign to *World*, reduce the scale, raise that face's `lightmapscale`. Note a brush face is capped at 32 luxels per axis, not the 125 of displacements. `[consensus]` |
| `WARNING: node without a volume` / `BSP node with unbounded volume` | A BSP tree node could not be bounded — often invalid geometry from vertex editing, or props embedded in a wall. | Ignorable in practice if nothing shows in game; otherwise cordon off the recently vertex-edited area. **`[disputed]`** — no dedicated VDC page found, community treatment only. |
| `brush outside world` | A brush or entity strayed to an absurd distance, often after a copy-paste, inflating the map's bounds and risking a leak or a crash. | Use *Overview* / massive zoom-out to find it, delete or reposition it. `[consensus]` |
| `func_areaportal ... has no area` / `doesn't touch two areas` | The brush does not touch two distinct sealed areas — floating in the void, or a 0.1-unit gap breaking contact. | Reposition against a wall sealed on both sides; one brush per areaportal. `[engine]` |
| `Cluster portals saw into cluster` | A vvis portal sees itself through degenerate geometry — almost always collateral to a leak or a malformed areaportal/hint. | Fix the sealing first, recheck after. **`[disputed]`** — no isolated VDC page. |
| `*** Suppressing further FindPortalSide errors ***` | vvis hit so many portal errors it stopped logging them individually — a severity indicator, not the error itself. | Go back to the very first `FindPortalSide error` before the cutoff; check sealing first. **`[disputed]`** — literal reading, no direct primary doc. |
| `lightmap sample position` | Same family as `Bad surface extents` — a degenerate face or geometry overlapping a displacement. | Same treatment as `Bad surface extents`. **`[disputed]`** — not formally isolated in the sources consulted. |
| `Bogus range` (lighting/HDR) | A colour/intensity value outside the representable range — often a `light`/`light_environment` at zero, negative or extreme brightness. | Check the brightness of lights near the area named. **`[disputed]`** — no primary source consulted. |
| `Bad command line` (often from Hammer++) | A flag in the compile profile is not recognised by the targeted executable — common when one game receives another's flag. | Check `-game` and the executable actually invoked against the target game's documentation. `[consensus]` |
| `Error opening ...vmf` / no `.bsp` at the end | The final copy into `maps/` failed — usually because vbsp died before producing a `.bsp` (an upstream fatal error). | Go back to the first fatal message, do not trust the copy message. `[consensus]` |
| `Patching WVT material: ...` | A `WorldVertexTransition` material is used on a non-displacement face; vbsp patches it so it renders anyway. | Nothing to do — information, not an error. `[engine]` |
| `FixTjuncs...` | vbsp is fixing T-junctions created by `func_detail` touching the world. | Nothing to do unless it precedes `Too many t-junctions to fix up!`. `[engine]` |

## Verifying

| Question | Tool |
|---|---|
| Where the chain got to, which pass failed | `read_compile_log` (hammer-mcp) |
| Leak position, correlated entity | `read_leak` (hammer-mcp) |
| Which lump hit its limit, and by how much | `read_map_geometry` (hammer-mcp) |
| The VMF before compiling — hint, areaportal, suspect brush | `read_vmf_lint`, `read_vmf_solids` (hammer-mcp) |
| Which `-game` really targets which game | `read_source_games` (hammer-mcp) |
| Are the stock/Hammer++ binaries present | `health` (hammer-mcp) |
| `mat_fullbright` forced after an `-hdr`-only map, in game | human judgement, not tooled — compare before/after in game |
