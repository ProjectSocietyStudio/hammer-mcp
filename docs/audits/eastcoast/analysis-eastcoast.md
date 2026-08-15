# `rp_eastcoast_v4c` — what the reading means

Derived from [`reading-eastcoast.md`](reading-eastcoast.md), which is authoritative on every
number. Anything wrong here can be corrected without touching what was measured — and one thing
already was, below.

The question this was commissioned to answer: **is this map worth improving, and where.**

---

## The one fact that governs every plan

```
BRUSHES   8192 of 8192   MAX_MAP_BRUSHES
```

Not near the ceiling. **On it, exactly.** A map cannot exceed `MAX_MAP_BRUSHES` on the stock
compilers — vbsp refuses — so this was built either with a raised limit or by a mapper who
stopped the moment it filled.

Either way the consequence is the same and it comes before any other decision: **this map cannot
gain a single world brush without a compiler whose limit is raised.** ficool2's Hammer++ chain,
which this repository already drives by default, is the obvious candidate — and whether it
raises *this* limit is a thing to verify before promising anything, not to assume.

Everything downstream inherits it. A decompile-and-rebuild starts at 100% of a hard ceiling.
BRUSHSIDES at 89% and OVERLAYS at 96% say the same in a quieter voice.

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

1. **Establish the brush ceiling.** Whether the ++ chain raises `MAX_MAP_BRUSHES`, measured
   rather than assumed. Nothing else can be promised until this is known.
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

Neither is worth fixing before question 1 is answered.
