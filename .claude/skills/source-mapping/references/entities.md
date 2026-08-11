# Entities and the I/O system

What an entity carries, how it talks to the others, and where what you can change without
recompiling stops. The performance of the three prop classes is in [performance.md](performance.md);
the GMod specifics (the `garrysmod.fgd` FGD, `mount.cfg`, DarkRP doors, nav mesh) are in
[gmod.md](gmod.md) — one pointer here, no restatement.

## Point entity versus brush entity

A **point entity** has only a position (`origin`, sometimes angles) — no volume of its own. A
**brush entity** is one or more brushes attached to an internal model (`*N`) referenced in the
`models` lump. `read_vmf` tells them apart; a `func_*` or `trigger_*` with no brush attached is a
broken VMF, not a valid entity. `[consensus]`

## Lump 0 is text

**The entity lump (`LUMP_ENTITIES`, index 0) is the only pure-text lump in the BSP**: a sequence of
`{ "classname" "..." "targetname" "..." ... }` blocks, `worldspawn` first. `[engine]` That is what
makes `read_bsp_entities` and lump patching possible with no binary parser.

**Changeable without recompiling**: keyvalues, position, angles of an existing entity; adding or
removing **point** entities; the I/O connections themselves (`connections` blocks). **Never
changeable this way**: brush geometry, displacements, lightmaps, visibility — everything living in
another lump demands `vbsp`/`vvis`/`vrad`. Verifying: `write_lump_patch` + `read_lump_patch_status`
(hammer-mcp); the in-game verification protocol is in `SKILL.md`, not here.

⚠️ **Lump patching is not proven on the game side.** The `.lmp` codec works — that is measured — but
nobody has yet verified that Garry's Mod really loads a `.lmp` dropped next to its `.bsp`. Until
that gate is passed, `write_lump_patch` produces a valid file whose in-game effect stays a
hypothesis. Do not build a shipping plan on it.

## The shape of an output

`Target , Input , Parameter , Delay , Times to fire` — identical across all of Source 1. `[engine]`

- Empty input → the entity receives its default `Use` (a GoldSrc inheritance). `[consensus]`
- Empty parameter on an output that carries its own value (`OnHealthChanged` passes the health) →
  that value goes through unchanged. `[engine]`
- Delay in seconds, **relative to the output firing**, never an absolute map time. `[consensus]`

Verifying: `read_vmf` on an entity's `connections {}` block, or in game `ent_messages_draw 1` /
`run_console_command` (gmod-mcp).

## Target resolution

The engine first tries to match on **targetname** (exact or wildcard); only when nothing matches
does it fall back to **classname**. `[consensus]`

⚠️ **A targetname equal to an existing classname intercepts every output aimed at that class** —
naming an entity `prop_physics` captures the outputs addressed to every `prop_physics` on the map.

**Wildcards are suffix-only.** `door1*` matches `door1_trigger`; `*_light` matches **nothing** on
the stock engine (prefix wildcards are unsupported). The naming convention that follows: group
related entities under a shared prefix (`door1_trigger`, `door1_light`) to target them in one go via
`door1_*`, rather than around a shared suffix. `[engine for the behaviour, consensus for the exact
scope]` Mapbase extends this to prefixes and the `?` wildcard — outside the stock engine and GMod.

**Two entities sharing a targetname both receive the input** — Hammer shows it in bold in the name
list, the only signal, no compile error at all. The typical breakage: two doors accidentally named
alike open together. `[consensus]`

Verifying: `read_vmf` (a histogram of `targetname`s); `read_vmf_lint` reports the orphaned targets
it can resolve statically.

## `!activator` / `!caller` / `!self` / `!player`

| Keyword | Resolves to |
|---|---|
| `!activator` | the entity at the origin of the causal chain (the player touching a `trigger_multiple`) |
| `!caller` | the entity that just fired the current output — differs from `!activator` in the middle of a relay |
| `!self` | the entity receiving the input, valid only in its own I/O fields |
| `!player` | a shortcut to the single-player player, unreliable in multiplayer |

