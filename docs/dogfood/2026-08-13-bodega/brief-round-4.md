# `hmcp_bodega` — the brief, round 4

Identical to [`brief.md`](brief.md) except for the two sections marked **new**. Rounds 1 to 3
used that brief byte for byte; this one changes it deliberately, because what those rounds
proved is that the brief itself was the ceiling.

All three earlier maps reached every green. Loaded in game, the third had a door painted flat
on a wall, counters and shelving that were each a single box, and no skirting in any shot.
Nothing in the brief asked for any of that, so nothing produced it — and `check_vmf_rules`,
which is the stopping condition, was satisfied.

---

A corner shop, the kind that occupies the ground floor of a Bronx tenement: you come in off
the street, there is a till on your right and shelving down the middle, and a door at the back
into a storeroom the customers never enter.

This is the whole map. There is no street, no upstairs, no second shop. It is small on
purpose: a place small enough to build in one sitting, and complete enough that every stage of
the toolchain has something to say about it.

## What must be true

These are requirements, and each one is checkable — the machine-readable half is
[`hmcp_bodega.rules.json`](hmcp_bodega.rules.json), which is a sibling of the `.vmf` and is
read by `check_vmf_rules`.

- **Two rooms and one doorway between them.** A sales floor and a storeroom.
- **Every doorway is at least 64 units wide.** Two people meeting at one should not have to
  take turns.
- **Ceilings are at least 112 units clear** everywhere a person can stand. A shop with a low
  ceiling reads as a basement.
- **The till has at least 48 units of clear floor in front of it.** A customer stands there.
- **From the till, the front door is visible.** The shopkeeper watches who comes in; this is
  the one sight line the place is arranged around.
- **From the front door, the inside of the storeroom is not visible.** What is behind the
  counter is the shop's business, not the street's.
- **Each room has at least 24 000 square units of floor** — about 15 m². Below that neither is
  a room, it is a cupboard.

## What must be built, and not just measured — **new**

None of these has a rule behind it. They are here because three maps satisfied every rule and
still looked unbuilt, and a brief that cannot ask for finish will not get any.

- **Nothing a person touches is a single brush.** The counter is a counter, not a block: a
  worktop, a body, a recess at the foot. Same for shelving. `write_vmf_fitting` builds these
  and supplies every internal dimension itself.
- **Every doorway has a frame.** A rectangular hole with sharp arrises is not a doorway, it is
  an absence. `write_vmf_fitting`'s `door_frame` goes around a hole you have already cut.
- **The rooms have skirting.** Wall meeting floor at a bare right angle is the clearest tell
  there is. `omit` the walls with openings in them rather than running trim across a doorway.
- **Build to Source's own scale, not to the real world's.** Heights in Source are four thirds
  of real — measured on three unrelated Valve models — while the player is one to one. A door
  leaf is 48 × 108, a shop counter is 56 tall, casework is 24 deep. The full table, with each
  number's provenance, is `src/vmf/fittings/dimensions.ts`. Do not invent a height that is in
  it.
- **Materials that are not the developer grid.** Three walls of `DEV/DEV_MEASURE` is a map
  that was never finished. `read_game_content` is the texture browser.

## What is left open

Deliberately. A brief that fixes every coordinate measures typing, not tooling.

- The footprint, the wall thickness, the exact position of the counter and the shelving.
- Which materials, as long as they exist in Garry's Mod's own content.
- Lighting, as long as the map is not black.
- Whether the shelving is brushwork or props.

## What the map must name

The rules point at entities by name, so these targetnames have to exist:

| `targetname` | What it marks |
|---|---|
| `register` | the till, on the shop side of the counter, facing the customer |
| `front_door` | the doorway onto the street |
| `storeroom` | a point inside the storeroom, away from its door |

Any class with an `origin` will do for the two markers; `info_target` is the obvious one.
`register` also needs `angles`, because clearance in front of it is measured along its yaw.

The map also needs an `info_player_start`: the room pass floods from spawn entities, so
without one every room rule reports that it was not checked.

## Done — **new fourth item**

Three greens, in this order, and none of them is an opinion:

1. `read_vmf_leak` — sealed, without a compiler.
2. `check_vmf_rules` — `overall: "pass"`, and nothing in `matchedNothing`.
3. `run_compile` with `fast: true` — vbsp, vvis and vrad without an error.

Then `read_leak` on the result, to see whether the compiler agrees with `read_vmf_leak`. Two
independent answers to the same question is the only reason to ask it twice.

**And then, before you conclude: `render_vmf_tour`, and write down what you see.** Frame by
frame. What is in it, and what is missing from it. If a frame shows a bare wall meeting a bare
floor, say so; if a doorway has no frame, say so. This is not a formality and it is not the
same as the three greens — it is the only step in the list that can see whether the place looks
like a place.

You are allowed to conclude that something you built is wrong. That is the point of looking.
