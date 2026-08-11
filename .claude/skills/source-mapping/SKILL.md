---
name: source-mapping
description: The craft of Source / Garry's Mod mapping — thinking about a map, not driving a tool. Brushwork and grid, visibility and visleaves, lighting and lightmaps, displacements, entities and the I/O system, performance, dimensions and composition, materials and packing, atmosphere, myths and anti-patterns. Use whenever deciding how to build, optimise or judge a map: func_detail, hint, areaportal, occluder, lightmap scale, cubemap, prop_static, sightline, leak, budget, scale in Hammer units.
---

# Thinking about a Source map

This skill carries the **craft**. Driving the tooling — which tool answers which question, Wine,
choosing a compiler chain, lump patching — lives in [`source-map`](../source-map/SKILL.md) and is
not repeated here. The two point at each other; neither copies the other.

## The rule that comes first

**Source mapping carries more dogma than measurement.** Twenty years of forums have sedimented
rules that were true on 2004 hardware, numbers copied without a source, and sound advice applied
outside the case it was sound for. An agent reciting that folklore with confidence does more
damage than an agent saying it does not know.

Hence the convention holding this whole skill together: **every number carries its provenance.**

| Mark | What it guarantees |
|---|---|
| `[engine]` | read in Valve's code or its documentation. Not up for discussion |
| `[consensus]` | widely accepted practice, never quantified. Useful, not decisive |
| `[disputed]` | contested, obsolete, or false as usually stated. The clause that follows says what is true |
| `[measured]` | taken by us on a real map, with the tooling. The strongest after `[engine]` |

A number with no mark is a number that gets deleted. If you add a rule to this skill, it arrives
with its provenance or it does not arrive.

## The three things that decide a map

In this order, and the order matters more than the detail:

1. **Visibility.** What is not drawn costs nothing. The visleaf split, areaportals and occluders
   decide performance long before the triangle count does.
   → [visibility.md](references/visibility.md)
2. **Sealing.** A map that leaks has neither correct visibility nor correct lighting, and it
   compiles anyway — which is what makes it treacherous. → [compiling.md](references/compiling.md)
3. **Scale.** A badly proportioned map is not recovered by dressing it: it is rebuilt.
   → [level-design.md](references/level-design.md)

Everything else — materials, atmosphere, detail density — can be corrected. Those three cannot.

## What no tool settles

The structural/`func_detail` split, where a hint goes, a surface's lightmap scale, composition,
whether a city reads clearly: **no tool answers**. That is not a gap in the tooling, it is the
nature of the craft.

⚠️ **Dressing a judgement up as a metric is the most expensive mistake an agent can make here**: it
produces a wrong number and the confidence that comes with it. "I cannot settle this, look at it"
is a valid answer, and often the right one.

The full map of what can and cannot be verified:
[tooling-coverage.md](references/tooling-coverage.md).

## Auditing a map you have no source for

A `.bsp` is not a map, it is the **result** of a map. Compiling destroys the structural/detail
distinction, the hints, the visgroups. Faced with a question about any of those, the answer is
"not determinable from a compiled `.bsp`", not an estimate.

## File → when to read it

| File | When |
|---|---|
| [brushwork.md](references/brushwork.md) | placing geometry: grid, valid shapes, tool textures, hard limits |
| [visibility.md](references/visibility.md) | **before any performance question**: visleaves, `func_detail`, hints, areaportals, occluders, skybox |
| [lighting.md](references/lighting.md) | lighting it: lightmaps, light entities, HDR, cubemaps, shadows |
| [displacements.md](references/displacements.md) | terrain, a rock, an irregular surface |
| [entities.md](references/entities.md) | making something work: I/O, naming, triggers, filters, entity limits |
| [performance.md](references/performance.md) | it stutters, or it is about to: draw calls, props, physics, server load |
| [gmod.md](references/gmod.md) | the map is for Garry's Mod: SDK, mounting, spawns, nav mesh, Workshop |
| [level-design.md](references/level-design.md) | sizing, blocking out, composing — the dimensions table is here |
| [assets.md](references/assets.md) | materials, models, and **packing**: the table of what must ship |
| [atmosphere.md](references/atmosphere.md) | sound, fog, water, sky, weather, colour |
| [anti-patterns.md](references/anti-patterns.md) | **before asserting a rule learned elsewhere**, and to spot an error in a file |
| [measured-corpus.md](references/measured-corpus.md) | sizing an urban map: figures taken from three production maps |
| [tooling-coverage.md](references/tooling-coverage.md) | "how do I verify this?", and to find out what is not tooled at all |

## The server is shared

Any in-game check goes through `gmod-mcp`, and therefore through the `srcds` other sessions are
using. Never restart it unilaterally, and do not load another map without saying so.
