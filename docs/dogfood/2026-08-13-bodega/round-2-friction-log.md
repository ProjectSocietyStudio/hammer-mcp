# friction log — hmcp_bodega

### Every hammer-mcp tool schema had to be fetched before it could be called
- **Wanted:** call `mcp__hammer-mcp__health` as my first action.
- **Called:** nothing — the tool names were listed as deferred, with no parameter schema.
- **Expected:** to call the tools named in my instructions directly.
- **Got:** `calling them directly will fail with InputValidationError. Use ToolSearch with query "select:<name>..."`
- **Worked around by:** three `ToolSearch` round-trips across the session (7 tools, then 8, then 4), because I could not know in advance which tools the map would need. This is a harness property rather than hammer-mcp's, but it cost three turns before any map work happened.

### `write_vmf_solid` gives every face of a box the same material
- **Wanted:** a floor brush whose top face is tile and whose sides, which nobody sees, are nodraw.
- **Called:** `write_vmf_solid` with `material: "TILE/TILEFLOOR001A"`, one box.
- **Expected:** some way to say "this material on the +Z face, nodraw elsewhere".
- **Got:** the parameter is documented as `"Material for every face."` — it is a single string, and the returned `verified` block confirms 6 sides written identically.
- **Worked around by:** accepting one material per brush. `set_face_material` exists and could fix it per face afterwards, but that is a second write and a face index I would have to look up; on a 14-brush map I judged it not worth it. A `materials: {top, bottom, sides}` form on the writer would have removed the question.

### The seed point I gave was silently moved
- **Wanted:** flood from the `info_player_start` I placed at `48 40 32`.
- **Called:** `read_vmf_leak`, no `seeds` (so it takes the spawn entities).
- **Expected:** `seeds` echoed back as `[[48, 40, 32]]`.
- **Got:** `"seeds":[[48,40,48]]` — z moved from 32 to 48.
- **Worked around by:** nothing, it did not matter here. But the output never says *why* it moved (cell-centre snap? a lift off the floor?), and on a map with a low mezzanine that 16-unit lift is the difference between seeding the right space and the wrong one.

### The sightline rule traces at a height nothing documents
- **Wanted:** `register` to see `front_door`. Both entities sit at z 48, and the doorway opening ran z 0..112, so a level trace between them was clear by 64 units.
- **Called:** `check_vmf_rules`, rule `the-till-watches-the-door`.
- **Expected:** a pass.
- **Got:** `"register cannot see front_door: brush 58 (PLASTER/PLASTERWALL003A) is in the way"`, `"at":[81.88461538461539,0.03125,112]`.
- **Worked around by:** deducing the trace height from the hit point. `z = 112` is exactly `origin_z + 64` (the standing eye height) and exactly the underside of my lintel. Nothing in the rules file, the brief or the tool description says the sightline is traced at eye height above the entity origin rather than through it — I inferred it from one coordinate. I then raised the lintel to z 144. A one-line `"traced from [x,y,z] to [x,y,z] at eye height 64"` in the violation would have said it outright.

### `matchedNothing` told me a rule matched nothing, not why
- **Wanted:** the rule `doorways-wide-enough` (`select: {portal: "*"}`) to find my 80-unit doorway between the two rooms.
- **Called:** `check_vmf_rules` on a map with a 32-unit-thick divider wall pierced by an 80x112 opening.
- **Expected:** one portal, 80 wide, pass.
- **Got:** `"matchedNothing":["doorways-wide-enough"]` and `overall: "fail"`. The message — `"A rule about a room or an entity the map does not have is a finding about the rules, not a pass."` — points at the rules file, which was not the problem.
- **Worked around by:** running `read_vmf_rooms` separately, which revealed `"roomCount":1` and `"portals":[]`: the watershed had merged my whole shop into a single room, so there were no two rooms for a portal to sit between. The nine `merges` entries each explain themselves well (`"the opening between them is 48 units where the narrower of the two spaces is 16"`), but *that* diagnosis lives in a different tool. `check_vmf_rules` knew it had found one room and zero portals and did not say so. Fix in the map: thicken the divider from 32 to 64 units so the doorway is a passage the watershed can see as a constriction. (That fix did not work either — see the two entries below. It took four more geometry rebuilds.)

