"""Checking a VMF against the game's FGD and against what the compilers will accept.

Every rule here answers a failure that is otherwise found late and expensively: after a
compile that took forty minutes, or in game, as an entity that quietly does nothing.
"""

from __future__ import annotations

from typing import Any

# Texture scale outside this range makes vbsp fail with "Bad surface extents", which
# names a face by an index nobody can find in Hammer.
MIN_TEXTURE_SCALE = 0.1
MAX_TEXTURE_SCALE = 10.0

# Keys every entity carries that no FGD class declares.
UNIVERSAL_KEYS = {"classname", "id", "hammerid", "origin", "angles", "spawnflags"}


def _finding(
    severity: str, rule: str, message: str, **extra: Any
) -> dict[str, Any]:
    return {"severity": severity, "rule": rule, "message": message, **extra}


def lint_vmf(
    vmf: Any, fgd: Any, lua_classes: frozenset[str] = frozenset()
) -> list[dict[str, Any]]:
    """`lua_classes` are scripted entities the repo defines in Lua.

    In GMod the FGD is not the whole truth: a gamemode or addon registers its own
    entities at runtime, and Hammer never hears about them. Without this set the lint
    calls `ttt_damageowner` an unknown class and is wrong -- the file
    `gamemodes/terrortown/entities/entities/ttt_damageowner.lua` defines it. Nothing can
    be said about their keyvalues either, since no schema for them exists anywhere.
    """
    findings: list[dict[str, Any]] = []

    entities = list(vmf.entities)
    names: dict[str, list[int]] = {}
    for ent in entities:
        name = ent["targetname", ""]
        if name:
            names.setdefault(name, []).append(int(ent.id))

    for name, ids in names.items():
        if len(ids) > 1:
            findings.append(
                _finding(
                    "info",
                    "duplicate-targetname",
                    f'{len(ids)} entities share the targetname "{name}"; an output '
                    f"aimed at it fires on all of them",
                    entity_ids=ids[:20],
                )
            )

    for ent in entities:
        classname = ent["classname", ""]
        ent_id = int(ent.id)
        cls = fgd.entities.get(classname)

        if cls is None:
            if classname in lua_classes:
                # Registered in Lua: legitimate, and nothing here can check its keys.
                continue
            findings.append(
                _finding(
                    "warning",
                    "unknown-classname",
                    f'"{classname}" is in no FGD class and no Lua entity of this repo '
                    f"defines it. Either a typo, or a scripted entity that lives "
                    f"somewhere this lint cannot see",
                    entity_id=ent_id,
                    classname=classname,
                )
            )
            continue

        known = {k.lower() for k in cls.kv} | UNIVERSAL_KEYS
        for key in ent.keys:
            if key.lower() not in known:
                findings.append(
                    _finding(
                        "warning",
                        "unknown-keyvalue",
                        f'"{classname}" has no keyvalue "{key}"; it will be ignored',
                        entity_id=ent_id,
                        classname=classname,
                        key=key,
                    )
                )

        for out in ent.outputs:
            if out.output.lower() not in {o.lower() for o in cls.out}:
                findings.append(
                    _finding(
                        "warning",
                        "unknown-output",
                        f'"{classname}" never fires "{out.output}"',
                        entity_id=ent_id,
                        classname=classname,
                        output=out.output,
                    )
                )

            target = out.target
            # !self, !activator and the other bangs are resolved at runtime.
            if not target or target.startswith("!"):
                continue
            if target not in names and not fgd.entities.get(target):
                findings.append(
                    _finding(
                        "warning",
                        "output-target-missing",
                        f'"{out.output}" of entity {ent_id} targets "{target}", which '
                        f"no entity in this map is named. In GMod a Lua-created entity "
                        f"can carry that name at runtime, so this is a lead, not a verdict",
                        entity_id=ent_id,
                        output=out.output,
                        target=target,
                    )
                )
                continue

            for target_id in names.get(target, []):
                target_ent = next(e for e in entities if int(e.id) == target_id)
                target_cls = fgd.entities.get(target_ent["classname", ""])
                if target_cls is None:
                    continue
                if out.input.lower() not in {i.lower() for i in target_cls.inp}:
                    findings.append(
                        _finding(
                            "error",
                            "unknown-input",
                            f'"{out.output}" sends "{out.input}" to "{target}", but '
                            f'{target_ent["classname", ""]} has no such input',
                            entity_id=ent_id,
                            target=target,
                            input=out.input,
                        )
                    )
                    break

    # Brush-side rules. Displacements are the reason to look at entity solids at all:
    # vbsp refuses a displacement that is not part of the world, and the id it prints
    # for the offending brush is always 0, so it cannot be found from the message.
    for ent in entities:
        for solid in ent.solids:
            for side in solid.sides:
                if getattr(side, "disp_power", None):
                    findings.append(
                        _finding(
                            "error",
                            "displacement-on-entity",
                            f'displacement on brush {solid.id} which belongs to '
                            f'"{ent["classname", ""]}" (entity {ent.id}); vbsp only '
                            f"accepts displacements on world brushes",
                            entity_id=int(ent.id),
                            brush_id=int(solid.id),
                        )
                    )
                    break

    for solid in vmf.brushes:
        for side in solid.sides:
            for axis_name in ("uaxis", "vaxis"):
                axis = getattr(side, axis_name, None)
                scale = getattr(axis, "scale", None)
                if scale is None:
                    continue
                if scale < MIN_TEXTURE_SCALE or scale > MAX_TEXTURE_SCALE:
                    findings.append(
                        _finding(
                            "error",
                            "bad-texture-scale",
                            f"brush {solid.id} side {side.id} has {axis_name} scale "
                            f"{scale}, outside [{MIN_TEXTURE_SCALE}, "
                            f"{MAX_TEXTURE_SCALE}]; vbsp reports this as "
                            f'"Bad surface extents"',
                            brush_id=int(solid.id),
                            side_id=int(side.id),
                            scale=scale,
                        )
                    )

            lightmap = getattr(side, "lightmap_scale", None)
            if (
                getattr(side, "disp_power", None)
                and lightmap is not None
                and lightmap < 8
            ):
                # A displacement is not auto-subdivided the way a brush face is: it goes
                # straight to 124x124 luxels, and a fine scale here is the usual reason a
                # vrad run stops being measured in minutes.
                findings.append(
                    _finding(
                        "warning",
                        "fine-lightmap-on-displacement",
                        f"displacement on brush {solid.id} has lightmap scale "
                        f"{lightmap}; displacements are not subdivided, so this "
                        f"multiplies vrad time",
                        brush_id=int(solid.id),
                        side_id=int(side.id),
                    )
                )

    return findings


def count_vmf(vmf: Any) -> dict[str, int]:
    """Counts what the compiler will have to fit under its ceilings."""
    entities = list(vmf.entities)
    brushes = list(vmf.brushes)
    sides = sum(len(s.sides) for s in brushes)
    displacements = sum(
        1 for s in brushes for side in s.sides if getattr(side, "disp_power", None)
    )
    solids_in_entities = sum(len(list(e.solids)) for e in entities)
    return {
        "entities": len(entities) + 1,  # worldspawn is not in vmf.entities
        "brushes": len(brushes) + solids_in_entities,
        "worldBrushes": len(brushes),
        "entityBrushes": solids_in_entities,
        "brushSides": sides,
        "displacements": displacements,
    }
