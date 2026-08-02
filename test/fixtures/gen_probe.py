#!/usr/bin/env python3
"""Generate hmcp_probe.vmf — a sealed room, one spawn, one light.

Gate A2 probe for hammer-mcp: the smallest map that vbsp/vvis/vrad will accept
and that srcds will boot. Kept as a script rather than a literal so the wall
thickness and room size stay legible.
"""
import sys

MAT = "DEV/DEV_MEASUREGENERIC01"
_id = [0]


def nid():
    _id[0] += 1
    return _id[0]


def side(plane, u, v):
    return f"""		side
		{{
			"id" "{nid()}"
			"plane" "{plane}"
			"material" "{MAT}"
			"uaxis" "{u} 0.25"
			"vaxis" "{v} 0.25"
			"rotation" "0"
			"lightmapscale" "16"
			"smoothing_groups" "0"
		}}
"""


def box(mn, mx):
    """Axis-aligned brush from mins/maxs, sides wound so normals point out."""
    x0, y0, z0 = mn
    x1, y1, z1 = mx
    p = lambda a, b, c: f"({a[0]} {a[1]} {a[2]}) ({b[0]} {b[1]} {b[2]}) ({c[0]} {c[1]} {c[2]})"
    sides = [
        # +z
        (p((x0, y1, z1), (x1, y1, z1), (x1, y0, z1)), "[1 0 0 0]", "[0 -1 0 0]"),
        # -z
        (p((x0, y0, z0), (x1, y0, z0), (x1, y1, z0)), "[1 0 0 0]", "[0 -1 0 0]"),
        # -y
        (p((x0, y0, z1), (x1, y0, z1), (x1, y0, z0)), "[1 0 0 0]", "[0 0 -1 0]"),
        # +y
        (p((x1, y1, z1), (x0, y1, z1), (x0, y1, z0)), "[1 0 0 0]", "[0 0 -1 0]"),
        # -x
        (p((x0, y1, z1), (x0, y0, z1), (x0, y0, z0)), "[0 1 0 0]", "[0 0 -1 0]"),
        # +x
        (p((x1, y0, z1), (x1, y1, z1), (x1, y1, z0)), "[0 1 0 0]", "[0 0 -1 0]"),
    ]
    body = "".join(side(pl, u, v) for pl, u, v in sides)
    return f"""	solid
	{{
		"id" "{nid()}"
{body}	}}
"""


T = 32          # wall thickness
R = 256         # interior half-extent (x/y) and height
O = R + T       # outer half-extent

BRUSHES = [
    ((-O, -O, -T), (O, O, 0)),        # floor
    ((-O, -O, R), (O, O, R + T)),     # ceiling
    ((-O, -O, 0), (-R, O, R)),        # -x wall
    ((R, -O, 0), (O, O, R)),          # +x wall
    ((-R, -O, 0), (R, -R, R)),        # -y wall
    ((-R, R, 0), (R, O, R)),          # +y wall
]


def entity(classname, origin, extra=None):
    kv = "".join(f'\t"{k}" "{v}"\n' for k, v in (extra or {}).items())
    return f"""entity
{{
	"id" "{nid()}"
	"classname" "{classname}"
{kv}	"origin" "{origin}"
}}
"""


def main(path):
    solids = "".join(box(mn, mx) for mn, mx in BRUSHES)
    vmf = f"""versioninfo
{{
	"editorversion" "400"
	"editorbuild" "5004"
	"mapversion" "1"
	"formatversion" "100"
	"prefab" "0"
}}
visgroups
{{
}}
viewsettings
{{
	"bSnapToGrid" "1"
	"bShowGrid" "1"
	"bShowLogicalGrid" "0"
	"nGridSpacing" "64"
	"bShow3DGrid" "0"
}}
world
{{
	"id" "1"
	"mapversion" "1"
	"classname" "worldspawn"
	"detailmaterial" "detail/detailsprites"
	"detailvbsp" "detail.vbsp"
	"maxpropscreenwidth" "-1"
	"skyname" "sky_day01_01"
{solids}}}
{entity("info_player_start", "0 0 16")}{entity("light", "0 0 192", {"_light": "255 255 255 400"})}{entity("info_target", "0 0 64", {"targetname": "hmcp_probe"})}cameras
{{
	"activecamera" "-1"
}}
"""
    with open(path, "w") as f:
        f.write(vmf)
    print(f"{path}: {len(vmf)} bytes, {vmf.count('solid')} solids")


if __name__ == "__main__":
    main(sys.argv[1])
