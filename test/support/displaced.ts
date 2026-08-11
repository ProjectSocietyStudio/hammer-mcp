/**
 * A `.vmf` with real displacements on it.
 *
 * There is not one on this machine to borrow: no map in the Garry's Mod tree carries a
 * `dispinfo`, and neither fixture in this repository ever has. So it is written here, and
 * the oracle is srctools -- an implementation of the same format that is not ours, and
 * that refuses a great many things about it.
 *
 * Two brushes side by side, each with a displacement on its top face, sharing the edge at
 * x = 256. That is the arrangement every terrain in Source is made of, and the only one in
 * which a seam can exist to be found.
 */
import { insertSolids } from "../../src/vmf/build.js";

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n}\n';

export interface DispShape {
  power: number;
  /** Corner of the face the grid starts from, as Hammer writes it. */
  startPosition: [number, number, number];
  /**
   * How far each vertex is pushed along its normal.
   *
   * Given (x, y) in grid coordinates, so a test can state a shape rather than a table of
   * numbers -- a ridge, a slope, a flat sheet.
   */
  height: (x: number, y: number, size: number) => number;
  /** 0 to 255 per vertex. Absent means unpainted. */
  alpha?: (x: number, y: number, size: number) => number;
}

/** Writes one `dispinfo` block, indented to sit inside a `side`. */
export function dispInfo(shape: DispShape): string {
  const size = 2 ** shape.power + 1;
  const rows = (
    name: string,
    perVertex: number,
    value: (x: number, y: number) => number[],
  ): string => {
    const body: string[] = [];
    for (let y = 0; y < size; y += 1) {
      const row: number[] = [];
      for (let x = 0; x < size; x += 1) row.push(...value(x, y));
      if (row.length !== size * perVertex) throw new Error(`${name} row ${y} is the wrong length`);
      body.push(`\t\t\t\t"row${y}" "${row.join(" ")}"`);
    }
    return `\t\t\t${name}\n\t\t\t{\n${body.join("\n")}\n\t\t\t}\n`;
  };

  // Tags describe quads, so there is one fewer row and column than there are vertices.
  const tagRows: string[] = [];
  for (let y = 0; y < 2 ** shape.power; y += 1) {
    tagRows.push(`\t\t\t\t"row${y}" "${new Array(2 * 2 ** shape.power).fill(9).join(" ")}"`);
  }

  return (
    `\t\t\tdispinfo\n\t\t\t{\n` +
    `\t\t\t\t"power" "${shape.power}"\n` +
    `\t\t\t\t"startposition" "[${shape.startPosition.join(" ")}]"\n` +
    `\t\t\t\t"flags" "0"\n` +
    `\t\t\t\t"elevation" "0"\n` +
    `\t\t\t\t"subdiv" "0"\n` +
    rows("normals", 3, () => [0, 0, 1]) +
    rows("distances", 1, (x, y) => [shape.height(x, y, size)]) +
    rows("offsets", 3, () => [0, 0, 0]) +
    rows("offset_normals", 3, () => [0, 0, 1]) +
    rows("alphas", 1, (x, y) => [shape.alpha ? shape.alpha(x, y, size) : 0]) +
    `\t\t\ttriangle_tags\n\t\t\t{\n${tagRows.join("\n")}\n\t\t\t}\n` +
    `\t\t\tallowed_verts\n\t\t\t{\n\t\t\t\t"10" "-1 -1 -1 -1 -1 -1 -1 -1 -1 -1"\n\t\t\t}\n` +
    `\t\t\t}\n`
  );
}

/** Puts a `dispinfo` on the upward face of the solid with this id. */
function displaceTopFace(text: string, solidId: number, shape: DispShape): string {
  const solidStart = text.indexOf(`"id" "${solidId}"`);
  if (solidStart < 0) throw new Error(`no solid ${solidId}`);
  // The +z face is the one whose plane's three points all share the highest z. Found by
  // text rather than by parsing, because this is a fixture and the parser is under test.
  const upward = text.indexOf('"vaxis" "[0 -1 0 0]', solidStart);
  if (upward < 0) throw new Error("no upward face found");
  const closeBrace = text.indexOf("\n\t\t}", upward);
  if (closeBrace < 0) throw new Error("unterminated side");
  return `${text.slice(0, closeBrace + 1)}${dispInfo(shape)}${text.slice(closeBrace + 1)}`;
}

/** A flat sheet: every vertex on the face, nothing moved. */
export const FLAT: DispShape = {
  power: 2,
  startPosition: [0, 0, 64],
  height: () => 0,
};

/** A ridge running along y, highest in the middle and back to zero at both edges. */
export const RIDGE: DispShape = {
  power: 2,
  startPosition: [0, 0, 64],
  height: (x, _y, size) => 64 * (1 - Math.abs(x - (size - 1) / 2) / ((size - 1) / 2)),
};

/**
 * A slope rising with x, so the edge it shares with its neighbour is lifted.
 *
 * The ridge cannot make a seam: it is zero at both edges, which is exactly where a
 * neighbour meets it. A shape that is only interesting in the middle tests nothing about
 * the join, and the first version of the seam test used one and found nothing.
 */
export const SLOPE: DispShape = {
  power: 2,
  startPosition: [0, 0, 64],
  height: (x, _y, size) => (64 * x) / (size - 1),
};

/**
 * Two brushes side by side, each with the displacement it was given.
 *
 * A builder rather than a regex over the finished text: `dispinfo` contains six nested
 * blocks, so "replace up to the next closing brace" stops inside `normals` and leaves the
 * file unbalanced. A test that has to do surgery on a fixture is a test with a second
 * thing that can be wrong.
 */
export function displacedMap(west: DispShape, east: DispShape): {
  text: string;
  west: number;
  east: number;
} {
  const first = insertSolids(SEED, [{ shape: "box", mins: [0, 0, 0], maxs: [256, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  const second = insertSolids(first.text, [{ shape: "box", mins: [256, 0, 0], maxs: [512, 256, 64] }], {
    material: "NATURE/BLENDGRASSGRAVEL001A",
  });
  const westId = first.solidIds[0]!;
  const eastId = second.solidIds[0]!;
  let text = displaceTopFace(second.text, westId, west);
  text = displaceTopFace(text, eastId, east);
  return { text, west: westId, east: eastId };
}

const built = displacedMap(
  { ...FLAT, startPosition: [0, 0, 64] },
  { ...FLAT, startPosition: [256, 0, 64] },
);

/** Two brushes with a flat displacement each, meeting at x = 256. */
export const DISPLACED_VMF = built.text;
export const DISP_WEST = built.west;
export const DISP_EAST = built.east;
