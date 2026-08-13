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
