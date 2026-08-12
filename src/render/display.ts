/**
 * A drawing, described once and drawn twice.
 *
 * A plan is wanted in three forms and they pull in different directions: the model has to
 * **look** at it, so a raster; a test has to **assert** on it, so numbers; and a person may
 * want to keep or edit it, so text. Producing three drawings would mean three chances to
 * disagree, and the one nobody looks at would be the one the tests check.
 *
 * So there is one display list -- polygons, lines and labels in page coordinates -- and two
 * back ends that consume it. `svg.ts` turns it into text; `raster.ts`'s filler turns it into
 * pixels. The tests assert on the list itself, which is the only one of the three where "the
 * label for room 2 is inside room 2's outline" is a statement about numbers rather than
 * about ink.
 *
 * ## Page coordinates, and the flip that has to happen exactly once
 *
 * Hammer's +y points **north** on its 2D grid; every raster format on earth counts rows from
 * the top. So somewhere a sign has to change, and if it changes in both back ends they will
 * eventually change differently. It changes here, in `project`, and both back ends consume
 * page coordinates where y already runs downward.
 */
export interface Page {
  width: number;
  height: number;
  /** Units per pixel. A plan without this is a picture, not a plan. */
  unitsPerPixel: number;
}

export type Rgb = [number, number, number];

export interface Polygon {
  kind: "polygon";
  points: Array<[number, number]>;
  fill: Rgb | null;
  stroke: Rgb | null;
  strokeWidth: number;
  /** What this shape is, for tests and for anyone reading the SVG. */
  role: string;
  /** Diagonal hatching instead of a solid fill: glass, and anything else see-through. */
  hatch?: boolean;
}

export interface Polyline {
  kind: "polyline";
  points: Array<[number, number]>;
  stroke: Rgb;
  strokeWidth: number;
  dashed?: boolean;
  role: string;
}

export interface Label {
  kind: "label";
  at: [number, number];
  text: string;
  /** Cap height in pixels. The bitmap font renders one size; SVG honours it. */
  size: number;
  colour: Rgb;
  anchor: "start" | "middle" | "end";
  role: string;
}

export type Item = Polygon | Polyline | Label;

export interface DisplayList {
  page: Page;
  items: Item[];
  /** World bounds the page covers, for anyone mapping a point back. */
  world: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface Projection {
  /** World to page. */
  project: (x: number, y: number) => [number, number];
  /** Page back to world, for reading a coordinate off a plan. */
  unproject: (px: number, py: number) => [number, number];
  page: Page;
  world: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Fits world bounds onto a page of at most `maxWidth` x `maxHeight`, preserving aspect.
 *
 * The scale is then rounded **up** to a whole number of units per pixel where it can be, so
 * a plan's scale bar is a round number and a reader can count squares. A 1.037-units-per-pixel
 * plan is correct and unusable for measuring by eye, which is what a plan is for.
 */
export function fitPage(
  world: { minX: number; minY: number; maxX: number; maxY: number },
  maxWidth: number,
  maxHeight: number,
  margin: number,
): Projection {
  const spanX = Math.max(1, world.maxX - world.minX);
  const spanY = Math.max(1, world.maxY - world.minY);
  const usableW = Math.max(1, maxWidth - margin * 2);
  const usableH = Math.max(1, maxHeight - margin * 2);

  const raw = Math.max(spanX / usableW, spanY / usableH);
  // Round up to the next value in a ladder of legible scales, so the grid is countable.
  const LADDER = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];
  const unitsPerPixel = LADDER.find((v) => v >= raw) ?? Math.ceil(raw);

  const width = Math.min(maxWidth, Math.ceil(spanX / unitsPerPixel) + margin * 2);
  const height = Math.min(maxHeight, Math.ceil(spanY / unitsPerPixel) + margin * 2);
  const page: Page = { width, height, unitsPerPixel };

  // The flip lives here, once: Hammer's +y is north, a page's +y is down.
  const project = (x: number, y: number): [number, number] => [
    margin + (x - world.minX) / unitsPerPixel,
    height - margin - (y - world.minY) / unitsPerPixel,
  ];
  const unproject = (px: number, py: number): [number, number] => [
    world.minX + (px - margin) * unitsPerPixel,
    world.minY + (height - margin - py) * unitsPerPixel,
  ];

  return { project, unproject, page, world };
}

/** Axis-aligned bounds of an item, for the overlap checks a legible plan needs. */
export function labelBox(label: Label): { x0: number; y0: number; x1: number; y1: number } {
  // The bitmap font is 5x7 on a 6x8 cell, so a glyph advances 6/8 of the cap height.
  const advance = (label.size * 6) / 8;
  const w = label.text.length * advance;
  const x0 =
    label.anchor === "start" ? label.at[0] : label.anchor === "end" ? label.at[0] - w : label.at[0] - w / 2;
  return { x0, y0: label.at[1] - label.size, x1: x0 + w, y1: label.at[1] };
}

export function boxesOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
}

/** Signed area, doubled, in page units. Used to check a drawn shape against its own maths. */
export function shoelace(points: ReadonlyArray<readonly [number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

/** True when a point is inside a convex polygon given in page coordinates. */
export function pointInPolygon(
  point: readonly [number, number],
  poly: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    const crosses = a[1] > point[1] !== b[1] > point[1];
    if (!crosses) continue;
    const at = ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (point[0] < at) inside = !inside;
  }
  return inside;
}
