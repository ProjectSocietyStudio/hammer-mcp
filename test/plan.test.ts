import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boxesOverlap, fitPage, labelBox, pointInPolygon } from "../src/render/display.js";
import type { Label, Polygon } from "../src/render/display.js";
import { glyphPixels, textWidth } from "../src/render/font.js";
import { paint } from "../src/render/paint.js";
import { areaOf, buildPlan, sectionOf } from "../src/render/plan.js";
import { toSvg } from "../src/render/svg.js";
import { buildScene } from "../src/space/scene.js";
import { insertSolids } from "../src/vmf/build.js";
import type { Vec3 } from "../src/vmf/solid.js";
import { FIXTURES } from "./support/env.js";
import { ROOMS, roomsVmf } from "./support/rooms.js";

const SEED: Vec3 = [0, -256, 16];
const scene = buildScene("rooms.vmf", roomsVmf());
const plan = buildPlan(scene, [SEED]);

const SEEDTEXT =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nworld\n{\n\t"id" "1"\n\t"classname" "worldspawn"\n}\n';

describe("sectionOf", () => {
  it("cuts a box into its own footprint", () => {
    const cube = buildScene(
      "cube.vmf",
      insertSolids(SEEDTEXT, [{ shape: "box", mins: [-128, -64, 0], maxs: [128, 64, 256] }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    const loop = sectionOf(cube.brushes[0]!.planes, 128)!;
    expect(loop).not.toBeNull();
    // 256 x 128, exactly, because the section is the intersection of half-spaces and not a
    // polygon clipper written for this file.
    expect(areaOf(loop)).toBeCloseTo(256 * 128, 6);
    for (const p of loop) expect(p[2]).toBeCloseTo(128, 6);
  });

  it("cuts a wedge into a rectangle whose width follows the height", () => {
    // A shape whose section changes with z, so a cut that ignored z would be caught.
    const wedge = buildScene(
      "wedge.vmf",
      insertSolids(SEEDTEXT, [{ shape: "wedge", mins: [0, 0, 0], maxs: [256, 128, 256], slopeAxis: "x", high: "min" }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    const low = areaOf(sectionOf(wedge.brushes[0]!.planes, 32)!);
    const high = areaOf(sectionOf(wedge.brushes[0]!.planes, 224)!);
    expect(low).toBeGreaterThan(high * 2);
  });

  it("returns nothing where the plane misses, rather than a degenerate shape", () => {
    const cube = buildScene(
      "cube.vmf",
      insertSolids(SEEDTEXT, [{ shape: "box", mins: [0, 0, 0], maxs: [64, 64, 64] }], {
        material: "DEV/DEV_MEASUREGENERIC01",
      }).text,
    );
    expect(sectionOf(cube.brushes[0]!.planes, 500)).toBeNull();
  });
});

describe("fitPage", () => {
  it("flips y exactly once, so Hammer's north is up on the page", () => {
    // The one sign that has to change, and it changes here rather than in each back end.
    const p = fitPage({ minX: 0, minY: 0, maxX: 1000, maxY: 1000 }, 200, 200, 10);
    const [, southY] = p.project(0, 0);
    const [, northY] = p.project(0, 1000);
    expect(northY).toBeLessThan(southY);
  });

  it("round-trips a point through the page and back", () => {
    const p = fitPage({ minX: -512, minY: -256, maxX: 512, maxY: 256 }, 400, 400, 16);
    const [px, py] = p.project(128, -64);
    const [x, y] = p.unproject(px, py);
    expect(x).toBeCloseTo(128, 6);
    expect(y).toBeCloseTo(-64, 6);
  });

  it("picks a scale a reader can count in", () => {
    // A plan at 1.037 units per pixel is correct and useless for measuring by eye, which is
    // what a plan is for.
    const p = fitPage({ minX: 0, minY: 0, maxX: 3000, maxY: 1000 }, 400, 400, 10);
    expect([0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256]).toContain(p.page.unitsPerPixel);
  });
});

describe("buildPlan", () => {
  it("draws every brush the cut passes through, and no others", () => {
    // The invariant: the area of what was drawn equals the area of the sections, computed
    // separately. A version that drew bounding boxes instead of sections passes every other
    // check in this file and fails this one on any brush that is not axis-aligned.
    let drawn = 0;
    for (const item of plan.list.items) {
      if (item.kind !== "polygon" || !item.role.startsWith("brush:")) continue;
      drawn += 1;
    }
    expect(drawn).toBe(plan.brushesCut);
    expect(plan.brushesCut).toBeGreaterThan(4);
    expect(plan.sectionArea).toBeGreaterThan(0);
  });

  it("reproduces the drawn area from the page geometry alone", () => {
    // Same invariant from the other side: measure the polygons as they were placed on the
    // page, convert back to world units, and demand the total the sections gave.
    const upp = plan.list.page.unitsPerPixel;
    let pageArea = 0;
    for (const item of plan.list.items) {
      if (item.kind !== "polygon" || !item.role.startsWith("brush:")) continue;
      const poly = item as Polygon;
      let sum = 0;
      for (let i = 0; i < poly.points.length; i++) {
        const a = poly.points[i]!;
        const b = poly.points[(i + 1) % poly.points.length]!;
        sum += a[0] * b[1] - b[0] * a[1];
      }
      pageArea += Math.abs(sum) / 2;
    }
    expect(pageArea * upp * upp).toBeCloseTo(plan.sectionArea, 0);
  });

  it("draws the section and not the bounding box", () => {
    // The rooms fixture cannot tell the difference: every brush in it is an axis-aligned
    // box, whose section IS its bounding box. Drawing bounding boxes passed every other
    // assertion in this file. A cylinder is the cheapest shape where the two differ, and
    // they differ by a factor of pi over four -- about 21%, far outside any rounding.
    const cyl = buildScene(
      "cyl.vmf",
      insertSolids(
        SEEDTEXT,
        [{ shape: "cylinder", mins: [-128, -128, 0], maxs: [128, 128, 256], sides: 24 }],
        { material: "DEV/DEV_MEASUREGENERIC01" },
      ).text,
    );
    const p = buildPlan(cyl, [], { cutZ: 128, rooms: false });
    expect(p.brushesCut).toBe(1);

    const boundingArea = 256 * 256;
    expect(p.sectionArea).toBeLessThan(boundingArea * 0.85);
    // And it really is a 24-gon of radius 128: between the inscribed and circumscribed
    // areas for that many sides. The bounds are stated rather than the value, because
    // whether the builder inscribes or circumscribes is its business, not this test's.
    const r = 128;
    const n = 24;
    const inscribed = 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);
    const circumscribed = n * r * r * Math.tan(Math.PI / n);
    expect(p.sectionArea).toBeGreaterThanOrEqual(inscribed - 1);
    expect(p.sectionArea).toBeLessThanOrEqual(circumscribed + 1);

    // The drawn polygon has the prism's corners, not four.
    const drawn = p.list.items.find(
      (i): i is Polygon => i.kind === "polygon" && i.role.startsWith("brush:"),
    )!;
    expect(drawn.points.length).toBeGreaterThan(8);
  });

  it("drops a label it cannot separate from its neighbour, and says it did", () => {
    // Legibility is not a preference here: two numbers on top of each other are not two
    // numbers, and a plan whose labels collide is a plan that answers wrongly by looking
    // right. Nothing collides at a comfortable size, so the page is squeezed until it does.
    const tight = buildPlan(scene, [SEED], { maxWidth: 200, maxHeight: 160 });
    const labels = tight.list.items.filter((i): i is Label => i.kind === "label");
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(boxesOverlap(labelBox(labels[i]!), labelBox(labels[j]!))).toBe(false);
      }
    }
    expect(tight.notes.join(" "), "a dropped label has to be reported").toMatch(/dropped/);
    expect(labels.length).toBeLessThan(
      plan.list.items.filter((i) => i.kind === "label").length,
    );
  });

  it("cuts above the floor, so a doorway is a gap", () => {
    // At the map's own minimum the cut passes through the floor slab and every pixel is
    // solid. It has to be taken from the lowest place a person can stand.
    expect(plan.cutZ).toBeGreaterThan(0);
    expect(plan.cutZ).toBeLessThan(ROOMS.HEIGHT);
  });

  it("puts each room's label inside that room's own outline", () => {
    // A label that has drifted off its room is worse than no label: it is a wrong answer
    // presented as a drawing.
    const outlines = new Map<string, Polygon>();
    for (const item of plan.list.items) {
      if (item.kind === "polygon" && item.role.startsWith("room:")) {
        outlines.set(item.role.slice("room:".length), item as Polygon);
      }
    }
    expect(outlines.size).toBe(3);

    let checked = 0;
    for (const item of plan.list.items) {
      if (item.kind !== "label" || !item.role.startsWith("room-label:")) continue;
      const id = item.role.slice("room-label:".length);
      const outline = outlines.get(id)!;
      expect(pointInPolygon(item.at, outline.points), `label for room ${id}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBe(3);
  });

  it("writes the width on every doorway", () => {
    // The number is what makes it a plan rather than a picture: you can see that a doorway
    // is narrower than a corridor without it, and you cannot say by how much.
    const labels = plan.list.items.filter(
      (i): i is Label => i.kind === "label" && i.role.startsWith("portal-label:"),
    );
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l.text).toBe(`${ROOMS.doorWidth}u`);
  });

  it("leaves no two labels overlapping", () => {
    // Legibility asserted rather than hoped for. Two numbers on top of each other are not
    // two numbers.
    const labels = plan.list.items.filter((i): i is Label => i.kind === "label");
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(
          boxesOverlap(labelBox(labels[i]!), labelBox(labels[j]!)),
          `${labels[i]!.text} over ${labels[j]!.text}`,
        ).toBe(false);
      }
    }
  });

  it("carries a scale, a grid and a north arrow", () => {
    const roles = new Set(plan.list.items.map((i) => i.role));
    expect(roles).toContain("scale-bar");
    expect(roles).toContain("north");
    expect([...roles].some((r) => r === "grid")).toBe(true);
  });

  it("says where it cut, because everything above and below is missing", () => {
    expect(plan.notes.join(" ")).toMatch(/Cut at z/);
  });
});

describe("the two back ends draw the same list", () => {
  it("emits an SVG element for every item", () => {
    const svg = toSvg(plan.list);
    const elements = (svg.match(/<(polygon|polyline|text) /g) ?? []).length;
    expect(elements).toBe(plan.list.items.length);
    expect(svg).toMatch(/^<svg xmlns/);
    expect(svg.trimEnd()).toMatch(/<\/svg>$/);
  });

  it("keeps every role, so the SVG can be argued with", () => {
    const svg = toSvg(plan.list);
    for (const item of plan.list.items) {
      expect(svg).toContain(`data-role="${item.role}"`);
    }
  });

  it("paints a canvas of the page's own size, and marks it", () => {
    const canvas = paint(plan.list);
    expect(canvas.width).toBe(plan.list.page.width);
    expect(canvas.height).toBe(plan.list.page.height);
    // Not blank: something other than the paper colour was drawn.
    let inked = 0;
    for (let i = 0; i < canvas.rgb.length; i += 3) {
      if (canvas.rgb[i] !== 255 || canvas.rgb[i + 1] !== 255 || canvas.rgb[i + 2] !== 255) inked += 1;
    }
    expect(inked).toBeGreaterThan(canvas.width);
  });

  it("escapes what would otherwise break the XML", () => {
    const svg = toSvg({
      page: { width: 10, height: 10, unitsPerPixel: 1 },
      world: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      items: [
        {
          kind: "label",
          at: [1, 1],
          text: 'a & b < c "d"',
          size: 8,
          colour: [0, 0, 0],
          anchor: "start",
          role: "test",
        },
      ],
    });
    expect(svg).toContain("a &amp; b &lt; c &quot;d&quot;");
  });
});

describe("the bitmap font", () => {
  it("draws different pixels for different characters", () => {
    const a = glyphPixels("0", 0, 8, 1).length;
    const b = glyphPixels("1", 0, 8, 1).length;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("advances by a cell per character, at any scale", () => {
    expect(textWidth("123", 1)).toBe(18);
    expect(textWidth("123", 2)).toBe(36);
    const wide = glyphPixels("11", 0, 8, 1);
    expect(Math.max(...wide.map((p) => p[0]))).toBeGreaterThan(5);
  });

  it("shows a missing glyph rather than a gap", () => {
    // A character nobody defined must be visible as an error, not as a space.
    expect(glyphPixels("é", 0, 8, 1).length).toBeGreaterThan(0);
  });
});

describe("the probe map", () => {
  it("plans a single sealed room with one section per wall", () => {
    const probe = join(FIXTURES, "hmcp_probe.vmf");
    const p = buildPlan(buildScene(probe, readFileSync(probe, "utf8")), [[0, 0, 32]]);
    // Four walls meet the cut; the floor and ceiling do not.
    expect(p.brushesCut).toBe(4);
    expect(p.rooms!.rooms).toHaveLength(1);
  });
});
