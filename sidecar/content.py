"""Searching the game's own content: which materials and models exist, and what they are.

A mapper picks a texture from Hammer's browser and a prop from its model viewer. An agent
had neither, so it named materials from memory -- and vbsp resolves a name literally, which
makes a wrong one a purple checkerboard nobody sees until a player loads the map. `set_face_
material` can now change a wall's material; this is how you find out what to change it to.

The mounting is the same one `dependencies.py` uses, deliberately: `Game(dir).get_filesystem()`
chains the VPKs and the loose tree in the order the engine reads them. Reusing it means the
answer here and the answer there cannot disagree about what is installed.

Two things this does not do, and says so rather than implying otherwise:

**It does not judge whether a texture looks right.** It reports the shader, the flags and the
size; "is this the brick for a 1970s Bronx tenement" is not a measurement.

**It does not read every VMT to answer a search.** A Garry's Mod install holds tens of
thousands, and parsing them all to answer "brick" would cost seconds per call. The search is
over names; `details` reads the VMTs of what the search returned, which is a handful.
"""

from __future__ import annotations

import fnmatch
import re
from typing import Any

# A search that returns everything is not a search, and serialising 40 000 names through
# the transport would cost more than the caller could use.
DEFAULT_LIMIT = 100
MAX_LIMIT = 1000


def _mount(game_dir: str | None) -> tuple[Any, str | None]:
    if not game_dir:
        return None, "no gameDir given, so nothing was searched"
    try:
        from srctools.game import Game

        return Game(game_dir).get_filesystem(), None
    except Exception as exc:  # noqa: BLE001
        return None, f"{type(exc).__name__}: {exc}"


def _walk(fsys: Any) -> list[str]:
    """Every file the mounted chain can see, as engine-relative paths."""
    out: list[str] = []
    for f in fsys:
        try:
            out.append(f.path.replace("\\", "/"))
        except Exception:  # noqa: BLE001,S112
            continue
    return out


def _searchable(rel: str, prefix: str) -> str:
    """The name a mapper thinks in: `brick/brickwall001a`, no prefix and no extension.

    Matching against the full engine path instead is what a first version did, and it made
    every anchored glob fail silently: `brick/brickwall*` cannot match
    `materials/brick/brickwall001a.vmt`, because fnmatch anchors at both ends and the path
    starts with the prefix. It returned nothing, which is indistinguishable from a game
    that does not have the texture.
    """
    stem = rel[len(prefix) :] if rel.lower().startswith(prefix) else rel
    return stem.rsplit(".", 1)[0].lower()


def _matcher(pattern: str) -> Any:
    """A glob when it looks like one, a substring otherwise.

    `brick*` and `metal/*floor*` are what a mapper types; `brick` on its own means "anything
    with brick in it", not "a file called exactly brick". Guessing wrong in either direction
    returns nothing and looks like the content is missing.

    A glob is tried anchored and then floating, so `brick/brickwall*` matches from the start
    of the name while `*wall00?a` still matches in the middle of it.
    """
    p = pattern.lower().strip("/")
    if any(c in p for c in "*?["):
        return lambda name: fnmatch.fnmatch(name, p) or fnmatch.fnmatch(name, f"*{p}")
    return lambda name: p in name


def _vmf_name(rel: str) -> str:
    """`materials/brick/wall.vmt` as a .vmf stores it: `BRICK/WALL`.

    The form `set_face_material` wants. Returning the path instead would make the caller
    strip the prefix and the suffix itself, which is exactly the step that gets skipped.
    """
    stem = rel[len("materials/") :] if rel.lower().startswith("materials/") else rel
    return re.sub(r"\.vmt$", "", stem, flags=re.IGNORECASE).upper()


def _material_details(fsys: Any, rel: str) -> dict[str, Any]:
    """Shader, base texture and surface properties of one material."""
    out: dict[str, Any] = {"shader": None, "basetexture": None, "surfaceprop": None,
                           "translucent": False, "toolTexture": False, "error": None}
    try:
        from srctools.vmt import Material

        with fsys[rel].open_str() as fh:
            mat = Material.parse(fh, rel)
        mat = mat.apply_patches(fsys)
        out["shader"] = mat.shader
        for key in ("$basetexture", "$bumpmap", "$surfaceprop", "$translucent", "$alphatest"):
            val = mat.get(key)
            if val is None:
                continue
            if key == "$basetexture":
                out["basetexture"] = str(val)
            elif key == "$surfaceprop":
                out["surfaceprop"] = str(val)
            elif key in ("$translucent", "$alphatest") and str(val).strip() not in ("0", ""):
                out["translucent"] = True
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
    out["toolTexture"] = rel.lower().startswith("materials/tools/")
    return out


