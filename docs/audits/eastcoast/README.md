# `rp_eastcoast_v4c`

A 350-metre roleplay city published to the Workshop on 13/06/2018
([1407179012](https://steamcommunity.com/workshop/filedetails/?id=1407179012)). Audited
15/08/2026, before any decision about improving it.

| | |
|---|---|
| [`reading-eastcoast.md`](reading-eastcoast.md) | what was measured, one section per call. **Authoritative on the numbers** |
| [`analysis-eastcoast.md`](analysis-eastcoast.md) | what it means, what is inferred rather than measured, and where the work is |

**The short version.** `BRUSHES` sits at **8192 of 8192** — on the hard ceiling, not near it —
which governs every plan before anything else is decided. `LIGHTING` is at 168% of its ceiling,
and not for the reason arithmetic suggests: the map has no HDR, so the overflow is light styles.
Eleven per cent of its lit faces carry two thirds of its lighting budget. The map has no
occluders at all and 38 areaportals across 81 424 m².

The 3942-entity figure the budget profile fails on is **not** the runtime cost: 54% of it is
decals and unnamed lights that never become edicts. The audit could not close that gap and says
so; the engine can.

No decompiler lives in this repository and none is planned. What the toolkit brings starts
after: judging, measuring dependencies, and patching entities without recompiling.
