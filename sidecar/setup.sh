#!/usr/bin/env bash
# Creates the sidecar's virtualenv and installs its pinned dependencies.
#
# The venv lives in the repo's state directory (<repoRoot>/.hammer-mcp/sidecar-venv),
# not in this folder: it is machine-specific build output, and the state directory is
# already ignored by git and already where this server keeps its runtime files.
#
# Safe to re-run: it recreates nothing that already matches.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="${HAMMER_MCP_REPO:-$(cd "$here/../.." && pwd)}"
venv="$repo_root/.hammer-mcp/sidecar-venv"

if [[ ! -x "$venv/bin/python" ]]; then
  echo "creating venv: $venv"
  python3 -m venv "$venv"
fi

"$venv/bin/python" -m pip install --quiet --upgrade pip
"$venv/bin/python" -m pip install --quiet -r "$here/requirements.txt"

echo -n "sidecar ready: "
"$venv/bin/python" "$here/main.py" health </dev/null
echo
