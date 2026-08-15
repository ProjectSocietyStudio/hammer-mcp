# `rp_eastcoast_v4c`

A 350-metre roleplay city published to the Workshop on 13/06/2018
([1407179012](https://steamcommunity.com/workshop/filedetails/?id=1407179012)). Audited
15/08/2026 in two passes, before any decision about improving it — the second pass ran the
readers the first never called and replaced its samples with censuses.

| | |
|---|---|
| [`reading-eastcoast.md`](reading-eastcoast.md) | what was measured, one section per call. **Authoritative on the numbers** |
| [`analysis-eastcoast.md`](analysis-eastcoast.md) | what it means, what is inferred rather than measured, and where the work is |

**The short version.** `BRUSHES` sits at 8192 of 8192, which this audit first read as a hard
ceiling governing every plan — and a measurement the same day refuted that: **neither compiler
available here enforces `MAX_MAP_BRUSHES` at all**. Nor is this map near the one ceiling that is
enforced: `BRUSHSIDES` reads 89% of the SDK 2013 value, and **45% of the 131 072 the ++ chain
actually checks**. So no brush limit governs anything here. `LIGHTING` is at 168% of its ceiling,
and not for the reason arithmetic suggests: the map has no HDR, so the overflow is light styles.
Eleven per cent of its lit faces carry two thirds of its lighting budget. The map has no
occluders at all and 38 areaportals across 81 424 m².

The 3942-entity figure the budget profile fails on is **not** the runtime cost: 54% of it is
decals and unnamed lights that never become edicts. The second pass counted all 3942 rather
than sampling six, and the answer is **1838 edicts empty against a ceiling of 2048** — a margin
of 210 for everything DarkRP spawns, which is no margin. **640 of the 664 `env_sprite` are
unnamed decoration; deleting them takes the map to 1198 and the margin to 850**, by entity-lump
patch, with no source and no compiler.

The second pass also found the map **ships broken in four places** — one shopfront's windows
never respawn while a stray timer churns another's every 120 seconds forever, a second
shopfront has no respawn timer at all, the tonemapping is set on an entity that does not exist,
and the bar's button drives an empty `point_template` — all four in the entity lump, all four
patchable. And **21 of the pakfile's 27 MB are five files and a set of HDR cubemaps the map
cannot read**, since `LIGHTING_HDR` is 0 bytes.

No decompiler lives in this repository and none is planned. What the toolkit brings starts
after: judging, measuring dependencies, and patching entities without recompiling — and the
second pass found that the last of those has a hole in it, since **nothing here validates the
wiring of a compiled map**. Every defect above was found with hand-written Python.
