# `hmcp_bodega` — what building it was like

Findings in the order they were hit, each with the class that decides what happened to it:
**bug** · **gap** · **ergonomics** · **docs**. The method is in
[`../README.md`](../README.md); the brief being built to is [`brief.md`](brief.md).

---

## 1 — The server was serving a build twelve tools old, and nothing said so

**Class: bug** (in `health`) · found in round 0, before a single brush was placed · **fixed**

### What happened

The first call of the exercise was `check_vmf_rules`, to check that the brief just written
was loadable. The MCP client answered:

```
Error: No such tool available: mcp__hammer-mcp__check_vmf_rules
```

The tool is in the repository, has tests, has a `docs/spatial.md` section and a row in the
parity table. It was committed on 12/08/2026 as `06f0dca`.

The cause was `dist/`:

| | |
|---|---|
| newest file under `dist/` | 12/08/2026 01:29 |
| newest file under `src/` | 12/08/2026 03:19 |

`.mcp.json` declares `node …/hammer-mcp/dist/index.js`, `dist/` is gitignored, and the last
three feature commits were never built. The server started, reported healthy, and served the
tool list of a build ninety minutes older than the source — **twelve tools short**. Counted
exactly, by what appeared after a rebuild and a client reconnect:

`check_vmf_rules` · `read_vmf_leak` · `read_vmf_rooms` · `read_vmf_surfaces` ·
`read_vmf_sightlines` · `read_vmf_trace` · `read_vmf_visibility` ·
`read_vmf_nearest_surface` · `render_vmf_view` · `render_vmf_plan` ·
`measure_vmf_clearance` · `measure_vmf_approach`

Which is to say: the entire spatial wave — every tool that makes it possible to *build* a map
rather than measure a finished one — was absent from the server, on the machine that wrote it,
five days after it landed.

### Why it counts as a defect and not as carelessness

Because nothing in the system could tell you. The failure has three properties that together
make it undiagnosable:

- **It is silent.** A stale build does not throw, does not warn, does not degrade. It serves
  an older *set of tools*, and a missing tool is indistinguishable from a tool that was never
  written.
- **Every symptom points elsewhere.** The first suspicion fell on the MCP client, the second
  on the tool name, the third on `.mcp.json`. The build was the fourth guess.
- **The one tool whose job this was said nothing.** `health`'s own description ended *"Start
  here when a tool reports something missing"* — and it reported the game, the compilers, the
  FGDs, Wine and the sidecar, all present and correct, while saying nothing about itself.

`test/parity.test.ts` does check the tool count, and would have caught a discrepancy — but it
reads the *source*. No test can see the build a client is actually connected to, because that
is not a property of the repository.

### The fix

`health` now reports two things it never did:

```json
"tools": {
  "count": 69,
  "build": {
    "builtAt": "2026-08-13T11:16:59.113Z",
    "sourceAt": "2026-08-13T11:16:46.354Z",
    "stale": false,
    "note": "This build is at least as new as the source beside it."
  }
}
```

- **`count`** is how many tools *this server* is serving. Compared with the number
  `docs/hammer-parity.md` states, it closes the diagnosis in one call. Null rather than 0 when
  no registry was handed in — a reader seeing zero would conclude the server serves nothing,
  which is a different and wrong diagnosis.
- **`build.stale`** compares the newest mtime under `dist/` with the newest under `src/`. It
  is three-valued: `null` when there is no source tree beside the build, because an installed
  copy has none and answering `false` there would be a confident claim about a question nobody
  asked.
- The note names **both halves** of the fix. `pnpm build` is not enough on its own: an MCP
  client holds the tool list it was handed when it connected, so the client has to reconnect
  too. That is exactly what happened here — the rebuild changed nothing until the client was
  reconnected.

`buildFreshness` and `newestMtime` live in `src/version.ts` and are tested directly against
directories whose timestamps the test sets, rather than against the repository's own build
state, which moves under the suite.

Sabotage, per `CONTRIBUTING.md` rule 1 — each killed its own test and no other:

