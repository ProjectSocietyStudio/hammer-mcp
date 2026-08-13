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
