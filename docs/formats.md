# Formats, schemas and game profiles

## The `.lmp` format, as measured

A 20-byte header, five little-endian `int32`, then the payload:

| Offset | Field | Value |
|---|---|---|
| 0 | `lumpOffset` | 20 in every file Valve ships |
| 4 | `lumpID` | 0 for the entity list |
| 8 | `lumpVersion` | 0 |
| 12 | `lumpLength` | payload size, trailing NUL included |
| 16 | `mapRevision` | **must equal the target `.bsp`'s** |

`mapRevision` is the last `int32` of the BSP header, at **offset 1032** (`ident[4]` + `version` +
`lump_t[64]` × 16 bytes). The entity payload ends with a NUL, the way vbsp writes it into the BSP
itself.

**The trap in the mechanism**: if the two revisions differ, the engine **ignores the patch and says
nothing**. The map loads, looks normal, and none of the edits are there. So `write_lump_patch`
always copies the revision from the target BSP, and `encodeLmp` makes it a required argument with
no default — it cannot be omitted by inattention.

What a lump patch cannot do is in [gates.md](gates.md#what-a-lump-patch-cannot-do).

## The Python sidecar

The Source formats are already written, in Python. [`srctools`](https://github.com/TeamSpen210/srctools)
reads and writes VMF, BSP, VPK, VTF, VMT and FGD, it is maintained, and **no mature JS/TS or Rust
library exists for BSP**. Rewriting it would have been months of work on solved problems.

So `sidecar/` is a pinned venv (`srctools==2.7.0`) behind a single entry point: a verb in
`argv[1]`, JSON on stdin, JSON on stdout, diagnostics on stderr. `./sidecar/setup.sh` builds it;
the venv lives under `<stateDir>/sidecar-venv`, outside the repository, because it is
machine-specific build output.

**One subprocess per call, no daemon, no lock.** That is what keeps this server stateless. The
measured round trip is **87 ms**, srctools import included — low enough not to justify a resident
process.

**The boundary follows call frequency, not file format.** What is hot and already proven stays in
TypeScript: BSP reading by offsets, offset-preserving KeyValues, the `.lmp` codec. What is cold and
expensive to rewrite goes to Python: FGD, VTF, VPK. Measurement settles it — our header reader
opens the 1.13 GB map in **79 ms**, srctools' `BSP()` in **1.48 s**. On the hot path, ours stays.

### What srctools reads here, measured 11/08/2026

| File | Result |
|---|---|
| `ttt_traps.vmf` (7082 lines, Hammer-written) | 65 entities, 24 brushes, 0.02 s |
| `rp_nycity_day.bsp` (1.13 GB) | VBSP 20, `mapRevision` **10863**, opened in 1.48 s |
| its lump 0 | **3554** entities in 0.27 s, `prop_dynamic` **59**, `light_spot` **1262** |

`mapRevision`, `prop_dynamic` and `light_spot` land **exactly** on what our TypeScript reader and a
separate Lua addon measured independently. Two independent implementations agreeing on three
numbers: that is the oracle that makes both trustworthy.

**The fourth number differs by 1** — and you want to know that before crying bug.
`read_bsp_entities` counts **3555**, srctools **3554**: srctools keeps `worldspawn` aside
(`vmf.spawn`) and excludes it from `vmf.entities`, where our reader counts it as an entity of the
lump. Both conventions are defensible; comparing the two figures without knowing is not.

## An output survives compilation, but not its packaging

A `.vmf` keeps outputs in their own block:

```
"entity"
{
        "classname" "logic_timer"
        "connections"
        {
                "OnTimer" "store_4_windows_template<ESC>ForceSpawn<ESC><ESC>0.2<ESC>-1"
        }
}
```

vbsp flattens that away. In the entity lump the same output is an ordinary pair among the rest,
and older maps keep the comma separator Source used before the Orange Box — read verbatim out of
`rp_eastcoast_v4c`, published 2018:

```
{
"targetname" "store_4_windows_timer"
"RefireTime" "120"
"classname" "logic_timer"
"OnTimer" "store_4_windows_template,ForceSpawn,,0.2,-1"
}
```

So on a compiled map the name is the only structural clue left. **`isOutputKey` requires both**:
a key matching `^(On|Out)[A-Z]` — `Out` for the handful that report a value, `math_counter.OutValue`
and `logic_compare.OutValue` — **and** a value that parses as five fields with a target and an
input. `"OnFire" "1"` is a keyvalue whatever it is called.

That is a convention rather than a guarantee, so `validate_io` turns it into something checked:
once the FGD is loaded it compares what the convention found against what the schema declares, and
**reports any output the FGD knows about that parsing missed** rather than leaving the caller to
assume it missed nothing.

Everything after that split is format-agnostic. `entity/wiring.ts` judges a list of entities and
`entity/model.ts` already said why: the formats *"differ in packaging, not in content"*. Wiring was
the last place that had not been told — `validate_io` could judge a map you have the source for and
nothing could judge the map you do not, which is the production case, and the eastcoast audit paid
for it by finding four defects in a shipped map with hand-written Python.

## Game profiles

Measured 11/08/2026. Generalising past Garry's Mod looked like it needed a hand-written table of
games: FGD name, mod directory, bin directory, appid. **Four assertions per game nobody would have
verified** — and a wrong FGD produces a lint that accuses correct maps, with nothing to signal it.

All four are on disk:

| File | What it declares |
|---|---|
| `steamapps/libraryfolders.vdf` | where the libraries are |
| `steamapps/appmanifest_<id>.acf` | `appid`, `name`, `installdir`, and the beta branch (`UserConfig.BetaKey`) |
| `<game>/<mod>/gameinfo.txt` | `game`, `FileSystem.SteamAppId`, **`GameData`** — the FGD — and `InstancePath` |

And **no parser was needed**: all three are KeyValues, the grammar `src/kv/` already lexes for
`.vmf` files and the entity lump — bare words, quoted strings, `//` comments. Verified by reading
the real files. The `// Just to shut up vbsp.exe` comment Valve leaves immediately above `GameData`
in Garry's Mod's `gameinfo.txt` is in fact the lexer's negative control: drop `//` handling and the
FGD name is swallowed.

`read_source_games` reports all of it. What it **does not** say is just as sharp: never that a
binary will run under Wine (only gate A proved that, for one game), never a guessed engine branch,
and never a fallback to another game's `bin/` — several recent Source games ship their tools in a
separate application, and `dir: null` is the honest answer.

The trap that costs an hour if you do not know it: on Debian and Ubuntu, `~/.steam/steam` is a
**symlink** to `~/.steam/debian-installation`. Without deduplication by `realpath`, every game is
discovered twice.

### A profile records where each of its values came from

Only one game has ever been run on this machine. "Read from `gameinfo.txt`" and "written in the
built-in table" must therefore not look alike, so every resolved field carries its `provenance`
(`source` plus `verified`), which `health` returns.

The built-in table is deliberately thin: appid, install directory, mod directory, branch. **No FGD
name, no lump ceiling.** A `-game` pointed at a directory that does not exist shows up in one line;
an invented FGD makes correct maps get accused with nothing to say it guessed. A test asserts it:
the table contains neither `.fgd` nor `MAX_MAP`.

A game that is declared but not installed returns `unusableForCompile` with its reason, and
**never another game's `bin/`**.

## The FGD as a schema, and the lint built on it

The FGD is what Hammer enforces: which keyvalues a class accepts, which inputs it answers to, which
outputs it can fire. A VMF checked against it surfaces, **before a forty-minute compile**, the class
of mistake that otherwise only shows up in game as an entity that silently does nothing.

The game's own `garrysmod.fgd` is authoritative, not the multi-game database srctools bundles. The
bundle is broader and wronger for us: its `prop_dynamic` unions **111 keyvalues** across every
Source game where the game's own declares **39**, and it has no `sent_ball`, which a lint would
then report as an unknown class.

**One malformed helper must not cost the whole FGD.** Line 187 of `garrysmod.fgd` declares
`sphere(ball_size, 255, 255, 255, diameter)` — five arguments where srctools accepts 0, 1 or 4 —
and the parse aborts. Helpers are Hammer's rendering hints; they say nothing about whether a
keyvalue is valid. So they are made lenient, and **what was tolerated is counted and reported**
(`toleratedHelpers`) rather than swallowed. Result: **563 classes in 0.22 s, one helper tolerated**.

### In Garry's Mod, the FGD is not the whole truth

A gamemode or addon registers its own entities in Lua, and Hammer never hears about them. On
`ttt_traps.vmf` the lint returned **11 `unknown-classname` errors, all of them false**:
`ttt_damageowner` is defined by `gamemodes/terrortown/entities/entities/ttt_damageowner.lua`.

So `read_vmf_lint` scans the repository's Lua entities — **488 classes found** — and stops accusing
them. The scan deliberately errs toward knowing too much: a class listed wrongly costs one missed
warning, a class forgotten costs a false accusation on every map that uses it.

The same caution applies to output targets: an output aimed at a name absent from the map is a
**warning, not an error**, because in Garry's Mod a Lua-created entity may carry that name at
runtime. It is a lead, not a verdict, and the message says so.

### Every rule is proven by a fault put there on purpose

A lint that finds nothing and a broken lint look exactly alike. So every rule has its control: a
copy of the probe map, one precise fault in it, and the assurance that the rule names it — and
stays silent on the original.

| Rule | The injected fault |
|---|---|
| `unknown-classname` | `info_player_strat` instead of `info_player_start` |
| `unknown-keyvalue` | an invented key on `info_player_start` |
| `bad-texture-scale` | scale 0.01 — vbsp answers "Bad surface extents", naming a face you cannot find in Hammer |
| `output-target-missing` | a `logic_auto` aimed at `no_such_entity` |
| `displacement-on-entity` | returned with **the real brush id**, which vbsp never prints (it always shows 0) |

`read_fgd_class` suggests neighbouring classes when a name is wrong — by edit distance, not
substring: `prop_dynamik` contains no class and is contained by none, yet it is one letter from
`prop_dynamic`. It also restores the declared casing (`SetAnimation`), which srctools lowercases in
its indexes.

## Decompilation

`bspsrc` is the only mature BSP→VMF decompiler, and it is written in Java. It is not embedded here:
its redistribution status is not something a README settles. Calling it means pointing at a JVM
explicitly rather than trusting `java` on the `PATH` — the default `java` on the development
machine is 1.8, too old, while 17 and 21 are installed alongside it.
