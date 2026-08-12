/**
 * A display list as SVG.
 *
 * The text form of the same drawing the raster back end paints. It exists because a plan is
 * something a person may want to keep, diff or open in an editor, and because a `<text>`
 * element carries the label as characters rather than as pixels a reader has to squint at.
 *
 * Nothing here decides anything: every coordinate, colour and string is already in the list.
 * That is the point of the split -- two back ends that both decide would eventually decide
 * differently, and the plan nobody looked at would be the one under test.
 */
import type { DisplayList, Item, Rgb } from "./display.js";

const hex = (c: Rgb): string =>
  `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** XML text escaping. A material name can contain an ampersand and usually does not. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const round = (n: number): string => (Math.round(n * 100) / 100).toString();

function renderItem(item: Item): string {
  if (item.kind === "polygon") {
    const points = item.points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
    const fill = item.hatch ? 'url(#hatch)' : item.fill ? hex(item.fill) : "none";
    const stroke = item.stroke ? hex(item.stroke) : "none";
    return (
      `<polygon data-role="${esc(item.role)}" points="${points}" fill="${fill}" ` +
      `stroke="${stroke}" stroke-width="${item.strokeWidth}" />`
    );
  }
  if (item.kind === "polyline") {
    const points = item.points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
    const dash = item.dashed ? ' stroke-dasharray="4 3"' : "";
    return (
      `<polyline data-role="${esc(item.role)}" points="${points}" fill="none" ` +
      `stroke="${hex(item.stroke)}" stroke-width="${item.strokeWidth}"${dash} />`
    );
  }
  const anchor = item.anchor === "start" ? "start" : item.anchor === "end" ? "end" : "middle";
  return (
    `<text data-role="${esc(item.role)}" x="${round(item.at[0])}" y="${round(item.at[1])}" ` +
    `font-family="monospace" font-size="${item.size}" fill="${hex(item.colour)}" ` +
    `text-anchor="${anchor}">${esc(item.text)}</text>`
  );
}

export function toSvg(list: DisplayList): string {
  const { width, height } = list.page;
  const body = list.items.map(renderItem).join("\n  ");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">\n` +
    `  <defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" ` +
    `patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#556" ` +
    `stroke-width="1"/></pattern></defs>\n  ${body}\n</svg>\n`
  );
}
