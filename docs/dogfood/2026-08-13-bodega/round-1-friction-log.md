# Friction log — `hmcp_bodega`

### No tool creates a `.vmf`
- **Wanted:** create `hmcp_bodega.vmf` from nothing, as the brief instructs ("You create `hmcp_bodega.vmf`").
- **Called:** `write_vmf_solid` with `path: .../hmcp_bodega.vmf`, one box, `dryRun: true, confirm: true`.
- **Expected:** the writer would create the file, or refuse with a message naming the tool that does.
- **Got:** `write_vmf_solid failed: ENOENT: no such file or directory, open '.../hmcp_bodega.vmf'` — a raw Node errno, with no hint about what to do next. I then read the source: `src/tools/build.ts:140` does `readFileSync(path)` unconditionally, and `insertSolids` (`src/vmf/build.ts:454`) throws "this file has no `world` block to add solids to", so even a zero-byte file would not do. I enumerated all 65 tool names in `src/tools/*.ts`: none creates a VMF, and no description mentions "new", "blank" or "from scratch".
- **Worked around by:** breaking the no-hand-edit rule exactly once, to write an **empty skeleton** — `versioninfo`, `visgroups`, `viewsettings`, an empty `world`, `cameras`, `cordons`. Zero solids, zero entities, zero keyvalues that describe the map. Every brush and every entity below went through an MCP tool. Flagging it loudly rather than hiding it: this is the one byte-level exception, and it is forced, not chosen.

### `edit_vmf` reports failure on a call that fully succeeded
- **Wanted:** add six entities (`info_player_start`, three `info_target`, two `light`) in one call.
- **Called:** `edit_vmf` with six `add` ops, `confirm: true`, and **no** `dryRun` argument.
- **Expected:** a success payload listing the six new entity ids.
- **Got:** `MCP error -32602: Output validation error: Invalid structured content for tool edit_vmf: Required at dryRun` — an error, with no indication whether the file had been touched. It had: `read_vmf` immediately after shows all six entities present, ids 108-113. The tool's declared output schema requires a `dryRun` field the handler does not emit when the caller omits the input `dryRun`.
- **Worked around by:** verifying with `read_vmf` instead of trusting the response, and passing `dryRun: false` explicitly on every later `edit_vmf` call. The danger here is not the error, it is that a retry would have silently double-added all six entities.

### A standable furniture top becomes a room that no rule can satisfy
- **Wanted:** a 40-unit counter and 64-unit shelving in the shop.
- **Called:** `check_vmf_rules` on a map with a 32x128x40 counter.
- **Expected:** furniture is furniture; the rules are about rooms.
- **Got:** two errors — `"room 1: headroom is 104 units"` and `"room 1: room area is 6912 square units"`, both `at [304,48,48]`, which is the top of the counter. `read_vmf_rooms` confirmed a room with `"connectsTo":[]`. A raised slab you can stand on is a room, and because it connects to nothing, the `minRoomArea` merge can never absorb it: I shrank the counter until its top pocket was 3840 < the 4096 threshold and it was still reported. No room rule can ever pass on a counter top — it is 104 tall and 4 m2 by construction.
- **Worked around by:** reading `src/space/voxel.ts:41` (`STANDING_CELLS = ceil(72/step)`) and making every piece of furniture 80 units tall, so only 64 units remain to the ceiling and no top is standable at either step 16 or step 8. That is a real constraint dressed as a style choice: the shop's counter is 80 units tall because of the voxeliser, not because I wanted a screen.

### Two obvious rooms read as one, and the reason is not in any output
- **Wanted:** the sales floor and the storeroom to be two rooms with a doorway between them, so `select: {"room":"*"}` and `select: {"portal":"*"}` have something to match.
- **Called:** `read_vmf_rooms` and `check_vmf_rules`, repeatedly, at `step` 16 and 8 and `minRoomArea` 0 and 4096.
- **Expected:** a 64-wide doorway in a wall between two 384-unit-wide rooms is a constriction by any definition.
- **Got:** `"roomCount":1`, `"portals":[]`, and from `check_vmf_rules` the note `"1 rule(s) matched nothing at all: doorways-wide-enough"`. Nothing in any output says *why* the two did not separate, and the failure is silent in the direction that matters: `errorCount` was 0, so the map looked compliant while one of the seven rules was checking nothing at all. I tried, in order: deepening the doorway to a 64-deep neck (made it worse — the neck becomes its own basin and bridges both rooms), deepening the storeroom from 112 to 224 units, and `step: 8`. None worked.
- **Worked around by:** reading `src/space/rooms.ts:345-367`. Two regions merge when `max(clearance)` across their boundary is `>= min(peak_a, peak_b)`, and `peak` is indexed by the union-find root, which is `min(index)` — so when a tiny dead-end basin with a low cell index is absorbed into a large room, the merged region keeps the *tiny* region's peak for the rest of that pass, and then bridges to the next room through the doorway. The practical rule, which appears in no documentation: **any dead-end nook creates a basin, and a nook with a low cell index silently destroys the room split anywhere else in the map.** A free-standing shelf island in the middle of the shop did it; so did a counter that stopped 32 units short of the south wall, leaving a 32x32 corner. I moved the shelving flush against the west wall and extended the counter to meet the south wall — no nooks — and the two rooms appeared with a 64-unit portal. The shop's furniture layout is therefore dictated by a watershed implementation detail, not by the brief.

### `read_vmf_rooms` exposes `minRoomArea`; `check_vmf_rules` does not
- **Wanted:** to check whether the offcut threshold was what merged my rooms, using the same knob on the tool that actually reports violations.
- **Called:** `check_vmf_rules` — its parameters are `step`, `maxCells`, `seeds`, `severity`, `limit`.
- **Expected:** the room-finding parameters to be the same on both tools, since one calls the other.
- **Got:** no `minRoomArea` on `check_vmf_rules`, so the two tools cannot be made to agree on a segmentation. Diagnosing on `read_vmf_rooms` and then checking on `check_vmf_rules` means the diagnosis is always at slightly different settings than the verdict.
- **Worked around by:** doing every experiment at the default step 16 and never relying on the knob.

### The good news from `read_leak` arrives as a tool failure
- **Wanted:** the fourth step the brief asks for — confirm on the compiled `.bsp` that the compiler agrees the map is sealed.
- **Called:** `read_leak` with `path: .../hmcp_bodega.bsp`.
- **Expected:** a result saying the map did not leak.
- **Got:** `read_leak failed: .../hmcp_bodega.lin does not exist. vbsp writes it beside the map when it leaks, so no pointfile usually means the last compile did not leak` — the right answer, delivered as an error, with "usually" hedging the one thing I wanted confirmed. An agent that treats a tool error as a failure would read a sealed map as a broken step; an agent that reads the sentence gets the answer. The sentence is good; the error channel is the wrong one to put it in.
- **Worked around by:** reading the message, and cross-checking against `run_compile`'s own `"leaked": false`.

### vbsp's skybox complaint is reported for a map with no sky
- **Wanted:** a clean compile log.
- **Called:** `run_compile`, `fast: true`.
- **Got:** two `info` findings, `"Skybox vtf files for skybox/sky_day01_01 weren't compiled with the same size texture and/or same flags!"`. The map is a sealed interior with no `toolsskybox` face anywhere, so the default cubemap it is trying to build is for a sky that is never visible. Correctly classified `info` and `clean: true`, so nothing was blocked.
- **Worked around by:** nothing — left as is. Noted only because the first reading of a red-looking `*** Error:` line in the log costs a minute before you notice the tool already graded it `info`.