| What was broken | What went red |
|---|---|
| `stale` forced to `false` | *calls a build older than its source stale* |
| `newestMtime` stops descending into subdirectories | *finds the newest file anywhere below the directory* |

### What it says about the exercise

This is the first finding, it arrived before any geometry existed, and no amount of reading
the repository would have produced it. A parity table cannot see it — the tool is in the
table, correct, tested, and unreachable. It is the exact failure mode this exercise exists to
find, and it turned up in the first five minutes.

---

## 2 — `edit_vmf` reported a protocol error on a call that had already written the file

**Class: bug** · found while adding entities · **fixed**

### What happened

Six entities added in one call, `confirm: true`, `dryRun` simply left out:

```
MCP error -32602: Output validation error: Invalid structured content for tool
edit_vmf: Required at dryRun
```

The file had been written. `read_vmf` showed all six entities, ids 108–113.

`dryRun` is declared `.optional()` with no default in the input and `z.boolean()` —
required — in the output. A caller who omits it hands the handler `undefined`, the handler
echoes it, and the SDK refuses the result. The error is emitted *after* the write.

The error itself was survivable. **The retry it invites was not.** Nothing in the message
says the write went through, and "the call errored, try again" would have added all six
entities a second time. The cold agent avoided that by verifying with `read_vmf` rather than
trusting the protocol — which is the right instinct and not one a tool should require.

### The fix

`dryRun: args.dryRun ?? false` in the returned object. The field means *was this a dry run*,
and for a caller who did not ask for one the answer is no.

The root cause is one layer deeper and was measured before being left alone: making
`DRY_RUN` a `.default(false)` fixes the class rather than the case, but it changes the
inferred handler argument type from optional to required, and **twenty call sites across five
test files** call handlers directly with hand-built argument objects that bypass the input
schema. That bypass is the real reason this bug survived several hundred tool calls in the
suite: no test has ever omitted an optional argument, because no test goes through the parse.
Fixing it properly means a helper that parses arguments through the declared input schema —
its own piece of work, filed as an issue.

The new test does go through the schema, for this one tool. A static check was tried first —
*no output key may be required when the input key of the same name is optional with no
default* — and abandoned after it flagged eighteen pairs of which seventeen were correct:
`game`, `profile` and `seeds` are optional inputs a handler **resolves** and reports back.
Only a call tells a key that is echoed from a key that is resolved.

Sabotage: removing the `?? false` reproduces the original failure exactly.

---

## 3 — `check_vmf_rules` said zero errors while one rule in seven checked nothing

**Class: bug** · found during the room work · **fixed**

### What happened

```json
{"rulesChecked": 7, "matchedNothing": ["doorways-wide-enough"],
 "errorCount": 0, "warningCount": 0, "violations": []}
```

`errorCount: 0` and an empty `violations` array — on a map where the rule about doorway
width had found no doorway at all and had therefore measured nothing. The information was
present: `matchedNothing` names the rule, and `notes` explains that a rule matching nothing
"is a finding about the rules, not a pass". But the two summary numbers a caller reads first
both said everything was fine.

`errorCount: 0` conflates three different answers:

1. every rule was checked and none failed;
2. there is no rules file at all;
3. some rules were checked and others matched nothing.

### Why this one is worse than it looks

The repository already has the discipline this was missing, one tool over.
`read_map_report` states it outright: *"a run that judged nothing comes back `skipped`, never
`pass`"*, and `luxel-density` reports `skipped` rather than inventing a threshold. The rules
check simply never got the same treatment — and it is the tool a caller uses as a **stopping
condition**. A stopping condition that reads green when it checked nothing is the one place
this class of error costs the most.

### The fix

An `overall` field, in `read_map_report`'s own vocabulary:

| `overall` | When |
|---|---|
| `fail` | any error violation stands |
| `skipped` | some rule matched nothing, or no rules file, or nothing was checked |
| `warn` | findings, all of them warnings |
| `pass` | every rule was checked and none failed |

