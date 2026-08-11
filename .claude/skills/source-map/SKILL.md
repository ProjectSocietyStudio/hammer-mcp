---
name: source-map
description: Working a Source / Garry's Mod map — measure, audit, edit a VMF, compile, pack, ship. Use whenever the subject is a map, .vmf, .bsp, Hammer, vbsp/vvis/vrad, a leak, lightmaps, cubemaps, nav mesh, asset packing, or rp_nycity_day itself.
---

# Working a Source map

The tooling lives in **`hammer-mcp`** (offline: files, compilers) and **`gmod-mcp`** (online: the
running engine). This skill says **what to do and in what order**; the thresholds, the limits and
the schemas live in the tools, where they are verified, not here.

It covers the **tooling**. The craft — brushwork, VIS, lighting, displacements, performance, level
design — lives in the `source-mapping` skill, which does not copy this one.

`hammer-mcp` has been public since 11/08/2026: its measurement log is in
[`docs/`](https://github.com/ProjectSocietyStudio/hammer-mcp/tree/main/docs), where what is proven
is kept separate from what is not.

## The rule that comes first

**A `.bsp` is never read by hand.** The production map is 1.13 GB, 1004 MB of it pakfile. A
`readFileSync` on it kills the MCP transport, and the agent sees a hang rather than an error. Every
reader in `hammer-mcp` goes by offsets — they read 1.5 MB where the file is 1130. Never work around
the tool.

## Survey the ground first

| Question | The tool |
|---|---|
| What is broken in my chain? | `health` — active game profile, Wine binaries, FGD, Python sidecar |
| Which game am I working on? | `read_source_games` — what is installed, read from Steam and `gameinfo.txt` |
| How big is this map? | `read_map_extents` |
| Can it still grow? | `read_map_geometry` |
| What does it ship with? | `read_pakfile` |
| What is inside it? | `read_bsp_entities`, `read_prop_survey` |

On `rp_nycity_day`, the answer to "can it grow" is **no**: `TEXINFO` at 96%, `VERTEXES` at 95%, and
`MODELS` **past its ceiling** (1218 against 1024). That last point does not mean the map is broken —
it loads every day — but that its compilers raise that ceiling. Any proposal that adds geometry has
to start there.

**The game is no longer assumed.** Tools that depend on it take a `game` argument and **report in
their output which profile answered**, plus whether that came from the call or the configuration.
An unknown id is refused, naming the ones that exist, never resolved to the default. Only Garry's
Mod has actually been run; the other profiles are plausible and unverified, and `health` says where
each value came from.

## Editing a map you have no source for

That is the production case. There is no `.vmf` for `rp_nycity_day`.

**A lump patch** (`write_lump_patch`) rewrites a compiled `.bsp`'s entity list without recompiling.
It can **edit or delete an entity the map itself spawns**, before it spawns — which no Lua script
can do. It cannot: relight the map (the LIGHTING lump is baked), create geometry, or reach clients
(the `.lmp` lives server-side).

**To simply add an entity, prefer a GLua manifest** read at `InitPostEntity`: format-agnostic,
survives a recompile, hot-reloads.

⚠️ **Gate B has not been passed.** Nothing yet proves the current Garry's Mod branch reads `.lmp`
files at all. The verification protocol, negative control included, is in `hammer-mcp/docs/gates.md`.
Do not present a lump patch as working before then.

## Writing or changing a VMF

1. `read_fgd_class` before inventing a keyvalue — the game's FGD is the schema Hammer enforces, and
   it answers "does this class accept this key".
2. `read_vmf_lint` **before every compile**. It catches in a second what a compile takes forty
   minutes to refuse, and what otherwise only shows up in game.
3. `edit_vmf` splices the original text: entities, keyvalues, outputs. **Everything untouched stays
   byte for byte identical**, so a one-entity change gives a one-entity diff. It is guarded
   (`confirm: true`) and writes a `.bak` by default.

   Never reserialise a VMF. What a reserialisation costs has been measured, and it is not what you
   would think: our formatter copies values verbatim, so `5416.0312` survives it. What does not
   survive is what the grammar does not model — **`//` comments, blank lines, indentation that is
   not one tab per level**. Third-party editors and hand-edited maps have all of these, and the
   loss is silent. (The Python sidecar reads values back as numbers: never write a VMF through it.)

4. `write_vmf_solid` creates brush geometry, and `read_vmf_solids` is the oracle that makes it
   safe: it recovers the volume **from the planes**, running the opposite way, so a sign error
   cannot hide in both directions at once.

**In Garry's Mod, the FGD is not the whole truth**: Lua registers its own entities. An
`unknown-classname` on a `ttt_*` or `r*` class is probably a false positive — the lint already
knows the repository's Lua entities and the Hammer++ compiler classes, but not those of an addon
that is not installed. It says which schemas it judged against (`fgdsLoaded`).

**A map with `func_instance` is read expanded or not at all.** Folded, an instance is one entity
where there is a whole building: counts are massively understated, and any output crossing an
instance boundary looks like a dead reference. `read_vmf` and `read_vmf_lint` take
`collapseInstances: true` — set it as soon as a `func_instance` shows up in the histogram.

## Compiling

Detail in [references/compiling.md](references/compiling.md). The essentials:

- `read_vmf_lint` first, always.
- `run_compile` with `fast: true` to iterate; `fast: false` only to ship.
- `toolchain: "stock"` by default. `"plusplus"` when vvis takes hours or a map hits a ceiling — and
  then recompile with `stock` to compare before concluding anything.
- **Copy the `.vmf` out of any read-only tree before compiling**: the compiler writes the `.bsp`
  beside its source, and the write guard refuses those trees.
- A **leak invalidates everything after it**. `run_compile` stops at the offending stage on its own.
- `read_leak` turns "leaked!" into a named entity. The compilers give no position at all.

## Optimising, lighting, shipping

Three areas where counting is automatable and **placement is not**:

- [references/optimisation.md](references/optimisation.md) — visleaves, `func_detail`, hints,
  areaportals, props.
- [references/lighting.md](references/lighting.md) — lightmaps, HDR, cubemaps, static props.
- [references/shipping.md](references/shipping.md) — packing, nav mesh, the check before shipping.

## What no tool here can do

To be said rather than worked around:

- **Name a street, a plot, a district.** A `.bsp` carries no such notion. `read_sightlines` measures
  lines of sight between walkable points, not "the longest avenue"; a spec that needs "plot" must
  first define the convention that bounds one.
- **See props and brush entities.** The tracer only knows the world tree: a closed door reads as
  open.
- **Generate a nav mesh.** Only `nav_generate` in the engine does it. No offline generator exists,
  here or anywhere.
- **Judge.** Which wall is structural, where a hint goes, whether a map looks good. Counting
  areaportals is automatic; deciding where to put them is not.

## The server is shared

`srcds` and the `gmod-mcp` daemon are shared between sessions. **Never restart either
unilaterally** — two daemons destroy the transport silently. Any in-game check (gate B,
`buildcubemaps`, `nav_generate`, cross-checking a count) is asked for, not decided.
