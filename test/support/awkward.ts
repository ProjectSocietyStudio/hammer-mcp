/**
 * A `.vmf` that is legal and that Hammer would never write.
 *
 * Every fault Codex found in this repository's write path over three rounds of review was
 * the same shape: a check or a cut written for the file Hammer happens to produce, applied
 * to one it does not. The tests could not catch any of them, because they all ran against
 * `hmcp_probe.vmf` -- machine-generated, canonical, one block per line, every side id'd.
 * That is precisely the shape in which none of those faults can show.
 *
 * So this is the other shape, on purpose. Three things about it are hostile, and each of
 * them broke something real:
 *
 * **The whole map is on one line.** Cutting a block "from the previous newline to the next"
 * removed the world along with the brush. Fixed in `lineRange`.
 *
 * **Keys share lines.** Removing a keyvalue the same naive way took whatever key sat beside
 * it, and the geometry check downstream saw nothing wrong because the geometry was fine.
 * Fixed in `pairRange`, which had to be written four times before it was written once.
 *
 * **No side carries an id.** A side block is then matched to what the reader measured by
 * its plane, and matching on distance alone gave all four walls of an origin-centred box
 * the same answer. Which is why one of the two brushes here is centred on the origin.
 *
 * **The geometry comes from the writer, not from hand.** A first version of this file wrote
 * the planes and texture axes out by hand and got both wrong -- inverted winding, and one
 * axis pair copied to all six faces. A fixture that is itself broken tests nothing. So the
 * brushes are built by `insertSolids`, which is proven, and only the *formatting* is made
 * hostile afterwards. What is under test is the shape of the file, not its contents.
 */
import { insertSolids } from "../../src/vmf/build.js";
import { applyVmfOps } from "../../src/vmf/edit.js";

const SEED =
  'versioninfo\n{\n\t"editorversion" "400"\n}\nvisgroups\n{\n}\nworld\n{\n\t"id" "1"\n' +
  '\t"classname" "worldspawn"\n\t"skyname" "sky_day01_01"\n}\n';

/**
 * Collapses the file onto one line and takes every side's id away.
 *
 * Whitespace outside quotes only: a plane's three points contain single spaces already and
 * must survive. Nothing this writer emits puts a newline or a tab inside a value, which is
 * what makes the blunt version of this safe here and not in general.
 */
function makeAwkward(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  // `side { "id" "7" "plane" ...` becomes `side { "plane" ...`. The solids keep theirs,
  // because a tool that cannot name a brush cannot be asked to do anything to one.
  return oneLine.replace(/side \{ "id" "\d+" /g, "side { ");
}

function build(): { text: string; centred: number; offset: number } {
  const first = insertSolids(SEED, [{ shape: "box", mins: [-128, -128, -128], maxs: [128, 128, 128] }], {
    material: "DEV/DEV_MEASUREGENERIC01",
  });
  const second = insertSolids(first.text, [{ shape: "box", mins: [256, -64, -64], maxs: [384, 64, 64] }], {
    material: "DEV/DEV_MEASUREGENERIC01",
  });
  const withEntity = applyVmfOps(second.text, [
    {
      op: "add",
      keyvalues: {
        classname: "info_player_start",
        origin: "0 0 16",
        targetname: "awkward_spawn",
      },
    },
  ]);
  return {
    text: makeAwkward(withEntity.text),
    centred: first.solidIds[0]!,
    offset: second.solidIds[0]!,
  };
}

const built = build();

/** The map, as one line, with no side ids and keys sharing every line there is. */
export const AWKWARD_VMF = built.text;

/** The brush centred on the origin, whose four walls share one plane distance. */
export const AWKWARD_CENTRED = built.centred;

/** The brush offset along +x, so a selector can name one and not the other. */
export const AWKWARD_OFFSET = built.offset;
