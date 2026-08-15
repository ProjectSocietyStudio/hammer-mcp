# `hmcp_rotunda` — the brief

A round brick cistern with a conical roof, a central pier holding it up, one arched door, and a
square annexe off the side. Underground would suit it; the Bronx has a few.

Six maps built with these tools, and every one of them is boxes pushed against each other.
This one is not.

## Why this subject and not another

Twenty-nine of the seventy-four tools have never been called once, and one cluster is there
because nothing built here has ever needed a shape the grid does not hand you:

| Never called until this round | What only a curve asks for |
|---|---|
| `hollow_solids` | a room made by taking a block away rather than by stacking six slabs |
| `align_faces` | a texture that runs *around* an arc instead of being projected onto each facet |
| `move_vertices` | a corner pulled off the grid — a chamfer, a splay, a wall meeting a street that is not square |
| `set_smoothing_groups` | **the one thing no render here can show**: whether sixteen facets read as a cylinder or as sixteen flat plates |
| `group_solids` | sixteen brushes that are one wall, and have to be selectable as one |
| `read_vmf_surfaces` | "which of these faces is a floor" on geometry where the answer is not obvious |

And three shapes `write_vmf_solid` has offered since it was written and nobody has ever
asked for: **`arch`**, **`cylinder`**, **`cone`**.

## What is new, beyond shape

- **Sealing something round.** Six maps sealed by stacking boxes. A ring of sixteen wedges
  with a gap cut in it for a door is a different problem, and `read_vmf_leak` is about to
  earn its keep.
- **Faces that are neither floor nor wall.** A cone's every face is a slope; a cylinder's are
  all "side" and none of them are axis-aligned. Every classifier in this toolkit cuts at 45°
  from an axis, and none of them has ever met geometry that does not.
- **Lighting a curve.** Smoothing groups exist so vrad lights adjoining facets as one
  surface. Getting them wrong is silent — the file stores a bitmask, and the map still
  compiles. **Nothing offline can see the difference**, which is why this round ends in the
  game rather than in a render.

## What must be true

The machine-readable half is [`hmcp_rotunda.rules.json`](hmcp_rotunda.rules.json).

- **The rotunda has at least 24 000 square units of floor**, pier included in what it takes
  away.
- **112 units of clear headroom** everywhere a person can stand, under the dome as under the
  annexe's flat ceiling.
- **The door is at least 64 units wide.**
- **48 units of clear floor inside the door.** You have to be able to stand where you land.
- **From the door, the far wall of the annexe is not visible.** The annexe is off to one side;
  a round room does not put its own back door on show.

## What cannot be checked, and is required anyway

The protocol's own rule — a requirement with no checkable form is a finding about the schema.
This round has four, and they are all about the same thing: **the tooling has no vocabulary
for shape.**

1. **The rotunda is round.** Nothing measures curvature. `circulation_width` on a circular
   room reports its diameter, which a square room of the same span reports too.
2. **The facets read as a curve.** Smoothing groups are a bitmask in a file. No offline
   reader relates them to what a surface looks like.
3. **The texture runs around the arc.** `align_faces` sets axes; nothing says whether the
   result lines up between one segment and the next.
4. **The chamfer is a chamfer.** `move_vertices` refuses what would leave a face non-planar,
   which is a validity check, not a judgement that the shape is the one intended.

## What must be built, and not just measured

- **Sixteen segments, not four.** A cylinder coarse enough to read as a polygon is a box with
  extra steps. Sixteen sides at radius 256 gives a facet of about 100 units, which is the
  usual compromise.
- **Smoothing groups on every curved run**, and only there: a group shared with a flat wall
  bleeds the lighting across the corner it should be defining.
- **The arch's texture aligned to the face, not to the world.** Projected from the world axes,
  a brick on a 22.5° facet is a brick squashed by cos 22.5°, sixteen times, each differently.
- **A chamfer somewhere a person's hand would go**, cut with `move_vertices` rather than built
  as another box.
- **Materials from the game's own content, resolved** — `read_game_content` with `details`
  now reports whether a material's textures exist, which is #77.

## What is left open

The radius, the wall thickness, how many segments, where the annexe goes, how the roof meets
the wall, and every material.

## What the map must name

| `targetname` | What it marks |
|---|---|
| `door` | just inside the arched doorway |
| `pier` | the foot of the central column |
| `annexe_back` | the far wall of the annexe, from the door's point of view |

Plus an `info_player_start` in the rotunda.

## Done

1. `read_vmf_leak` — `sealed: true`.
2. `check_vmf_rules` — `overall: "pass"`, nothing in `matchedNothing`.
3. `read_vmf_solids` over every brush — a curve is where an invalid solid comes from, and this
   is the first map where that is a real risk rather than a formality.
4. `run_compile` — vbsp, vvis and vrad without an error, then `read_leak` on the `.bsp`.
5. `render_vmf_plan` and `render_vmf_tour`, described frame by frame.
6. **In the game.** Not optional this round and not a nicety: smoothing groups are invisible
   to every tool here, and a sixteen-sided cylinder that reads as sixteen plates is a map that
   passed every check and looks wrong. The renders show form; only the engine shows light.
