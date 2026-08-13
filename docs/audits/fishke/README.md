# The Fishke audit — three production maps, read with this server

Three urban Garry's Mod roleplay maps by the mapper **Fishke**, measured on 11/08/2026 from the
compiled `.bsp` extracted from the Workshop: `rp_unioncity` (2018, 0.78 GB), `rp_southside` (2020,
1.03 GB), `rp_nycity` (2022, 1.14 GB). No source `.vmf` exists for any of them.

This is the raw material the `[measured]` marks in
[`measured-corpus.md`](../../../.claude/skills/source-mapping/references/measured-corpus.md) were
distilled from. It is kept whole, including what was refuted, because the refutations are the more
useful half.

## What each file is

| File | What it holds |
|---|---|
| [reading-unioncity.md](reading-unioncity.md) · [reading-southside.md](reading-southside.md) · [reading-nycity.md](reading-nycity.md) | one tool call per section, with its parameters and its raw result. **Authoritative on the figures** |
| [analysis-unioncity.md](analysis-unioncity.md) · [analysis-southside.md](analysis-southside.md) · [analysis-nycity.md](analysis-nycity.md) | densities and readings derived from one reading each, marked measured vs inferred |
| [longitudinal-synthesis.md](longitudinal-synthesis.md) | the 2018 → 2022 trajectory, the constants and the breaks. **Contradicted then revised twice** — read the adversarial pass first |
| [adversarial-pass.md](adversarial-pass.md) | every synthesis claim attacked: 2 fall, 6 are fragile, the rest hold |
| [method.md](method.md) | what survived, as method: four traits that hold, one expected trait that does not |
| [nav-mesh.md](nav-mesh.md) | both `.nav` files parsed area by area — including one that matches no shipped `.bsp` |

## How to read it

**Start with the adversarial pass, not the synthesis.** The synthesis is the document that was
wrong twice, and its own header says so. Each of its claims carries a verdict — *holds*, *fragile*,
*falls* — and the fragile ones are fragile for a reason worth reading: three points do not make a
trend, and a causal story is almost never testable against "the map is bigger".

Two caveats govern every number here:

- **A "per hectare" density is normalised by the `worldspawn` bounding box**, which includes the 3D
  skybox and all empty space. It is a floor, never a real street density.
- **`prop_static` is measured by nothing here.** It lives in the GAME_LUMP, which
  `read_prop_survey` does not read. On an urban map that is probably most of the scenery, so no
  static/dynamic ratio in this dossier is complete.

## What it cannot say

These maps are compiled. The structural/`func_detail` split, the hints, the visgroups and the
per-face lightmap scale were all destroyed by vbsp. **It measures what Fishke shipped, not what he
did** — the quality of his visibility split, probably the most interesting thing to learn from him,
stays out of reach without loading the maps in the engine.

One source the dossier cites is missing: `comparatif-lumps.md`, named four times by `method.md`, was
never committed. The figures it carries are reproduced but unsourced, and `method.md` says so where
they appear.
