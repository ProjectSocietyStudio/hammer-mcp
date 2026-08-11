# The craft of level design

The craft: sizing, blocking out, composing and making a map read. Not visibility — what a sightline
does to `vvis`, hints and areaportals live in [visibility.md](visibility.md). Here a sightline is
judged by its effect on the **player**: readable, broken, or a landmark.

## The scale trap

**"1 Hammer unit = 1 inch" is true by convention, not by engine constraint** — Source imposes no
real-world size on the unit; it comes from the assets. `[engine]`

⚠️ **Two scales coexist within the same game.** Architecture and most props are modelled on a
1/16-foot base; characters on 1/12 of a foot — roughly 33% larger for a wall or a door than for the
silhouette walking through it. `[engine]` So there is no single reliable HU→metres conversion: a room
dimensioned "to the real thing" and played at player height feels small, precisely because the set
and the actor do not share a ruler.

## The dimensions table (Hammer units)

| Quantity | Value (HU) | Provenance |
|---|---|---|
| Standing hull (width × depth × height) | 32 × 32 × 72 | `[engine]` |
| Crouching hull (HL2) | 32 × 32 × 36 | `[engine]` |
| Crouching hull (CS:S) | 32 × 32 × 45 | `[engine]` |
| Minimum passage width, straight wall / at 45° / wall off the grid | 33 / 46 / 65 | `[engine]` |
| Standing eye height (+ jump) | 64 (→ 85) | `[engine]` |
| Crouching eye height (+ jump) | 28 (→ 49) | `[engine]` |
| Step size (climbed without jumping) | 18 | `[engine]` |
| Jumping over an obstacle, standing, plain / jump+crouch (**Garry's Mod**) | 30 / 68 | `[engine, GMod]` |
| Jumping over an obstacle, crouched (**Garry's Mod**) | 21 | `[engine, GMod]` |
| Horizontal gap cleared at equal height — standing still / running / sprint+crouch-jump | 84 / 176 / 272 | `[engine]` |
| Crouch-jump, vertical obstacle (CS:S, official combos) | 61 to 65 | `[engine, CS:S]` |
| Crouch-jump clearance in GMod | ~62-68 depending on technique — Valve documents nothing here | `[disputed]` |
| Steepest slope walkable without sliding | 45.573° | `[engine]` |
| +use range (switch, handle) | 82 | `[engine]` |
| "Normal" corridor width | 64 | `[engine]` |
| "Normal" corridor ceiling height | 128 | `[engine]` |
| "Normal" door (width × height) | 48 × 108 | `[engine]` |
| Door, the usual blockout dev texture | 56 × 112 | `[consensus]` — not an engine value, it depends on the real prop |
| Stair step (height × depth) | 8 × 12 | `[consensus]` |
| Staircase width, interior / exterior | 72 / 128 | `[consensus]` |
| 3D skybox scale | 1/16 (1/32 on Left 4 Dead) | `[engine]` |
| Default lightmap scale | 16 × 16 per texel | `[engine]` |

⚠️ **Movement speed cannot be read off a table.** Stock HL2/CS:S gives 320 sprinting, but DarkRP and
its movement addons routinely change `sv_maxspeed`, `sv_stepsize`, `sv_gravity`. Verify with
`read_convars` (`gmod-mcp`) on the target server before any fine calculation of corridor width or
ledge height — never a value found online.

Checking an existing dimension on a map: `read_map_geometry`, `read_brush_volumes`,
`read_map_extents` (`hammer-mcp`) — compare against the lines above rather than eyeballing it in the
editor.

## Block out before you detail

**A blockout is played before it is looked at.** Dev textures (orange for walls, grey for floors),
volumes in `toolsnodraw`/`toolsskip`, a 16 or 32 HU grid — never finer while the gameplay is
unvalidated. Dropping to 1-4 HU belongs to finishing, not to blocking. `[consensus]` The grid itself
and what makes a brush valid are covered by [brushwork.md](brushwork.md), not here.

**Dressing an untested blockout means redoing all of it if the scale is wrong.** `[consensus]` Test
in game before detailing, not after.

Verifying: human judgement in the editor (playtest the blockout), then `capture_screen`, `read_view`
(`gmod-mcp`) once in game.

## Composition and readability

- **A landmark is recognised by its silhouette**, not its texture — shape and verticality have to
  stay readable at distance and against the light. `[consensus]`
- **Light is a directional signal** as much as a corridor is: a brighter area draws the eye and
  therefore the movement. `[consensus]`
- **Repetition without variation destroys spatial memory**: the same corridor module with no
  landmark or contrast leaves the player unable to orient. `[consensus]`
- **A large blank wall flattens the reading of a volume** and leaves the light no contrast to work
  with. `[consensus]`

For what a sightline does to `vvis` and the visibility computation, see
[visibility.md](visibility.md). Here a line of sight is judged by its effect on **combat**: past
roughly 1028 HU damage falloff dominates, and past roughly 2048 HU a readable duel turns into spam
or sniping — an over-long sightline is a design problem before it is a performance one. `[engine/game,
TF2]`

Verifying: `read_sightlines` (`hammer-mcp`) measures length, not readability — composition itself is
human judgement, not tooled. It is not measured, it is looked at.

## Flow

**A loop beats a single corridor**: it stops one passage point from being camped. A chokepoint with
no cover is an instant death line, not a point of tension. `[consensus]` Breaking an over-long
sightline by offsetting a corner or placing cover preserves the route; closing the passage destroys
it.

Verifying: human judgement on the plan, confirmed by `read_sightlines` before and after the offset.

## Situation → choice

| Situation | Choice | Why |
|---|---|---|
| A room dimensioned from a real floor plan | enlarge slightly, never 1:1 | prop and character scales already diverge by ~33%; a "real-size" room feels crushed at player height |
| A step climbable with no stairs and no jump | ≤ 18 HU | past that the engine demands a jump — behaviour, not taste |
| Ramp or stairs | ramp for continuous flow, stairs to punctuate the rhythm | stairs introduce a pause and a vantage point, a ramp erases both |
| An over-long sightline in a combat zone | offset a corner or place cover halfway | breaks the line without closing the route |
| Detail density | concentrate on landmarks and eye level, simplify outside the usual field of view | the player almost never looks at the ceiling or at bare floor |
| Secondary versus main corridor width | 64 HU holds the engine "normal"; past 96-128 HU it is a two-way crossing decision, not a standard | a corridor under twice the hull width (64 HU) stops two players from passing each other |

## Playable scale versus realistic scale

An RP interior dimensioned from a real plan plays too small — see the scale trap above: set and
player do not share a base. **Enlarging slightly rather than copying** is a craft reflex, not a
single factor published by Valve: treat any precise coefficient as `[disputed]` until a primary
source fixes it, but keep "slightly larger than real" as a standing guide. `[consensus]`

## The roleplay-city case

A DarkRP map has no duelling objective — but it still inherits the readability and flow constraints
of a combat map, because the engine draws no distinction: the same hulls, the same step size, the
same sightlines bear on street circulation as on a CS corridor. **An over-long straight avenue has
the same effect as a sniping sightline** — it invites camping rather than street presence. Breaking
long perspectives with a façade offset or street furniture serves the same function as a hint
indoors: cutting a line without closing a route.

"Street", "lot", "block" are not notions the `.bsp` carries — `read_sightlines` measures lines of
sight between walkable points, not "the longest avenue". Naming belongs to `LORE.md`, not to this
page.

Verifying: `read_sightlines` for street perspectives, `read_convars` (`gmod-mcp`) for the server's
real speed and step size before any calculation of pavement width or kerb height — never an assumed
default.
