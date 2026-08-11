#!/usr/bin/env python3
"""Sidecar for the Source file formats srctools already knows how to read.

One subprocess per call: a verb in argv[1], a JSON request on stdin, a JSON reply on
stdout, diagnostics on stderr. No daemon and no lock -- that is the point. hammer-mcp is
stateless, and the incident that produced gmod-mcp's daemon.lock is exactly what a
long-lived helper here would invite.

The boundary follows call frequency, not file format: what is hot and already proven
stays in TypeScript (BSP by offset, KeyValues with offsets preserved, the .lmp codec);
what is cold and expensive to rewrite lives here.

Every reply is a JSON object. Failures come back as {"error": {...}} with exit code 1,
never as a traceback on stdout: the caller parses this, and a half-JSON stream would
look like a protocol fault rather than a bad path.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable

VERBS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {}


def verb(name: str) -> Callable[[Callable[[dict[str, Any]], dict[str, Any]]], Any]:
    def register(fn: Callable[[dict[str, Any]], dict[str, Any]]) -> Any:
        VERBS[name] = fn
        return fn

    return register


@verb("health")
def _health(_req: dict[str, Any]) -> dict[str, Any]:
    """Reports what this sidecar can actually do. Must never raise: hammer-mcp's own
    health tool calls it to describe a broken install rather than fail with it."""
    out: dict[str, Any] = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
    }
    try:
        from importlib.metadata import version

        import srctools  # noqa: F401 -- imported to prove it loads, not for its names

        out["srctools"] = version("srctools")
        out["ok"] = True
    except Exception as exc:  # noqa: BLE001 -- reporting, not handling
        out["srctools"] = None
        out["ok"] = False
        out["reason"] = f"{type(exc).__name__}: {exc}"
    return out


def main() -> int:
    if len(sys.argv) < 2:
        json.dump({"error": {"kind": "usage", "message": "missing verb"}}, sys.stdout)
        return 1

    name = sys.argv[1]
    fn = VERBS.get(name)
    if fn is None:
        json.dump(
            {
                "error": {
                    "kind": "unknown_verb",
                    "message": f"unknown verb {name!r}",
                    "known": sorted(VERBS),
                }
            },
            sys.stdout,
        )
        return 1

    raw = sys.stdin.read()
    try:
        req = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        json.dump(
            {"error": {"kind": "bad_request", "message": f"stdin is not JSON: {exc}"}},
            sys.stdout,
        )
        return 1

    try:
        json.dump(fn(req), sys.stdout)
    except Exception as exc:  # noqa: BLE001 -- the boundary turns anything into JSON
        traceback.print_exc(file=sys.stderr)
        json.dump(
            {"error": {"kind": type(exc).__name__, "message": str(exc)}},
            sys.stdout,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