def search_content(req: dict[str, Any]) -> dict[str, Any]:
    """Finds materials and models in the game, by name."""
    game_dir = req.get("gameDir")
    pattern = str(req.get("pattern", "")).strip()
    kind = req.get("kind", "material")
    limit = min(int(req.get("limit", DEFAULT_LIMIT)), MAX_LIMIT)
    want_details = bool(req.get("details", False))

    if not pattern:
        return {"error": "a search needs a pattern; an empty one would return the whole game"}

    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {
            "gameDir": game_dir,
            "mounted": False,
            "mountError": mount_error,
            "pattern": pattern,
            "kind": kind,
            "total": 0,
            "results": [],
            "note": "nothing was searched, so an empty result here says nothing about the game",
        }

    prefix, suffix = (
        ("materials/", ".vmt") if kind == "material" else ("models/", ".mdl")
    )
    match = _matcher(pattern)
    hits: list[str] = []
    for path in _walk(fsys):
        low = path.lower()
        if not low.startswith(prefix) or not low.endswith(suffix):
            continue
        if match(_searchable(low, prefix)):
            hits.append(path)

    hits.sort()
    total = len(hits)
    shown = hits[:limit]

    results: list[dict[str, Any]] = []
    for rel in shown:
        row: dict[str, Any] = {"path": rel}
        if kind == "material":
            row["name"] = _vmf_name(rel)
            if want_details:
                row.update(_material_details(fsys, rel))
        results.append(row)

    return {
        "gameDir": game_dir,
        "mounted": True,
        "mountError": None,
        "pattern": pattern,
        "kind": kind,
        "total": total,
        "shown": len(results),
        "truncated": total > len(results),
        "results": results,
        "note": (
            "names only unless details was asked for: a Garry's Mod install holds tens of "
            "thousands of VMTs and parsing them all to answer one search would cost seconds"
        ),
    }


def model_info(req: dict[str, Any]) -> dict[str, Any]:
    """Bounds, skins, sequences and materials of one .mdl.

    What Hammer's model browser shows, and what an agent needs before placing a prop: a
    prop_static positioned from its origin without knowing its size lands half inside the
    floor, and nothing downstream reports that.
    """
    game_dir = req.get("gameDir")
    rel = str(req.get("model", "")).replace("\\", "/").strip()
    if not rel:
        return {"error": "no model given"}
    if not rel.lower().startswith("models/"):
        rel = f"models/{rel}"
    if not rel.lower().endswith(".mdl"):
        rel = f"{rel}.mdl"

    fsys, mount_error = _mount(game_dir)
    if fsys is None:
        return {"model": rel, "mounted": False, "mountError": mount_error, "found": False}

    try:
        from srctools.mdl import Model

        mdl = Model(fsys, fsys[rel])
    except (KeyError, FileNotFoundError):
        return {
            "model": rel,
            "mounted": True,
            "mountError": None,
            "found": False,
            "note": "not in this game's content. Check the name, or the addon that ships it",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "model": rel,
            "mounted": True,
            "mountError": None,
            "found": False,
            "error": f"{type(exc).__name__}: {exc}",
        }

    def _vec(v: Any) -> list[float] | None:
        try:
            return [round(float(v.x), 3), round(float(v.y), 3), round(float(v.z), 3)]
        except Exception:  # noqa: BLE001
            return None

    textures = []
    try:
        textures = sorted({t.replace("\\", "/") for t in mdl.iter_textures()})
    except Exception:  # noqa: BLE001
        textures = []

    skins: list[int] = []
    try:
        skins = list(range(len(mdl.skins)))
    except Exception:  # noqa: BLE001
        skins = []

    # Labels only. srctools' Sequence reprs its bounding box and its event list, which
    # runs to a few hundred characters each and answers a question nobody asked.
    sequences: list[str] = []
    try:
        sequences = [str(getattr(s, "label", s)) for s in getattr(mdl, "sequences", [])][:64]
    except Exception:  # noqa: BLE001
        sequences = []

    mins = _vec(getattr(mdl, "hull_min", None))
    maxs = _vec(getattr(mdl, "hull_max", None))
    size = (
        [round(maxs[i] - mins[i], 3) for i in range(3)]
        if mins is not None and maxs is not None
        else None
    )

    return {
        "model": rel,
        "mounted": True,
        "mountError": None,
        "found": True,
        "mins": mins,
        "maxs": maxs,
        "size": size,
        "skinCount": len(skins),
        "sequenceCount": len(sequences),
        "sequences": sequences,
        "materials": textures,
        "note": (
            "bounds are the model's own hull, around its origin. A prop placed at a floor's "
            "height sinks by however far its origin sits above its lowest point"
        ),
    }