`[consensus]` Verify by isolating a two-relay chain and comparing the `!activator` received at the
last link against `!caller` — `ent_messages_draw` or `read_console` (gmod-mcp) shows it.

## The `logic_*` entities that matter

| Entity | Used for | Trap |
|---|---|---|
| `logic_relay` | centralising one trigger towards several targets, enable/disable-able without touching the source | badly named, it reads as a plain redirection — its point is the `Enable`/`Disable`, not just the fan-out |
| `logic_case` | branching over up to 16 values (`OnCase01..16`), with native random picking | no default when nothing matches — plan an `OnDefault` or a guard |
| `logic_branch` + `logic_branch_listener` | a binary decision shared between several listeners | `logic_branch` alone does not notify the other branches — the listener is required to synchronise |
| `math_counter` | counting events before acting | its `OutValue` output does not reset itself — an explicit `SetValue 0` is needed to re-arm |
| `logic_auto` | firing a chain when the map loads | counts as a network edict, not a purely logical entity — see below |

Verifying: `read_vmf` for the inventory, `read_fgd_class` for a class's exact inputs and outputs
before using it.

## `logic_auto` and spawn order

`OnMapSpawn` fires **before the player is guaranteed to have spawned** — reaching for them with no
delay can raise an access violation. `[consensus]` **No ordering guarantee exists between several
entities listening to `OnMapSpawn` in parallel**: two `logic_auto` (or the relays they feed) can run
in a different order from one round to the next. `[consensus]` A `logic_auto` counts as a network
edict, not a purely logical entity — a `logic_relay` on its `OnSpawn` is the alternative when edicts
are tight. `[engine]`

Verifying: add a short delay and see whether the access bug goes away; no tool proves the order up
front — human judgement, not tooled.

## Triggers and their flags

`trigger` (the base class, outside the FGD) must never be placed as is: `InitTrigger` is not called,
so neither model nor collision is set up. `[engine]` Use `trigger_multiple`/`trigger_once`/etc.,
which inherit from it correctly.

⚠️ **The `Clients (Players)` flag is often unticked by default.** Without it the trigger exists,
compiles, and produces **no error at all in game** — it simply ignores the player and reacts only to
the classes its other flags cover (NPCs, physics). It is the single most reported mistake in Source
mapping, because nothing warns that it is missing. `[consensus]`

Verifying: `read_vmf_lint` (if the rule is covered), or in game spawn and walk through with
`gmod-mcp` → `spawn_entity`, then watch the output fail to fire.

## Filters

A `filter_*` inspects a candidate activator and rejects it when it does not match — referenced by
the `Filter Name` keyvalue of the trigger or entity using it. `filter_multi` combines several
filters. `[engine]` `filter_activator_name` / `filter_activator_class` cover the common case; prefer
one reusable filter across several triggers over stacking `logic_case` on classname.

⚠️ **A filter cannot be disabled by an output — only destroyed** (`Kill`). `[engine]`

Verifying: `read_fgd_class` on the exact filter before using it — the list of filters varies by game
(26 classes counted on the stock engine, several of them gamemode-specific).

## The hard limits — do not confuse the two families

**`MAX_MAP_ENTITIES` = 8192 is a compile-time limit**, that of lump 0 as `vbsp` writes it — go past
it and `vbsp` refuses with an explicit error. `[engine, bspfile.h:62]`

**`MAX_EDICTS` = 2048 is the runtime limit of the stock Source 2013 engine** — how many network
entities (players, NPCs, spawned props included) can exist *at the same time in game*. `[engine,
const.h:65-67]` These are two different counters, measured at two different moments; a map can
respect one and exhaust the other once players are inside it.

**The runtime value Garry's Mod actually uses is not verifiable in this repository** (closed
engine): `[consensus]`, to be measured on the real instance rather than quoted from memory. Detail
and measurement method in [gmod.md](gmod.md), §"Two numbers not to confuse with their neighbour".

Verifying the compile-time count: `read_bsp_entities` (hammer-mcp). Verifying the real runtime
count: `read_entities` (gmod-mcp).
