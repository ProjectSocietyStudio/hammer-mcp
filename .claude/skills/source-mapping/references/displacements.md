# Displacements and terrain

A displacement turns a quadrilateral brush face into a freely sculptable triangle mesh — the only
native tool for a continuous organic surface (terrain, hills, slopes). This page covers powers,
limits, sewing, alpha painting and collision — not visibility (`visibility.md`), not lighting
(`lighting.md`), not the blend materials themselves (`assets.md`).

## Powers and cost

The power fixes the triangle count **independently of the face's physical size**: a 64×64 face and
a 4096×4096 face at the same power have the same vertex count, only the triangles change size. A
displacement that is too large for its power produces enormous triangles and an angular look —
better to split into several displacements at the same power than to raise the power on one big
face.

| Power | Vertices per side | Triangles | Cost |
|---|---|---|---|
| 2 | 5 | 32 | light terrain, minor relief |
| 3 | 9 | 128 | ordinary terrain, visible detail |
| 4 | 17 | 512 | maximum detail, fragile collision — see ⚠️ below |

Triangles = `(1 << power) * (1 << power) * 2`, the formula from the header itself `[engine]`.
Available powers: 2 to 4 only, `MIN_MAP_DISP_POWER` / `MAX_MAP_DISP_POWER` `[engine]` — Hammer
offers nothing outside that.

⚠️ **Power 4 crashes on physics collision.** Documented as a crash cause when physics objects
(debris, ragdolls) touch a power-4 displacement `[consensus]` — prefer four sewn power-3
displacements (same total density, separate collision volumes and therefore more stable) to a
single power 4.

## Hard limits

`MAX_MAP_DISPINFO` = 2048 displacements per map `[engine]`. Lightmap limit: 125×125 luxels without
border, 128×128 with `[engine]` — unlike a brush face, VBSP cannot fragment a displacement that
exceeds it; the larger the displacement in units, the less you can lower the lightmap scale.

Note that this 125 is the displacement figure. A **brush** face is capped at 32
(`MAX_BRUSH_LIGHTMAP_DIM_WITHOUT_BORDER`); `MAX_LIGHTMAP_DIM_WITHOUT_BORDER`, despite its
obvious-looking name and a comment calling it "the actual max", aliases the displacement value.
Taking the obvious name gives four times the real limit for a brush face `[engine]`.

Verifying: `read_bsp_info` gives the compiled displacement count to compare against 2048;
`read_compile_log` reports a lightmap overflow at compile time.

## The three hard rules

**A displacement is created only on a world brush face**, never on a brush entity (`func_detail`,
`func_brush`, `func_breakable`…) `[engine]`. VBSP refuses any entity carrying a displacement —
error `"Displacement found on a(n) X entity - not supported (entity N, brush M)"`, compile stopped
dead, no BSP produced. `read_vmf_lint` has a dedicated rule (`displacement-on-entity`) that catches
it before the compile — and gives the real brush id, which the compiler never does: it always
prints 0.

**A displacement never blocks visibility**, whatever material is applied `[engine]`: vvis ignores
it entirely for the PVS. Counting on one to cut a line of sight produces an enormous PVS and
framerate drops that make no sense until this point is checked. The structural / hint / areaportal
split is covered in `visibility.md`.

**A displacement never seals against the void**, even when topologically closed to the eye
`[engine]`: the leak detection hull ignores it. A displacement floor placed directly over the void
leaks while nothing looks open.

Verifying all three: compile and read `read_compile_log` for the entity error or the leak warning;
`read_leak` turns a leak into a named entity if the compile fails. The visual behaviour (a sightline
going through, a door that should not be visible) is confirmed in game — human judgement on the
screenshot.

## Sealing an exposed displacement

Under any displacement exposed to the void (terrain, roof), a plain `toolsnodraw` brush of about 16
units closes the volume: two stacked brushes, the upper one becomes the displacement, the lower
nodraw one seals `[consensus]`. Never put `toolsnodraw` on the sculpted face itself — VBSP emits
the warning `"NODRAW on terrain surface!"`, a sign the nodraw is in the wrong place `[engine]`.

## Sewing

Two adjacent displacements each keep their own edge vertices until they are sewn (Hammer's *Sew*
button): without it, micro-cracks appear at grazing angles, and collision holes can open where the
edges do not coincide exactly `[consensus]`. Sewing works even between different powers — the finer
one's vertices move to meet the coarser — but requires a common `Elev` between the two base faces.

Verifying: **human judgement, not tooled** — cracks show in the editor or in game, and no
`hammer-mcp` tool detects them offline.

## Alpha painting and collision

Per-vertex alpha painting blends two textures on a displacement (grass → dirt), but requires a
dedicated `blend` material — the blend itself, its shaders and its construction live in
`assets.md`.

Displacements expose per-surface collision flags, including *No Physics Collide* — useful for fine,
mostly visual relief (snow, debris) where you do not want a `prop_physics` getting stuck
`[consensus]`. Disabling what is not needed removes a collision cost that otherwise runs
continuously even with nothing on it.

## Displacement, brush or model

| Case | Choice | Why |
|---|---|---|
| Outdoor terrain, hills, large slopes | Displacement, power 2-3, split across several faces | The only native tool for a continuous organic surface |
| Large flat surface with no relief (road, paving) | Plain brush | A displacement adds triangulation, collision and lightmap for no benefit |
| Isolated rock, repeated formation | `prop_static` | A displacement is never instanced — every copy recreates the whole geometry; a prop shares its mesh and has LODs |
| Wall or ceiling with local organic relief (cave) | Displacement power 2, `No Physics Collide` if physprops could get stuck | Collision cost climbs fast on complex vertical work |
| Transition between two terrain textures | Alpha painting on `WorldVertexTransition`, not a hard seam between displacements | Smooth transition with no extra geometry or cutting |

Verifying the choice itself: **human judgement, not tooled** — this is a design decision, not a
count.
