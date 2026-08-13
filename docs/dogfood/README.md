# Using the toolkit, to find out what using it is like

Every other document here measures a *map*. This one measures the *tools*, and it exists
because the two are not the same question and the second had never been asked.

The state of play on 13/08/2026: 70 tools, a Hammer parity table with two empty cells, and a
`Proven, and not proven` list where nearly every row says proven. What none of that says is
whether a map can be **built** here, because nobody had built one. The only map this toolkit
has ever produced is `test/fixtures/hmcp_probe.vmf` — six brushes, a sealed box whose job is
to make a compiler agree with a checker.

So: build a real small place, with the tools and nothing else, and write down every place it
hurts.

## The protocol

**Round 0 — the brief, written twice.** In prose, for whoever builds; and as
`<map>.rules.json`, for `check_vmf_rules`. Any sentence of the brief that has no checkable
form is already a finding, about the rules schema rather than about the map.

**Round 1 — a cold builder.** An agent with no prior context gets the prose brief, this MCP
server, and the skills *as they currently are*. Three hard rules:

1. **The `.vmf` is never edited by hand.** No text editor, no `sed`. If no tool reaches
   something, that is recorded and the build moves on.
2. **A friction log is kept as it happens** — what was wanted, the call made, what was
   expected, what came back, how it was worked around. Written at the moment of friction,
   never reconstructed afterwards.
3. **Done is three greens**: `read_vmf_leak` sealed, `check_vmf_rules` with no violation,
   `run_compile` without error.

**The reading.** Two sources, one of them not a matter of opinion. The friction log says
*why*; `.hammer-mcp/logs/audit.jsonl` says *how much* — every call with its arguments, every
error with its message. From it: tools never called although they answered the question at
hand, identical calls repeated (the signature of an error message that teaches nothing), and
the failure rate per tool.

Nothing about that instrumentation is changed before round 1. It records no duration, and a
structured refusal returned as a value is indistinguishable there from a success. If the
reading suffers for it, that is the first *measured* defect and it gets fixed with its
evidence — not pre-emptively.

**The sorting.** One class per finding, and the class decides what happens to it.

| Class | What it means | What happens |
|---|---|---|
| **bug** | the tool is wrong, or refuses what it should accept | fixed, with a test seen red first |
| **gap** | no tool answers the question | an issue, unless it blocks |
| **ergonomics** | the tool answers, and the caller could not have guessed how | a better description or message, or an issue |
| **docs** | the tool exists and the skill does not say so | the skill is fixed |

The two middle-weight classes are the point. A parity table can see a gap; it cannot see a
tool that is present, correct, and unusable.

**Round 2 — the same trip again.** A new cold builder, the same brief, the fixed toolkit.
The improvement is a number: calls to reach the three greens, failures, remaining blocks.
Without the second round we would have fixed things without knowing whether it helped.

## The rounds

| Round | Subject | Where |
|---|---|---|
| 1 | a corner shop — `hmcp_bodega` | [`2026-08-13-bodega/`](2026-08-13-bodega/) |
