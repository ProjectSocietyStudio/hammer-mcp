/**
 * Several views on one sheet, because a tool result carries one image.
 *
 * `render_vmf_view` has existed since 12/08/2026 and, across three sessions in which cold
 * agents built the same map end to end, was called **once**. The builders worked from
 * coordinates and declared themselves done on numbers -- and the map that came out had a
 * door painted flat on a wall, counters that were single boxes and not one skirting board,
 * none of which any check could see and all of which one look showed instantly.
 *
 * The friction was never the renderer. It was that looking at a place costs one call per
 * camera, and every camera has to be worked out first. A sheet makes the whole place one
 * call, which is what a builder will actually spend.
 *
 * A contact sheet in the photographic sense: small frames, laid out in a grid, each with its
 * name under it. Not a montage -- the tiles are not meant to join up.
 */
import { CELL_HEIGHT, glyphPixels, textWidth } from "./font.js";
import type { Framebuffer } from "./raster.js";

/** One frame on the sheet, and what to call it. */
export interface Tile {
  label: string;
  frame: Framebuffer;
}

export interface Sheet {
  rgb: Uint8Array;
  width: number;
  height: number;
  columns: number;
  rows: number;
}

/** Height of the strip under each frame that carries its label. */
const CAPTION = CELL_HEIGHT + 6;
/** Gap between frames, and round the outside. */
const GUTTER = 6;

const PAPER: [number, number, number] = [24, 24, 28];
const INK: [number, number, number] = [232, 232, 236];

/**
 * Lays frames out in a grid, captioned.
 *
 * Every frame is assumed the same size, which is how the callers use it -- one camera
 * configuration, many positions. A ragged sheet would need a packing pass, and a packing
 * pass would be solving a problem nobody has.
 */
export function contactSheet(tiles: readonly Tile[], columns?: number): Sheet {
  if (tiles.length === 0) throw new Error("a contact sheet of no views is not a picture");

  const tw = tiles[0]!.frame.width;
  const th = tiles[0]!.frame.height;
  for (const t of tiles) {
    if (t.frame.width !== tw || t.frame.height !== th) {
      throw new Error(
        `every frame on a sheet has to be the same size; ${JSON.stringify(t.label)} is ` +
          `${t.frame.width}x${t.frame.height} where the first is ${tw}x${th}`,
      );
    }
  }

  // Squarish, so a sheet of three is 2x2 rather than 3x1 and a sheet of eight is 3x3. A
  // long strip is unreadable at any size a result should carry.
  const cols = columns ?? Math.min(tiles.length, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.ceil(tiles.length / cols);

  const width = GUTTER + cols * (tw + GUTTER);
  const height = GUTTER + rows * (th + CAPTION + GUTTER);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    rgb[i * 3] = PAPER[0];
    rgb[i * 3 + 1] = PAPER[1];
    rgb[i * 3 + 2] = PAPER[2];
  }

  const put = (x: number, y: number, c: readonly [number, number, number]): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = (y * width + x) * 3;
    rgb[at] = c[0]!;
    rgb[at + 1] = c[1]!;
    rgb[at + 2] = c[2]!;
  };

  tiles.forEach((tile, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x0 = GUTTER + col * (tw + GUTTER);
    const y0 = GUTTER + row * (th + CAPTION + GUTTER);

    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const from = (y * tw + x) * 3;
        put(x0 + x, y0 + y, [tile.frame.rgb[from]!, tile.frame.rgb[from + 1]!, tile.frame.rgb[from + 2]!]);
      }
    }

    // Centred under the frame, and clipped rather than scaled when it will not fit: a label
    // half off the edge still reads, and a label shrunk to fit does not.
    const scale = 1;
    const tx = x0 + Math.max(0, Math.round((tw - textWidth(tile.label, scale)) / 2));
    const baseline = y0 + th + CAPTION - 4;
    for (const [px, py] of glyphPixels(tile.label, tx, baseline, scale)) {
      if (px >= x0 && px < x0 + tw) put(px, py, INK);
    }
  });

  return { rgb, width, height, columns: cols, rows };
}
