# Architecture

```
src/kv/{lex,parse,serialize}.ts    Valve KeyValues, source offsets preserved
src/bsp/{header,entities,...}.ts   offset readers, never the whole file
src/lmp/codec.ts                   the lump-file codec
src/entity/{model,edit}.ts         the entity model shared by all three formats
src/vmf/edit.ts                    the VMF write path
src/games/{steam,profile,resolve}  discovering and resolving game profiles
src/fs/guard.ts                    assertWritable -- the single chokepoint
src/mcp/{registry,server}.ts       MCP plumbing
src/tools/*.ts                     tool definitions
```

## Splicing

Aiming for a byte-identical round trip by reserialising a Hammer-written VMF is a trap. The grammar
allows duplicate keys inside one block (several `solid`, several `side`, a `connections` with
repeated output names), Hammer's spacing is irregular, and a value read as a number does not
survive a parse → number → format cycle. A one-entity change would produce a diff of thousands of
lines.

So the AST keeps `[start, end)` for every block and every pair, and edits are range replacements
applied right to left. **Everything untouched is byte-identical by construction.** Only brand-new
blocks are formatted.

One implementation of that, in `src/vmf/splice.ts`. It used to be three, one per write module, and
neither copy did the two things the single one does: it **refuses overlapping ranges** rather than
producing text that depends on which sorted first, and it resolves ties at one offset **in push
order** rather than backwards. Both cases are reachable through `applyVmfOps` — an op that removes
an entity alongside one that edits it, and a single op setting two new keyvalues — and neither had
a test, because the behaviour was an accident of a sort rather than a decision.

`serialize()` exists, but to format what we **create**, not to rewrite what we edit. Its test oracle
is `findOffsetGaps()`: it checks that the parsed offsets account for the entire source — nodes
ordered, non-overlapping, and nothing between them but whitespace or a comment. That is exactly the
property the splice depends on. It passes on `ttt_traps.vmf`, 7082 lines of real Hammer output.

### The test that failed to fail

Worth recording, because it is the exact failure mode this repository's first rule exists to catch.

`edit_vmf` had four tests asserting byte equality after a splice. Replacing the splice with
`serialize(parse(text))` — a deliberate, total sabotage — made **none of them fail**. Both fixtures
are canonical Hammer output, and our formatter round-trips that byte for byte, so every assertion
passed against an implementation that had thrown the whole technique away.

The claim in the code comments was also wrong: this formatter copies values verbatim, so
`5416.0312` survives it. What a reserialiser really drops is everything the grammar does not model
— `//` comments, blank lines, indentation that is not one tab per level. Third-party editors and
hand-edited maps have all three, and losing them is silent.

A fixture with all three now catches the sabotage, and the comments are corrected. (A parser that
reads values as typed numbers — srctools, on the Python side — *would* reformat floats. That is a
reason never to write a VMF through the sidecar, not a property of `kv/serialize.ts`.)

## Expanding `func_instance`

Nothing to do with Hammer++ — the stock `vbsp.exe` handles instances (`InstancePath`,
`instance_variable`, `func_instance_parms` are all in the binary). Not expanding them was a gap
that already cost.

An instance is **one entity in the file and a whole building in the map**. Read as-is:

| | folded | expanded |
|---|---|---|
| `worldBrushes` | 0 | 6 |
| `brushSides` | 0 | 36 |
| entities | 2 | 4 |

Measured on a root map containing nothing but one instance of the probe. A map far past
`MAX_MAP_BRUSHES` therefore looks comfortable, and `read_map_geometry` cannot contradict it because
there is no `.bsp` yet. In the other direction, every output crossing an instance boundary targets
a name absent from the root file: `output-target-missing` was accusing perfectly correct references.

`read_vmf` and `read_vmf_lint` take `collapseInstances` (default `false` — expanding changes every
count and every `targetname`, so it is asked for). The expansion delegates to `srctools.instancing`,
which models vbsp's own behaviour: the three fixup styles, `$variable` substitution and automatic
names for anonymous instances are exactly the things one reimplements subtly wrong.

Two failures are named rather than suffered: an instance file that cannot be found says **which
one** (the path comes from inside the map, not from the caller), and an instance that includes
itself is refused at 16 levels — otherwise the symptom is a sidecar timeout, which blames the
sidecar.

## Write discipline

The only write targets are the state directory, the patch output directory, and whatever the caller
passes explicitly. Two trees are refused outright.

⚠️ **Those tree names are the ones this server was built for, and they are currently hard-coded**
(`src/fs/guard.ts`, `src/tools/lmp.ts`). On any other repository they name nothing: the guard then
refuses nothing, and lump patches land in a directory that did not exist. Making them configurable
is identified work, not finished work — said here rather than discovered.

The reasoning behind the refusal does transpose. A game tree managed by SteamCMD gets files
replaced by a `validate` or a branch change, so anything of ours living there would be lost without
warning. What is ours lives elsewhere and is deployed into place by a script.

**This is discipline, not enforcement.** An editor hook intercepts Edit/Write tools; it does not
see a `node:fs` call inside an MCP server. Hence `src/fs/guard.ts`: a single `assertWritable()` every
write passes through, which resolves symlinks before judging — addon directories are often symlinks
into another tree, so a lexically innocent path can land in the managed one — plus a contract test
that asserts it on resolved paths.

## Shared plumbing

`src/mcp/registry.ts`, `src/mcp/server.ts`, `src/config.ts`, `src/logger.ts`, `src/install.ts` and
`src/proc/run.ts` were adapted copies of another MCP server's, duplicated **deliberately**: a
shared package looked premature for ~350 lines across two repositories. The revision threshold
written down at the time was "a third MCP server, or the same plumbing bug fixed twice".

**It was reached on 11/08/2026**: the drift was already measurable (`clip()` copied twice on the
other side, `stripAnsi()` on only one, the image block on only the other) and an SDK upgrade from
`^1.12` to `1.30` would have had to be done and proven twice. Those six files are now three-line
adapters over [`@projectsociety/mcp-core`](https://github.com/ProjectSocietyStudio/mcp-core).

What does **not** move into the core: `src/fs/guard.ts`, specific to our write trees, and the
`Realm` enum — `map`/`local` stays deliberately distinct from the live-engine server's
`sv`/`cl`/`local`. The lifecycles do not merge either: that server holds a lock and a transport
into a running engine; this one is stateless. **Two servers, one core.**
