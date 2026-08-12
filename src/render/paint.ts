/**
 * A display list as pixels.
 *
 * The other back end. Same list, same coordinates, same colours -- only the ink differs. A
 * 2D filler rather than the perspective rasteriser's: there is no depth here, and a scanline
 * over a page-space polygon needs neither a z-buffer nor a near plane.
 *
 * Polygons here are **not** guaranteed convex: a brush's section is, but nothing says a
 * future item will be, so the crossing rule is the general even-odd one rather than the
 * convex shortcut `raster.ts` can afford.
 */
import { glyphPixels } from "./font.js";
import type { DisplayList, Item, Rgb } from "./display.js";

export interface Canvas {
  width: number;
  height: number;
  rgb: Uint8Array;
}

const put = (c: Canvas, x: number, y: number, colour: Rgb): void => {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const at = (y * c.width + x) * 3;
  c.rgb[at] = colour[0];
  c.rgb[at + 1] = colour[1];
  c.rgb[at + 2] = colour[2];
};

/** Bresenham, so a line of any slope is one pixel thick and has no gaps. */
function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, colour: Rgb, width: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const ex = Math.round(x1);
  const ey = Math.round(y1);
  const dx = Math.abs(ex - x);
  const dy = -Math.abs(ey - y);
  const sx = x < ex ? 1 : -1;
  const sy = y < ey ? 1 : -1;
  let err = dx + dy;
  const half = Math.floor(width / 2);
  for (;;) {
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) put(c, x + ox, y + oy, colour);
    }
    if (x === ex && y === ey) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function fillPolygon(c: Canvas, points: Array<[number, number]>, colour: Rgb, hatch: boolean): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of points) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.ceil(minY - 0.5));
  const y1 = Math.min(c.height - 1, Math.floor(maxY - 0.5));

  for (let y = y0; y <= y1; y++) {
    const scan = y + 0.5;
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a[1] === b[1]) continue;
      if (scan < Math.min(a[1], b[1]) || scan >= Math.max(a[1], b[1])) continue;
      crossings.push(a[0] + ((scan - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.max(0, Math.ceil(crossings[i]! - 0.5));
      const to = Math.min(c.width - 1, Math.floor(crossings[i + 1]! - 0.5));
      for (let x = from; x <= to; x++) {
        // Hatching is drawn rather than declared, so the raster and the SVG agree about
        // which shapes are see-through even though only one of them has a pattern fill.
        if (hatch && (x + y) % 6 !== 0) continue;
        put(c, x, y, colour);
      }
    }
  }
}

export function paint(list: DisplayList): Canvas {
  const canvas: Canvas = {
    width: list.page.width,
    height: list.page.height,
    rgb: new Uint8Array(list.page.width * list.page.height * 3).fill(255),
  };

  for (const item of list.items as Item[]) {
    if (item.kind === "polygon") {
      if (item.fill || item.hatch) {
        fillPolygon(canvas, item.points, item.hatch ? [96, 100, 112] : item.fill!, !!item.hatch);
      }
      if (item.stroke) {
        for (let i = 0; i < item.points.length; i++) {
          const a = item.points[i]!;
          const b = item.points[(i + 1) % item.points.length]!;
          line(canvas, a[0], a[1], b[0], b[1], item.stroke, item.strokeWidth);
        }
      }
    } else if (item.kind === "polyline") {
      for (let i = 0; i + 1 < item.points.length; i++) {
        const a = item.points[i]!;
        const b = item.points[i + 1]!;
        line(canvas, a[0], a[1], b[0], b[1], item.stroke, item.strokeWidth);
      }
    } else {
      const scale = Math.max(1, Math.round(item.size / 8));
      const width = item.text.length * 6 * scale;
      const x =
        item.anchor === "start"
          ? item.at[0]
          : item.anchor === "end"
            ? item.at[0] - width
            : item.at[0] - width / 2;
      for (const [px, py] of glyphPixels(item.text, x, item.at[1], scale)) {
        put(canvas, px, py, item.colour);
      }
    }
  }

  return canvas;
}
