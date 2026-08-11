"""Displacements as srctools reads them, so ours can be checked against something else.

The TypeScript reader and this one disagree about nothing except who wrote them. That is
the whole point: a format with five arrays whose lengths are all off by one from each
other is a format where one implementation agreeing with itself proves very little.

srctools refuses more than we do -- a power outside 0..4, an allowed_verts that is not ten
long -- so a fixture it accepts is a fixture Hammer would.
"""

from __future__ import annotations

from typing import Any


def vmf_displacements(req: dict[str, Any]) -> dict[str, Any]:
    from srctools import Keyvalues
    from srctools.vmf import VMF

    path = req["path"]
    with open(path, encoding="utf8") as fh:
        vmf = VMF.parse(Keyvalues.parse(fh))

    out: list[dict[str, Any]] = []
    for solid in vmf.brushes:
        for index, side in enumerate(solid.sides):
            if not side.is_disp:
                continue
            # `_disp_verts` is private, and there is no public alternative: srctools 2.7.0
            # exposes `is_disp`, `disp_size` and `disp_get_tri_verts` and nothing that hands
            # back the grid. Reaching into it is the price of having an oracle at all, and
            # the pin in requirements.txt is what makes that safe to do.
            verts = list(side._disp_verts or [])  # noqa: SLF001
            out.append(
                {
                    "solidId": solid.id,
                    "sideIndex": index,
                    "power": side.disp_power,
                    "size": side.disp_size,
                    "vertexCount": len(verts),
                    "startPosition": [
                        round(side.disp_pos.x, 4),
                        round(side.disp_pos.y, 4),
                        round(side.disp_pos.z, 4),
                    ],
                    "elevation": side.disp_elevation,
                    "minDistance": min((v.distance for v in verts), default=0.0),
                    "maxDistance": max((v.distance for v in verts), default=0.0),
                    "minAlpha": min((v.alpha for v in verts), default=0.0),
                    "maxAlpha": max((v.alpha for v in verts), default=0.0),
                }
            )

    return {"path": path, "displacements": out, "count": len(out)}
