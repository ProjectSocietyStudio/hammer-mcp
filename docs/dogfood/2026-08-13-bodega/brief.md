# `hmcp_bodega` — the brief

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

## What is left open

Deliberately. A brief that fixes every coordinate measures typing, not tooling.

- The footprint, the wall thickness, the exact position of the counter and the shelving.
- Materials, as long as they exist in Garry's Mod's own content.
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

## Done

Three greens, in this order, and none of them is an opinion:

1. `read_vmf_leak` — sealed, without a compiler.
2. `check_vmf_rules` — no violation, and nothing in `matchedNothing`.
3. `run_compile` with `fast: true` — vbsp, vvis and vrad without an error.

Then `read_leak` on the result, to see whether the compiler agrees with `read_vmf_leak`. Two
independent answers to the same question is the only reason to ask it twice.
