"""Flattening `func_instance` the way vbsp does, before anything counts or lints a VMF.

A `func_instance` is one entity in the file and a whole building in the map. vbsp expands
it at compile time: the sub-VMF's brushes and entities are transformed into place, and
every `targetname` inside is renamed so two copies of the same instance do not collide.

Read without expanding, a map using instances is a lie in both directions. `count_vmf`
reports one entity where there is a building, so a map far past `MAX_MAP_BRUSHES` looks
comfortable. And every output crossing an instance boundary targets a name that is not in
the root file, so `output-target-missing` fires on references that are perfectly correct.

The fixup rules -- three styles, `$variable` substitution, automatic names for unnamed
instances -- are exactly the kind of thing one implements from memory and gets subtly
wrong, so this delegates to `srctools.instancing`, which models vbsp's own behaviour.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


class InstanceError(Exception):
    """Something about the instances made the map unreadable, with a reason to report."""


def _search_paths(vmf_path: str, game_dir: str | None) -> Any:
    """Where an instance's `file` keyvalue is resolved from.

    Beside the map first, which is what a mapper working in one folder expects, then the
    game's `maps/`, which is where vbsp looks. Not the SDK layout srctools defaults to:
    GMod has no `sdk_content`.
    """
    from srctools.filesys import RawFileSystem
    from srctools.instancing import get_inst_locs

    fsys = get_inst_locs(Path(vmf_path))
    if game_dir:
        maps = Path(game_dir) / "maps"
        if maps.is_dir():
            fsys.add_sys(RawFileSystem(str(maps)))
    return fsys


def collapse_instances(
    vmf: Any, vmf_path: str, game_dir: str | None = None, recur_limit: int = 16
) -> dict[str, Any]:
    """Expands every `func_instance` in place. Returns what was expanded.

    `recur_limit` is 16 rather than srctools' 100: an instance tree that deep is a mistake,
    and the difference between the two numbers is how long the mistake takes to report.
    """
    from srctools.instancing import collapse_all

    found = sorted(
        {ent["file", ""] for ent in vmf.by_class["func_instance"] if ent["file", ""]}
    )
    count = len(list(vmf.by_class["func_instance"]))
    if not count:
        return {"collapsed": 0, "files": [], "depthLimit": recur_limit}

    try:
        collapse_all(vmf, _search_paths(vmf_path, game_dir), recur_limit)
    except FileNotFoundError as exc:
        # Named, because the alternative is a traceback about a path the caller never
        # wrote: the instance file is referenced from inside the map, not passed in.
        raise InstanceError(
            f"instance file not found: {exc}. Instances are resolved beside the map, "
            f"then in <game>/maps/"
        ) from exc
    except RecursionError as exc:
        raise InstanceError(
            f"instances nest more than {recur_limit} deep, or include each other in a "
            f"loop; the map cannot be flattened"
        ) from exc

    return {"collapsed": count, "files": found, "depthLimit": recur_limit}
