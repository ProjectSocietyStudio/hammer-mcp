# `rp_eastcoast_v4c` — what the reading means

Derived from [`reading-eastcoast.md`](reading-eastcoast.md), which is authoritative on every
number. Anything wrong here can be corrected without touching what was measured — and **four
things already have been**: the lighting overflow, the edict count, the headline conclusion
itself, and then the correction to that correction, which read the new measurement against the
wrong ceiling.

The question this was commissioned to answer: **is this map worth improving, and where.**

---

## ⚠️ The fact this analysis said governs every plan does not

**Corrected 15/08/2026, by measurement.** What follows first is what was written, then what
refuted it, because the wrong version is the useful half.

```
BRUSHES   8192 of 8192   MAX_MAP_BRUSHES
```

This was read as *on the hard ceiling, exactly* — and therefore as the fact governing every
decision: the map could not gain a single world brush, a decompile-and-rebuild would start at
100% of a limit, and nothing could be promised until somebody established whether the Hammer++
chain raised it.

**Nobody had to.** Neither compiler available here enforces `MAX_MAP_BRUSHES` at all. Measured on
a purpose-built map — the table and its method are in
[`docs/compiling.md`](../../compiling.md#the-limits-this-repository-reports-are-not-the-limits-it-compiles-against):

| Limit | SDK 2013 | stock `vbsp.exe` | `vbspplusplus.exe` |
|---|---|---|---|
| `MAX_MAP_BRUSHES` | 8192 | not enforced — wrote 27 006 | not enforced — wrote 17 582 |
| `MAX_MAP_BRUSHSIDES` | 65 536 | not enforced — wrote 162 036 | enforced at **131 072** |

The 8192 in `read_map_report` is `source-sdk-2013/src/public/bspfile.h`'s, and neither binary
here is SDK 2013 — the stock one calls itself *Garry's Mod Edition*.

**So this map is not against a wall, and the question that was going to gate every other
decision does not exist.** What remains true is narrower and still worth knowing: it sits at
exactly the SDK-2013 value, which is a striking number to land on by chance and which this
audit cannot explain. The compiler that built it in 2018 may have enforced what today's does
not. That is a hypothesis, and nothing here tests it.

⚠️ **A second correction, 15/08/2026.** This section first said the ++ chain was the *stricter*
of the two and named `BRUSHSIDES` at 89% as the number to watch instead. Both halves were wrong.
++ enforces `MAX_MAP_BRUSHSIDES` at 131 072 — **twice** the SDK value — so it raises the limit
like everyone expects it to; it is simply the only one of the two that checks it. Against the
ceiling ++ actually defends, this map's 58 389 sides are **45%**, not 89%. There is no brush-side
headroom problem here either, and reading the reported percentage as a distance to a wall is what
produced two wrong conclusions in a row.

## The edict number is not what the verdict says it is

`read_map_report` reports 3942 entities against `MAX_EDICTS` 2048 and calls it 192%, with the
message *"this is what the map costs empty; everything a gamemode spawns comes on top."*

The histogram does not support reading that as the runtime cost:

| Classname | Count | Reaches the runtime? |
|---|---|---|
| `light_spot` | 1068 | baked by vrad |
| `infodecal` | 991 | applied at load, then gone |
| `light` | 79 | baked |
| `light_environment` | 2 | baked |

That is **2140 of 3942** — 54% — that the engine has no reason to keep. All six `light_spot`
sampled are unnamed, which is what makes them static and bakeable; a switchable one carries a
`targetname` and does cost an edict.

⚠️ **This is an inference and it is stated as one.** It rests on how Source treats unnamed light
entities and `infodecal` at load, which was not measured here. The honest bound is that the
map's real edict cost is **somewhere between about 1800 and 3942**, and that the difference is
larger than the whole margin against the ceiling. Settling it needs the engine —
`read_entities` on a running srcds with the map loaded, which `gmod-mcp` can do and this audit
did not.

**What is not in doubt**: 664 `env_sprite`, 197 `prop_door_rotating` and 143
`trigger_soundscape` are real, live entities, and 1004 of them before DarkRP has spawned a
single thing.

## The lighting overflow is not what I first thought

LIGHTING is 26.86 MB against a 16 MB ceiling — 168%, the second-worst number in the reading.

**My first reading was that it ships both LDR and HDR lightmaps**, from the arithmetic: 2 761 019
luxels at 4 bytes is 11.04 MB, and the lump is 2.4× that. `read_bsp_info` says
`hdrLighting: false`, reading the three lumps that settle it, and the two lumps whose names end
in `HDR` are the ones its own documentation warns are non-empty on LDR maps anyway.

So the 2.4× is **light styles**. A face carrying switchable or animated lights stores one
lightmap set per style, up to `MAXLIGHTMAPS = 4`. The map has `logic_timer` ×17, `env_fire` ×2,
`env_spark` ×7, `light_dynamic` and a `shadow_control` — a lit, animated city.

That changes what a fix would be. Dropping HDR would have been free and is not available.
Reducing styles means deciding which flickering lights stop flickering, which is a design
question, not a compile flag.

The distribution says where the luxels are, and it is not where a reader might guess:

| Bucket | Faces | Luxels | Share of luxels |
|---|---|---|---|
| 1–256 | 23 345 (89%) | 927 706 | 34% |
| 257–4096 | 2 953 (11%) | 1 833 313 | **66%** |

**Eleven per cent of the lit faces carry two thirds of the lighting budget.** That is the shape
of a map where `set_lightmap_scale` has real headroom: coarsening the 426 faces in the top
bucket alone, where each doubling of scale divides the bill by four, is a measurable
intervention on a handful of surfaces rather than a sweep across 26 298.

## Visibility: a big map cut into a lot of small pieces

```
11 337 leaves   3 653 clusters   1.55 MB visdata
median leaf volume 172 032   mean 42 306 662
```

The mean is 246× the median, which is the signature of a map with a few enormous outdoor leaves
and thousands of tiny indoor ones. 134 leaves are degenerate — zero volume.

Two absences are louder than any of those numbers:

- **`OCCLUSION` is 12 bytes.** Not one occluder in a 350-metre city.
- **38 `func_areaportal`** across 81 424 m². For comparison, round 6 measured that two
  areaportals in a 12 × 11 m tenement took `areas` from 2 to 3, and this map's `AREAS` lump is
  168 bytes.

Whether those absences cost anything is not readable from a `.bsp`, and this is where the audit
stops being able to answer. `read_visleaf_stats` counts the split; only the running engine says
what a player's `mat_wireframe` draws.

## What a compiled map cannot be asked

Stated because the next step is a decompile, and a decompiled `.vmf` will look like a source
file without being one.

**Compiling destroyed the structural / `func_detail` distinction, every hint brush, and every
visgroup.** They are not in the `.bsp` and no reader here will recover them. So:

- the 8192 brushes are *world* brushes — how many were `func_detail` in the original is
  indeterminable;
- a decompile brings everything back as **structural**, which is the opposite of the original
  and the single largest thing to fix. Round 6 measured what that costs on a map built here:
  thirty-seven brushes of trim, left structural, took a map from 74 leaves to 188 and divided
  the median leaf volume by ten;
- the 30 `info_hint` entities are *not* hint brushes — they are AI hint nodes, a different
  thing with a similar name.

## Where the work is, in order

1. ~~**Establish the brush ceiling.**~~ **Done, 15/08/2026, and the answer dissolves the
   question**: neither compiler enforces `MAX_MAP_BRUSHES`, and this map is at 45% of the
   `BRUSHSIDES` ceiling the ++ chain does enforce. No brush limit constrains this work.
2. **Settle the edict count in the engine**, not in the entity lump. It is the difference
   between "over budget before the gamemode starts" and "comfortable", and the audit cannot
   close it.
3. **The 426 heaviest faces.** 11% of faces hold 66% of the lighting budget; `set_lightmap_scale`
   there is the cheapest measurable win in the file.
4. **The structural / detail split**, if and only if a decompile happens — the largest single
   lever Source has, and the one a decompile guarantees will be wrong.
5. **Occluders and areaportals**, last, and only after somebody has stood in the map with
   `mat_wireframe` on. Counting them is automatic; deciding where they go is not.

## Two things this audit found about the toolkit, not the map

- **`read_gma` cannot read what the Workshop actually stores**
  ([#96](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/96)). The addon on disk is a
  raw LZMA stream, and every Workshop map is. The refusal is correct and the message is exact,
  but the commonest way anyone obtains a map needs a decompression step the toolkit does not
  have — six lines of Python stood between this repository and the file it was asked to audit.
- **`read_entity_report` cannot parse this entity lump**
  ([#97](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/97)) — *"unterminated quoted
  string at offset 61907"* — where `read_bsp_entities` reads all 3942 entities from the same
  bytes. A production map broke one of two readers, which is what a production map is for.

Question 1 is answered, so neither is blocked any longer. Both are worth fixing before a
decompile: one of them is the only thing standing between this repository and any Workshop map.
