<!--
Thanks for contributing. Three things are checked on every PR here; the rest is ordinary review.
CONTRIBUTING.md explains why each one exists.
-->

## What this changes, and why

<!-- The diff says what. Say why. -->

## The negative control

<!--
Required for any change with a test.

A passing test proves nothing until it has been shown it can fail. Sabotage the code the test
covers, watch it go red, put it back — and say here what you broke and what went red.

This is not ceremony: edit_vmf shipped with four byte-equality tests that a total sabotage did
not make fail. Only the deliberate break revealed it.
-->

## Numbers

<!--
If this PR states any figure — a limit, a size, a duration, a count — say where it was read or
how it was measured, with a date. A value that cannot be verified is marked unverified or left
out, never presented as fact.

Delete this section if the PR asserts no numbers.
-->

## Checklist

- [ ] `pnpm build && pnpm typecheck && pnpm test` all pass
- [ ] Documentation this change makes false is fixed in the same commit
- [ ] Commits are atomic and conventional (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`)
