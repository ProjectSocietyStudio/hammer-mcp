# Friction log — `hmcp_bodega`

Appended as it happened.

### `clearance_in_front` says 0 and does not say what stopped it
- **Wanted:** to know why the `register` marker, standing in open floor 8 units west of the counter and facing west into ~200 units of empty shop, measured no clearance at all.
- **Called:** `check_vmf_rules` on the map, rule `room-to-stand-at-the-till` (`clearance_in_front`, min 48), register at `248 160 40` with `angles "0 180 0"`.
- **Expected:** either a large number, or a failure naming the brush in the way — `measure_vmf_clearance` names the bounding brush for every number it returns, so I expected the rule to do the same.
- **Got:** `"clearance in front is 0 units, and this map's rules ask for at least 48 units."` with `"at":[248,160,36.53125]`. No brush named, no statement of which way "in front" was taken to be, and no `hullFits` field of the kind `measure_vmf_clearance` returns.
- **Worked around by:** guessing that the 32-wide player hull centred on the origin already overlapped the counter at x=256 (origin x=248 gives a hull of 232..264), and moving the marker west until the hull cleared it. The guess was right, but nothing in the output said so — the same "0" would have come back if my yaw convention had been wrong, which was my first and much more expensive hypothesis.

### Adding furniture silently collapsed two rooms into one
- **Wanted:** to add a counter and two runs of shelving without changing what the map *is*.
- **Called:** `write_vmf_solid` for three boxes (all flush to a wall, as `building.md` instructs), `set_solid_class` to `func_detail`, then `check_vmf_rules` again.
- **Expected:** the same segmentation as before — `rooms: 2, portals: 1` — since no brush touched the divider or the doorway.
- **Got:** `"segmentation":{"rooms":1,"portals":0,"step":16}` and `"matchedNothing":["doorways-wide-enough"]`, where the identical call minutes earlier had returned `rooms: 2, portals: 1`. The doorway had not been touched.
- **Worked around by:** re-running at `step: 32`, which the documentation told me to try. This is the documented non-monotone segmentation trap (issue #53) and it cost me minutes rather than the hour it evidently cost the builders it was written from — but the failure mode is still that a rule about a doorway goes quiet when you change something at the other end of the map.

### No cell size recovered it, and the culprit had to be found by bisection
- **Wanted:** to find out which of the three furniture brushes destroyed the doorway, since varying `step` did not bring it back.
- **Called:** `check_vmf_rules` at `step` 8, 16, 24, 32 and 48; then `delete_solids` one brush at a time followed by `read_vmf_rooms`.
- **Expected:** one working `step`, per the measured table in `building.md`.
- **Got:** `"rooms":1,"portals":0` at every one of the five cell sizes, each with the same note — *"That is about the segmentation, not about the rules file: try another 'step'."* The advice was confidently wrong here: the cause was geometry, and the note pointed away from it.
- **Worked around by:** deleting furniture one brush at a time. The storeroom shelf was innocent; the west shelving run (48 deep × 192 long × 64 tall, flush to a wall exactly as instructed) was the culprit. Re-adding it at 32 deep × 128 long restored `rooms: 2, portals: 1`. Four write-and-recheck cycles to learn that a shelf 16 units deeper, at the opposite end of the room, decides whether a doorway 200 units away exists. The `merges` array explains each merge it makes but says nothing about the portal that *stopped* being reported, which is the thing I needed explained.

### `write_vmf_solid` cannot add to an existing brush entity — except it can, undocumented
- **Wanted:** to add the replacement shelving into the `func_detail` I had already created, rather than making a second one.
- **Called:** `write_vmf_solid` with `entityId: 113`.
- **Expected:** to have to write to the world and then call `set_solid_class` again, since `entityId`'s description says only *"Hammer id of a brush entity to add them to"* and I had no way to know a `func_detail` created by `set_solid_class` was a legal target.
- **Got:** it worked — `"target":"func_detail"`. Fine, but I guessed. `set_solid_class` returns `createdEntityId` and does not say that this is the id you feed back to `write_vmf_solid`; the two tools are a pair and neither points at the other.

### To satisfy "at least 64 units" I had to build 80, and nothing said so
- **Wanted:** a doorway that passes `circulation_width` with `min: 64`.
- **Called:** `write_vmf_solid` for a divider with an 80-unit gap, then `read_vmf_rooms`.
- **Expected:** a portal reported at or near 80.
- **Got:** `"approxWidthUnits":64` for a gap I built at 80 — one cell lost, exactly as the note explains (*"a cell is free only when its whole interior is"*, and *"Portal widths are voxel estimates to within a cell"*). Both notes are honest and neither is actionable at the moment you are choosing a number.
- **Worked around by:** having over-built the gap to 80 for unrelated reasons, so a measured 64 landed exactly on the bar. Had I built the doorway at the 64 the brief asks for, it would have measured 48 and failed its own rule, and the natural reading of that failure is "widen the door" when the truth is "the ruler is coarse". Nothing warns when a measured value sits exactly on a threshold, which is the case most likely to flip.

### `write_vmf`'s default skybox cannot build cubemaps in this install
- **Wanted:** to accept the default and move on.
- **Called:** `write_vmf` with `skyname` left at its default, `sky_day01_01`.
- **Expected:** a default shipped by the tool to be one the configured game can compile against.
- **Got:** two `*** Error:` lines from vbsp — `"Skybox vtf files for skybox/sky_day01_01 weren't compiled with the same size texture and/or same flags!"` and `"Can't load skybox file skybox/sky_day01_01 to build the default cubemap!"`.
- **Worked around by:** nothing — `run_compile` correctly downgrades these to `severity: "info"` with a note saying they are harmless for geometry and that `buildcubemaps` in game is the fix. Good triage. But the tool that *chose* the value is the one that could have checked it: `write_vmf` has `read_game_content` available to it and picked a name that errors.

### A doorway onto a street, in a map with no street
- **Wanted:** a `front_door` that reads as a door to the outside, in a map the brief also requires to be sealed.
- **Called:** nothing — this is the decision I had to make before any call.
- **Expected:** some guidance on the standard move, since "an opening at the edge of the map" is the single most common way a first map leaks.
- **Got:** no tool and no reference page addresses it. `read_vmf_leak` would have told me *after* I cut the hole; `write_vmf_solid` cuts an opening to the void without comment.
- **Worked around by:** building the doorway as a 16-deep recess with a solid door leaf behind it, so there is a visible doorway and the hull stays closed. This is the right answer, but I had to know it in advance; a builder who did not would cut the opening, leak, and be told only where the leak is.

### `materials` has three roles and a brush has six faces
- **Wanted:** the door texture on only the inward face of the outer skin brush.
- **Called:** `write_vmf_solid` with `material: "METAL/METALDOOR001A"`.
- **Expected:** to name one face.
- **Got:** the roles available are `top`, `bottom` and `sides` — every vertical face is one role, so "the +y face only" is not expressible. The whole slab is a door.
- **Worked around by:** accepting it, since the other five faces face the void and nobody sees them. `set_face_material` with `facing` has the same three-way split, so the fix would have been a second tool call that also cannot say "+y".

## What the documentation saved me

- **The non-monotone `step` trap (`building.md`), and the whole idea of it.** When `check_vmf_rules` came back with `matchedNothing: ["doorways-wide-enough"]`, my instinct was that my divider or my doorway was wrong, and I would have rebuilt geometry. The reference told me the segmentation is a heuristic with a cell size that does not converge, so my first move was to sweep `step` instead. That sweep is what proved the cause was *not* segmentation, which is what sent me to bisecting the furniture. Without it I would have spent that time rebuilding a doorway that was correct all along — the reference says this cost one builder three divider rebuilds and two shelving moves.
- **"Put shelving flush to a wall and run a counter to the end of its wall unless you mean to divide the space."** I built every piece of furniture flush from the start. Given that a *flush* 48-deep shelf still collapsed the room count, a free-standing one down the middle — which is what the prose brief literally describes — would have failed immediately and looked like a geometry error. Saved at least one full build-and-diagnose cycle.
- **"The spawn is what the flood starts from."** Both `write_vmf`'s own return note and `building.md` say that no `info_player_start` means every room rule reports `skipped`. I placed the spawn in the same edit as the markers. On the classic reading of `errorCount: 0` I would have declared victory on a map where nothing had been checked.
- **"Read `overall`, never `errorCount`."** Stated three times across the skill, the reference and the tool description. My furniture regression returned `errorCount: 0, violations: []` and `overall: "skipped"` — a run that looks perfect and checked nothing. This is the single highest-value sentence in the documentation.
- **"Measure at body height, not at floor height"** and the note that a counter top comes back under `unreachable`. I put the markers at z 40–48 rather than on the floor, and I did not waste a cycle wondering why four standable regions were being reported as not-rooms.
- **`read_game_content` existing at all.** The skill frames it as "Hammer's texture browser, which an agent otherwise does not have", and that framing is what made me look up four material names instead of writing them from memory. `WOOD/WOODWALL009A` and `METAL/METALDOOR001A` are both real; had I guessed a plausible-looking neighbour, vbsp would have compiled it happily and the purple checkerboard would only have shown up in game.
- **"Copy the `.vmf` out of any read-only tree before compiling."** Told me the `.bsp` lands beside its source, so I knew before running a compile where the output would go and that the scratchpad had to be the working directory.


