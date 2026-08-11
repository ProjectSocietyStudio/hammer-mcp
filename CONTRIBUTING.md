# Contributing to hammer-mcp

This repository has a narrow discipline and few rules. They come down to three ideas.

## 1. A passing test proves nothing until it has been shown it can fail

This one outranks the others. A green test may be green because the code works, or because the test
tests nothing — and nothing in the output distinguishes the two.

So for every test you add: **sabotage the code it covers, watch it go red, put it back.** Then say
so in the commit message, naming what you broke.

That is not a formality here. `edit_vmf` shipped with four tests asserting byte equality after a
splice; replacing the splice with a full reserialisation made **none of them fail**, because the
fixtures were canonical enough to round-trip. The tests were proving nothing, and only the sabotage
said so. [`docs/architecture.md`](docs/architecture.md#splicing) records it.

This suite makes the trap concrete in a second way: it drives real compilers, a real Python sidecar
and real maps, none of which ships with the repository. A test that cannot find what it needs
**skips**, and an over-broad `it.skipIf` is indistinguishable from a success. Hence:

- availability predicates live in `test/support/env.ts`, **all of them**, never reinvented inside a
  test file;
- a run announces in plain text what it could not test;
- CI **refuses** a green run in which too few tests actually executed.

## 2. No number nobody read

This repository asserts a great many numbers: lump ceilings, sizes, thresholds, durations. Each one
comes from a file that was read or a measurement that was taken, and **the docs say which, with its
date**.

A lump ceiling copied off a wiki page, a limit that is "probably the same on that game", a duration
"in the region of": no. If a value cannot be verified, it is absent, or marked unverified — never
presented as fact. A tool that returns a wrong number is worse than a tool that does not exist,
because the caller has no way to suspect it.

The corollary for tools: **no tool without an oracle.** If you cannot build an independent way to
check what the tool returns, it does not ship. Several gaps are documented for exactly that reason
rather than filled with guesswork.

## 3. The commit carries its documentation

One atomic commit, one subject, in English, conventional format (`feat:`, `fix:`, `docs:`,
`chore:`, `test:`, `refactor:`). The body says **why**, not what — the diff already says what.

Documentation the change makes false is fixed **in the same commit**. A README describing a tool
that does not exist is a bug, not a delay: somebody reads it and relies on it.

## Before opening a PR

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Typecheck is separate from tests, and not out of habit: a stale `dist/` of
`@projectsociety/mcp-core` makes tests green and typecheck red on the same tree. Run both, always.

`main` is reached by a merged PR, never by a push.

## What is not wanted

- **A free-form argument passthrough to the compilers.** A flag nobody can verify does not belong
  in a tool; it belongs in the documentation, presented as a judgement call.
- **A reader that loads a whole file.** Real maps run to the gigabyte, and a `readFileSync` on one
  kills the MCP transport — which the caller sees as a hang, not an error. Everything reads by
  offsets.
- **Redistributing Valve content or the Hammer++ binaries.** They are installed, not vendored. No
  `.fgd`, `.bsp` or `.exe` that is not ours enters this repository.