### A shelving island in the middle of the room silently destroyed the segmentation
- **Wanted:** shelving down the middle of the sales floor, as the brief describes.
- **Called:** `read_vmf_rooms` on a sales floor 256x224 with a 32x64 shelf brush at its centre.
- **Expected:** the sales floor to read as one room with a peak clearance of about 112.
- **Got:** `"halfWidthUnits":80` and `"widestPoint":[176,368,...]` — the peak had moved into the *storeroom*. The sales floor's clearance peak had collapsed from 112 to 8, because the nearest solid to its centre was now the shelf 8 units away.
- **Worked around by:** moving the shelving against the west wall. The tool's own note says the heuristic "can split a hall with a pillar in it", which is the same phenomenon, but nothing in the output connected my missing room to that brush — I found it by noticing `widestPoint` had jumped to the wrong room. A "clearance peak here is bounded by brush 93" line would have named the culprit immediately.

### `mergeLimit` hid the evidence I was reasoning from
- **Wanted:** to see whether the doorway was being merged away, and on what grounds.
- **Called:** `read_vmf_rooms` with `mergeLimit: 4` (I lowered it to keep the output small).
- **Expected:** the four most important merges.
- **Got:** the four *last* merges — all trivial slivers. `"mergeCount":11` was correct, but the entries I needed were the earlier ones, and I spent two rounds concluding "the doorway split is never proposed" from a list that simply was not showing me the start of it.
- **Worked around by:** re-running with `mergeLimit: 30`. My own fault for trimming, but "newest first-hit last" is doing a lot of work in that description, and the merges that decide the room count are not the ones at the end.

### `measure_vmf_clearance` returned a confident, wrong 32 for a point the hull cannot occupy
- **Wanted:** the free width in the middle of the sales floor, to see why the room pass disagreed with me.
- **Called:** `measure_vmf_clearance` at `[128, 96, 16]` — 16 units above the floor, which is where `read_vmf_rooms` reports its own room slab (`"mins":[8,-8,8],"maxs":[248,536,24]`).
- **Expected:** roughly 192, the distance between the counter and the shelving.
- **Got:** `"widthUnits":32` with `"boundedBy":[{"brushId":null,"material":null,"distanceUnits":0,"unbounded":false}, ...]` and `"insideSolid":false`.
- **Worked around by:** realising the standing hull is 72 tall and is centred on the point, so at z 16 it is buried in the floor and every sweep returns 0. Re-measured at z 40 and got the correct `192`. The give-away was `brushId: null` at `distanceUnits: 0` — a bound with no brush. `insideSolid: false` actively argued the point was fine. This is the entry I would most want fixed: the tool should say "the standing hull does not fit at this point; its base is 20 units below the floor" rather than return 32, which is exactly the hull width and looks like a real narrow corridor.

### The room pass only segments the map at a cell size larger than the default — the finer, the worse
- **Wanted:** two rooms and one portal, from a sales floor 256x224 and a storeroom 256x224 joined by a corridor 64 wide and 96 deep. There is no more ordinary two-room map than this.
- **Called:** `read_vmf_rooms` at `step: 16` (the default), then `8`, then `4`, then `32`.
- **Expected:** finer cells to resolve the doorway better, per the parameter's own description ("16 is the coarsest that resolves a 32-unit doorway").
- **Got:** the exact opposite.
  - `step: 16` -> `"roomCount":1, "portals":[]`
  - `step: 8` -> `"roomCount":1, "portals":[]`
  - `step: 4` -> `"roomCount":1, "portals":[]`, and `mergeCount` climbing to 31 as the field fragments into ever more halfWidth-16 slivers
  - `step: 32` -> `"roomCount":2`, `"portals":[{"between":[0,1],"at":[192,288,32],"approxWidthUnits":64,"approxHeightUnits":96}]`
- **Worked around by:** running both `read_vmf_rooms` and `check_vmf_rules` with `step: 32`. This is a documented parameter and the tool explicitly asks you to pass the same value to both, so it is a legitimate call and not a fudge — but the default is the one value in the range that does not work, and the failure is silent and total. Before finding it I rebuilt the geometry four times chasing the merge criterion: thickened the divider 32 -> 64 -> 96, moved the shelving, deepened the storeroom to raise its half-width, narrowed the doorway 80 -> 64 and grid-aligned its edges. None of that was necessary; one parameter was. Roughly two thirds of this exercise went into it.

### `check_vmf_rules` and `read_vmf_rooms` do not share a default that works
- **Wanted:** to trust `check_vmf_rules` out of the box.
- **Called:** `check_vmf_rules` with no `step`.
- **Expected:** it to segment the map the way a person looking at the plan would.
- **Got:** `overall: "fail"` with `matchedNothing: ["doorways-wide-enough"]`, for a map that passes cleanly at `step: 32`.
- **Worked around by:** passing `step: 32` explicitly. Both tools default to 16. If a caller only ever runs `check_vmf_rules`, as the brief's "three greens" invites, there is no signal at all that the cell size is what is wrong — the rule just matches nothing and the note blames the rules file.
