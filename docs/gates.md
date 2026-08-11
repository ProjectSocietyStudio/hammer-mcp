# Feasibility gates

Before writing a tool that depends on something, this repository first proves the something works.
Each gate below is dated, and one of them is still open and says so.

## Gate A

**The compilers under Wine — passed 02/08/2026.**

`vbsp.exe`, `vvis.exe` and `vrad.exe` (the "Garry's Mod Edition" build of 22/07/2026) load and run
under wine 9.0, `WINEPREFIX=~/.wine`, with the working directory forced onto the `bin` folder so
`tier0.dll` resolves.

A full compile of the probe map `test/fixtures/hmcp_probe.vmf` — a sealed room, an
`info_player_start`, a light, and an `info_target` used as a marker:

| Stage | Output | Exit |
|---|---|---|
| `vbsp -game <garrysmod> hmcp_probe.vmf` | `hmcp_probe.bsp`, no leak | 0 |
| `vvis -fast` | 4 portals, 16 visible clusters | 0 |
| `vrad -fast` | 32 triangles, lighting written | 0 |

Result: a 56,236-byte `.bsp`, VBSP version 20, `mapRevision` 1. It is committed as a fixture.

One warning, benign: `Skybox vtf files for skybox/sky_day01_01 weren't compiled with the same size
texture` — vbsp could not build the default cubemap. No effect on geometry.

**The path must be in absolute Windows form** (`Z:\...`). A relative path resolves against wine's
working directory and silently compiles the wrong file. `WINEDEBUG=-all` is not optional either:
without it, stderr is a wall of `fixme:` lines that buries the compiler's own output.

## Gate C

**The Hammer++ toolchain under Wine — passed 11/08/2026.**

`vbspplusplus.exe`, `vvisplusplus.exe`, `vradplusplus.exe` and `bspzipplusplus.exe` (June 2026
builds) run under the same wine 9.0 as the stock chain, with no extra DLL.

**What the gate corrected, and it is the important part: they do not live where they were expected
to.**

| | stock | Hammer++ |
|---|---|---|
| Directory | `GarrysMod/bin/` | `GarrysMod/bin/win64/` |
| Architecture | PE32 i386 | PE32+ x86-64 |
| The `.fgd` files | `bin/` | — (`toolsplusplus.fgd` ships separately) |

`bin/win64/` **also** holds its own 64-bit stock `vbsp.exe`/`vvis.exe`/`vrad.exe`, and requires the
**x86-64** beta branch of Garry's Mod (`BetaKey "x86-64"` in `appmanifest_4000.acf`). The
consequence for configuration: `gmodBin` used to mean both "where the compilers are" and "where the
`.fgd` files are". Those two roles separate here, and one path is no longer enough.

Two distinct archives, contrary to what the download page suggests:

- `hammerplusplus_gmod_build8871.zip` — the **editor only**, no compilers in it;
- `tools_plusplus.zip` (repository `ficool2/misc_tools`) — the four compilers,
  `studiomdlplusplus`, and `toolsplusplus.fgd`. Its `compatibility/` folder was **not** installed:
  it contains `tier0.dll`, `vstdlib.dll`, `filesystem_stdio.dll` and friends, which would overwrite
  the Steam install's own. Nothing needed them.

A full compile of `test/fixtures/hmcp_probe.vmf`, all three stages exiting 0:

| | PLANES | VERTEXES | TEXINFO | FACES | BRUSHES |
|---|---|---|---|---|---|
| stock | 40 | 35 | 3 | 16 | 6 |
| Hammer++ | 40 | 35 | 3 | 16 | 6 |

**Negative control** — without it the gate would only prove that a map which works, works. The
`info_player_start` moved to `0 0 2000`, outside the sealed volume: VBSP++ prints the same
`**** leaked ****`, the same `Entity info_player_start (0.00 0.00 2000.00) leaked!` line, and
writes a two-point `.lin` **in the same format, with the entity at the second point** — exactly the
convention `read_leak` was calibrated on.

All four raw outputs are committed under `test/fixtures/logs/` and replayed by
`test/compile.test.ts`: `parseCompileLog` stays silent on the three clean compiles and sees the
leak. That proves those two cases, **not** that every error the `++` builds can emit is covered —
their own messages have no sample yet.

## Gate B

**Does Garry's Mod honour `maps/<map>_l_0.lmp`? NOT TESTED.**

The codec is written and proven against a Valve file (`c1a1_l_0.lmp`, shipped with Half-Life 2),
but **nothing yet proves the current Garry's Mod branch reads these files at all**. The three
patches shipped with Half-Life 2 prove Source supported it once, not that Garry's Mod supports it
today.

Verifying it needs an `srcds` restart, on a server shared between sessions. The protocol, run on
`gm_construct` and never on a production map:

1. `write_lump_patch` with an `info_target` named `hmcp_probe`;
2. deploy through the sanctioned route into the server tree;
3. start the server on `gm_construct`;
4. read the entities from the running engine → expect 1;
5. **negative control**: `mapRevision + 1`, redeploy, restart → expect 0. That is the step that
   proves a mechanism rather than a coincidence.

If it fails, the fallback is a Lua manifest read at `InitPostEntity`. Worth noting that even if the
gate passes, the manifest stays preferable for **adding** an entity: it is format-agnostic, it
survives a recompile, and it hot-reloads. The `.lmp`'s own advantage is narrow but real — **editing
or deleting an entity the map itself spawns**, before it spawns, keyvalues included.

## What a lump patch cannot do

Even once gate B passes, three limits are structural rather than incidental:

- **It cannot relight the map.** The LIGHTING lump is baked by vrad at compile time; adding a
  `light` entity through a patch changes nothing in game.
- **It cannot create brush entities.** A `func_*` needs a brush model (`*N`) that only vbsp emits.
- **It never reaches clients.** The `.lmp` lives server-side and is not referenced by the `.bsp`,
  so client-only entities added this way exist on the server and are invisible to every player.