`skipped` outranks `warn` deliberately. A warning is a finding the run stands behind; an
unmatched rule is a hole in the run itself, and a caller told `warn` would believe everything
else had been judged. `fail` outranks both: a violation that stands is the answer whatever
else was incomplete.

The tool description now says to read `overall` rather than `errorCount`.

Sabotage, each killing its own test alone: making `matchedNothing` stop demoting the verdict
killed *is skipped, not pass, when a rule matched nothing*; making errors stop forcing `fail`
killed *is fail as soon as one error violation stands*.

---

## 4 — Nothing creates a `.vmf`, so a pure-MCP workflow cannot start

**Class: gap** · the one rule of the exercise that had to be broken · [**#47**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/47) — **fixed**

`write_vmf_solid` on a path that does not exist:

```
write_vmf_solid failed: ENOENT: no such file or directory, open '…/hmcp_bodega.vmf'
```

A raw Node errno, and nothing about what to do next. `src/tools/build.ts:140` reads the file
unconditionally, and `insertSolids` refuses a file with no `world` block — so even an empty
file would not serve. All sixty-nine tools were enumerated: **none creates a `.vmf`.**

The builder broke the no-hand-edit rule exactly once, to write a skeleton of `versioninfo`,
`visgroups`, `viewsettings`, an empty `world`, `cameras` and `cordons`, with no solids and no
entities. Everything after that went through a tool. It flagged the breach rather than hiding
it, which is the right call — but the exercise's central constraint could not be honoured,
and that is a finding about the toolkit, not about the builder.

This is the highest-value gap on the page: every other finding cost time, and this one makes
the advertised workflow impossible to complete without a text editor.

## 5 — Two rooms read as one, and no output says why

**Class: gap** · the single most expensive obstacle of the session · [**#48**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/48) — **half fixed, half open**

A 64-wide doorway between two 384-wide rooms, and `read_vmf_rooms` returned
`{"roomCount": 1, "portals": []}` — so `{"room": "*"}` matched one thing and
`{"portal": "*"}` matched nothing.

The cause, found by reading `src/space/rooms.ts:345-367` rather than by any output: regions
merge when the clearance across their boundary reaches the smaller of their two peaks, and
`peak` is indexed by the union-find root, which is `min(index)`. So a **dead-end nook with a
low cell index**, once absorbed into a large room, keeps its own tiny peak for the rest of the
pass — and then bridges through the doorway to the next room. A free-standing shelf island did
it. So did a counter stopping 32 units short of a wall, leaving a 32 × 32 corner.

Which means: **the shop's furniture layout was dictated by a watershed implementation detail.**
Shelving flush to the west wall, counter run all the way to the south wall — not design
decisions, concessions, and none of them discoverable from any tool's output.

What would have collapsed four hours into one call, in the builder's own words: for each pair
of regions it merged, `read_vmf_rooms` reporting the reason and the cell —
`merged region 3 into 0: through=2 >= min(peak)=2 at [368,16]`. The algorithm has that in
hand at the moment it decides; it simply does not say it.

## 6 — A counter top is a room, and no rule can ever pass on it

**Class: bug** · [**#49**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/49) — **fixed**

A 40-unit counter produced `room 1: headroom is 104 units` and
`room 1: room area is 6912 square units`, both at `[304,48,48]` — the top of the counter. It
reports `connectsTo: []`, so the `minRoomArea` merge can never absorb it, and shrinking the
counter below the 4096 threshold did not stop it being reported. A counter top is 104 units of
headroom and 4 m² by construction: **no room rule can pass on it, ever.**

Worked around by reading `src/space/voxel.ts:41` — `STANDING_CELLS = ceil(72 / step)` — and
making every piece of furniture 80 units tall so that only 64 remain to the ceiling and no top
is standable at step 16 or step 8. A real constraint dressed as a style choice.

## 7 — `read_leak` delivers the good news through the error channel

**Class: ergonomics** · [**#50**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/50) — **fixed**

Confirming on the compiled `.bsp` that vbsp agreed the map was sealed:

```
read_leak failed: …/hmcp_bodega.lin does not exist. vbsp writes it beside the map when
it leaks, so no pointfile usually means the last compile did not leak.
```

The sentence is right and it is the answer. But it arrives as a tool failure, so a caller that
treats errors as failures reads *this map is sealed* as *this step broke* — and "usually"
hedges the one thing being confirmed.

## 8 — `read_vmf_rooms` and `check_vmf_rules` cannot be made to agree

**Class: ergonomics** · [**#51**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/51) — **fixed**

`read_vmf_rooms` exposes `minRoomArea`; `check_vmf_rules`, which calls it, does not — it takes
`step`, `maxCells` and `seeds` only. So the tool used to *diagnose* a segmentation and the
tool that *judges* against it can never be run at the same settings.

## 9 — The audit log cannot see the failure of finding 2

**Class: gap**, in the instrumentation · [**#52**](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/52) — **fixed**

The round-1 window of `.hammer-mcp/logs/audit.jsonl` records `edit_vmf` three times, **zero
errors** — while the builder was hitting a hard MCP error on one of those calls. The handler
succeeded, so `tool_result` was recorded `ok: true`; the SDK's output-schema validation then
turned the result into an error, downstream of anything the log sees.

The method for this exercise said the instrumentation would not be touched before round 1, and
that if the reading suffered for it that would be the first *measured* defect. It did, and this
is it: the objective half of the measurement missed the session's most dangerous bug entirely,
and only the builder's own log caught it.

---

## The round-1 numbers

The baseline round 2 will be compared against. From the audit window, 53 MCP calls:

| Tool | Calls | Logged failures |
|---|---|---|
| `write_vmf_solid` | 14 | 1 |
| `read_vmf_rooms` | 12 | |
| `delete_solids` | 5 | |
| `read_game_content` | 4 | |
| `edit_vmf` | 3 | 0 *(see finding 9)* |
| `check_vmf_rules` | 3 | |
| `read_vmf`, `read_vmf_leak`, `transform_solids` | 2 each | |
| `health`, `set_solid_class`, `read_vmf_lint`, `run_compile`, `render_vmf_plan` | 1 each | |
| `read_leak` | 1 | 1 *(see finding 7)* |

**53 calls · 2 logged failures · one hand-edit forced.** The twelve `read_vmf_rooms` calls
against one `render_vmf_plan` are finding 5 in one line: a third of the session spent asking
the same question because the answer never said why.

The map reached all three greens: sealed by `read_vmf_leak` and by the compiler, 7/7 rules with
nothing unmatched, and vbsp/vvis/vrad all exiting 0. 18 brushes, 8 entities, 416 × 576 × 176
units.

## What the prediction was worth

Round 0 predicted that the builder would use none of the tools missing from the skills. It used
`read_vmf_leak`, `check_vmf_rules`, `read_vmf_rooms` and `render_vmf_plan` — so the prediction
is refuted, and it deserved to be: **the brief named three of those tools by name** in its "Done"
section. The prediction was untestable as written, and stating it that way was the error.

What survives is narrower and still worth having: the builder used `render_vmf_plan` **once**,
never called `render_vmf_view`, and reached for none of `measure_vmf_clearance`,
`measure_vmf_approach` or `read_vmf_surfaces` — none of which the brief mentions and none of
which the skills describe. Round 2, on updated skills, is what will actually test it.


---

## What happened to all of it

| | Class | State |
|---|---|---|
| 1 · a build twelve tools old, silently | bug | fixed — `health` reports its tool count and whether its build is stale |
| 2 · `edit_vmf` erroring after it wrote | bug | fixed — and the retry it invited is the reason it mattered |
| 3 · `check_vmf_rules` green while checking nothing | bug | fixed — an `overall` that says `skipped`, never `pass` |
| 4 · nothing creates a `.vmf` | gap | fixed — `write_vmf`, proven by a compile that seals |
| 5 · no output says why two rooms merged | gap | **half fixed** — every merge now reports its reason and its cell; the ordering defect underneath is open |
| 6 · a counter top is a room | bug | fixed — a place no walk reaches is reported apart from the rooms |
| 7 · `read_leak` answering through the error channel | ergonomics | fixed — and the hedge replaced with evidence |
| 8 · the two room tools could not agree | ergonomics | fixed — they share `minRoomArea` |
| 9 · the audit log could not see finding 2 | gap | fixed in `mcp-core` 0.2.0, released and consumed here |

Six fixed here, one fixed upstream and since released, one half open. The suite went from 847
tests to 889.

The instrumentation fix is worth one more line, because it closes the loop this exercise
opened. Proved on a live server rather than in a unit test: a handler that succeeds and then
fails its own output schema is now recorded `ok: false`, `handlerRan: true`, with the duration
and a message that says not to retry. The round-1 log said `edit_vmf`, three calls, zero
errors, while the builder was staring at a hard protocol error on one of them. It no longer
can.

## The one that is still open, and why it is the interesting one

Finding 5 turned out to have two halves. Reporting the merges was straightforward and is
done. The half underneath is not, and the reason is worth more than the fix would have been.

`peak` is a region's widest clearance — the code says so — and stops being true the moment
two regions merge: the union is pointed at `min(index)` and keeps *that* region's peak. Cell
indices are a fact about scan order, so absorb a one-cell nook in a corner into a large room
and the union inherits the nook's peak. The bar for merging through a doorway on the far
side of the map then drops to the width of a corner nobody was looking at.

`test/watershed.test.ts` draws it in eight lines of ASCII. The sharpest form: **flip the
plan top to bottom and the room count changes**, one against two — mirroring changes cell
indices and nothing else.

And the one-line repair is wrong. Carrying the peak through the merge turns those plans
green and turns the three-space fixture into **four** rooms, breaking nine further
assertions across the plan renderer and the doorway measurements. Which says that the merge
criterion — *"if the opening between two regions is as wide as the narrower of the two,
nothing narrows and they are one space"* — was calibrated against peaks that shrink. Correct
the peak and the rule under-merges: the corridor the rule exists to collapse stops
collapsing.

So the defect is real, minimal, reproduced, and repairing it means revisiting the criterion
rather than the bookkeeping. Both plans are committed as `it.fails`, so they go red the day
somebody gets it right.

That is the shape of this whole exercise in one finding: using the thing surfaced something
no amount of reading the code would have, and the honest account of it is worth more than a
green test bought by asserting the wrong answer.

---

# Round 2 — the same brief, the fixed toolkit

Same brief, byte for byte. Same instructions. **The skills were deliberately left untouched**,
still a wave behind, so that this round measures the tool changes and nothing else.

## What it cost

| | Round 1 | Round 2 |
|---|---|---|
| MCP calls | 53 | **51** |
| logged failures | 2 | **1** |
| hand-edits forced | **1** | **0** |
| worst repeated identical call | **9×** `read_vmf_rooms` | 2× |
| `read_vmf_rooms` calls | 12 | 11 |
| brushes · entities | 18 · 8 | 14 · 8 |

The call count barely moved, and that is the honest headline. What moved is the *shape* of the
session.

**The forced hand-edit is gone.** `write_vmf` was called once, worked, and the map was built
end to end through tools alone — the exercise's central rule held for the first time. The one
logged failure is not the old gap: it is an `ENOENT` from a path the builder mistyped
(`project-société`, with an accent it invented). Which is its own small finding — a mistyped
path and a missing file return the same raw errno, and neither says which.

**The nine identical calls are gone.** In round 1 `read_vmf_rooms` was called nine times with
byte-identical arguments: the same question, over and over, because the answer never said why.
In round 2 nothing repeats more than twice, and the builder used `merges` to reason with
rather than re-asking. That is the clearest evidence that reporting the merges was worth
doing.

**Every fix was exercised, and each behaved as designed.** `write_vmf` created the map.
`read_leak` answered `leaked: false` rather than erroring. `check_vmf_rules` returned
`overall: "skipped"` rather than a false pass — and the builder read it correctly and refused
to claim a green the default arguments do not produce. `read_vmf_rooms` reported its merges
with both numbers.

## The finding that replaces the old one

Round 1's most expensive obstacle was that two rooms read as one and nothing said why. Round 2
hit the same wall for a completely different reason, and this one is worse.

**The room pass finds the map's two rooms at exactly one cell size, and it is not the
default.** Measured on the round 2 map, 13/08/2026:

| `step` | rooms | portals |
|---|---|---|
| 8 | 1 | 0 |
| **16** (the default) | **1** | **0** |
| **32** | **2** | **1** |
| 64 | 1 | 0 |

The response is **not monotone**. There is a single working value with lower and higher
neighbours that both fail, so no amount of "try finer" or "try coarser" converges — and the
parameter's own description points the wrong way: *"16 is the coarsest that resolves a 32-unit
doorway"* reads as an argument for going finer, which here makes it worse (`mergeCount` climbs
from 10 to 17 as the field fragments).

The builder rebuilt the geometry four times chasing this — divider 32 → 64 → 96 units,
shelving moved, storeroom deepened, doorway narrowed and re-aligned — before finding that none
of it was necessary and one parameter was. In its own words: *"all of the geometry churn it
caused was wasted work"*.

So the room finder cost two thirds of both sessions, for two different reasons, and the second
is a sharper statement of the same underlying defect as [#48](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/48):
**the segmentation is a fact about the grid rather than about the map.** Round 1 showed it
varies with cell *order*; round 2 shows it varies with cell *size*, non-monotonically. Neither
is a property a reader can reason about.

## The new findings

| | Class | Where |
|---|---|---|
| 10 · the room pass segments at one cell size, non-monotonically | **bug** | [#53](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/53) |
| 11 · `check_vmf_rules` does not say what segmentation it used | **ergonomics** | [#54](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/54) |
| 12 · `measure_vmf_clearance` returns a confident wrong number for a point the hull cannot occupy | **bug** | [#55](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/55) |
| 13 · a sightline violation does not say what height it traced at | **ergonomics** | [#56](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/56) |
| 14 · `write_vmf_solid` gives every face of a brush the same material | **gap** | [#57](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/57) |
| 15 · a seed point is silently moved, and the output does not say why | **ergonomics** | [#58](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/58) |

Finding 12 is the one the builder itself flagged as most wanting a fix: measuring at a height
where the standing hull is buried in the floor returned `widthUnits: 32` — exactly the hull's
own footprint — with `insideSolid: false` and a bound naming no brush at distance 0. A
confident wrong number, indistinguishable from a real narrow passage. It is the same class of
error as the `standingAt` bug that `check_vmf_rules` was built on top of, in a tool that
does not go through `standingAt`.

## What the exercise is worth, after two rounds

Nine findings in round one, six more in round two, of which eleven are fixed. The two rounds
cost about the same number of calls, which is the least interesting number on this page: what
changed is that round 2's session was spent on the map's real problem rather than on the
toolkit's, and that its remaining obstacle is a single, sharply stated defect rather than a
fog.

The measurement also justified its own method twice over. The audit log caught the nine
identical calls, which no friction log would have recorded as remarkable — a builder does not
notice it is repeating itself. And the friction log caught the round-2 `step` finding, which
the audit log shows only as eleven `read_vmf_rooms` calls with varying arguments and no
indication that ten of them were wasted.

---

# Round 3 — the same brief again, with the workflow written down

Same brief, byte for byte, for the third time. Same instructions. What changed since round 2:
the skills, which now carry [`building.md`](../../../.claude/skills/source-map/references/building.md),
and eight further tool fixes.

**That is two variables at once, and the honest reading has to say so.** Rounds 1 and 2 isolated
the tooling; this one cannot separate the written workflow from the fixes that landed beside it.
One number stays attributable, and it is the one the page was written for: what the `step` trap
costs when somebody has been warned about it.

## What it cost

| | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| MCP calls | 53 | 51 | **41** |
| logged failures | 2 | 1 | **0** |
| hand-edits forced | 1 | 0 | 0 |
| `check_vmf_rules` passes at the **default** cell size | — | no (needed 32) | **yes** |
| worst repeated identical call | 9× `read_vmf_rooms` | 2× | 6× `check_vmf_rules` |
| brushes · entities | 18 · 8 | 14 · 8 | 16 · 8 |

Twenty-three per cent fewer calls than round 1, and the first session with **no failed call at
all**. The map is also the first to satisfy its brief at the default `step`, which no amount of
documentation causes — that is geometry the builder chose, and it chose it having read why the
cell size matters.

Two things in the call list say the page was read and followed: `validate_io` and
`render_vmf_plan` were both called, and both appear in `building.md` under *"what is worth doing
even though nothing enforces it"*. Neither had been called in round 1 or 2.

## What the documentation was worth, and where it was wrong

The builder's own account names seven things it saved. The load-bearing one:

> the non-monotone `step` trap — **which is what proved my problem was *not* segmentation**

That is the page working exactly as intended, and it is worth being precise about how. It did
not prevent the problem. It ended the search: five `step` values, all giving one room, and the
builder concluded from the documented table that this was not the documented trap and went
looking elsewhere. Rounds 1 and 2 had no such stopping rule and each spent about two thirds of
the session there.

Also named: *"read `overall`, never `errorCount`"* — the furniture regression returned
`errorCount: 0` with an empty `violations` array and `overall: "skipped"`, a run that looks
perfect and checked nothing. Without that line the session would have ended green and wrong.

**And the page was wrong about one thing, which is the finding this round exists to produce.**
It said to put shelving flush to a wall. The builder did exactly that — three runs, all against
walls, none near the divider — and still lost the doorway. The cause was **depth**: a run 48
units deep collapsed the segmentation where the same run at 32 did not, from 200 units away.
`building.md` now says so, and says that the `step` sweep will not find it.

## The new findings

| | Class | Where |
|---|---|---|
| 16 · `clearance_in_front` reports 0 without saying what stopped it | **bug** | [#59](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/59) |
| 17 · nothing reports a portal that stopped existing | **gap** | [#60](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/60) |
| 18 · a doorway built to the brief's own number can measure under it | **bug** | [#61](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/61) |
| 19 · `write_vmf` picks a skybox vbsp then complains about | **ergonomics** | [#62](https://github.com/ProjectSocietyStudio/hammer-mcp/issues/62) |
| 20 · `building.md` said flush-to-a-wall was enough | **docs** | fixed |

Finding 16 is the sharpest, because it is **my own incomplete fix**. #55 taught
`measure_vmf_clearance` to say `hullFits: false` and name what bounded it. The
`clearance_in_front` check inside `check_vmf_rules` does the same measurement and did not get
the same treatment, so it still reports a bare 0 — and the builder spent its first hypothesis on
a yaw convention that was never the problem. Fixing a tool is not the same as fixing the
question it answers.

Finding 17 is #48 from a third angle. Round 1: the segmentation varies with cell **order**.
Round 2: with cell **size**, non-monotonically. Round 3: with **geometry 200 units from the
boundary that changes**. Three different symptoms, one statement — the segmentation is a fact
about the grid rather than about the map — and the thing that would have cost one call instead
of a dozen is the same each time: *say what changed and why*.

## What three rounds are worth

Twenty findings, sixteen fixed. The call count fell 53 → 51 → 41 and the failure count 2 → 1 →
0, but the number that matters is not on that line: each round's remaining obstacle is a
sharper statement of the same defect than the last, and the sessions stopped being spent on the
toolkit's problems and started being spent on the map's.

The method also produced its own correction three times, which is the part worth keeping. Round
1's prediction was refuted and deserved to be. Round 2's instrumentation gap was predicted and
then measured. Round 3 found the documentation written after round 2 to be wrong in a specific,
correctable way — which no amount of re-reading it would have shown.
