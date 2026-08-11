import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGeometry } from "../src/bsp/geometry.js";
import { readVisleafStats } from "../src/bsp/visleaf.js";
import { FIXTURES, has, paths } from "./support/env.js";

const LEAFS = 10;

/**
 * Two readers, two methods, one number.
 *
 * `readGeometry` divides the LEAFS lump's length by the record size its version calls for.
 * `readVisleafStats` walks the lump and decodes each record. Neither consults the other,
 * and they were written in different sessions from the same header file.
 *
 * That independence is the whole value. Either reader alone can only say what it believes;
 * a disagreement here says one of them is wrong, which is a thing neither could ever tell
 * you on its own. It is also the check that was impossible until both existed -- the
 * visleaf reader was contributed with "cannot be cross-checked" written in its commit
 * message, rather than with an oracle invented to fill the gap.
 */
function bothCounts(path: string): { divided: number | null; walked: number } {
  return {
    divided: readGeometry(path).lumps.find((l) => l.index === LEAFS)?.count ?? null,
    walked: readVisleafStats(path).leafCount,
  };
}

describe("the two leaf counters agree", () => {
  it("on the probe", () => {
    const { divided, walked } = bothCounts(join(FIXTURES, "hmcp_probe.bsp"));
    expect(divided).toBe(walked);
    // Pinned, so that "both agree" cannot become "both broke the same way".
    expect(walked).toBe(29);
  });

  it.skipIf(!has.prodMap)("on a 1.13 GB production map", () => {
    const { divided, walked } = bothCounts(paths.prodMap);
    expect(divided).toBe(walked);
    expect(walked).toBe(23_711);
  });

  it.skipIf(!has.navPair)("on the two maps Garry's Mod ships", () => {
    for (const [name, expected] of [
      ["gm_construct", 5002],
      ["gm_flatgrass", 3610],
    ] as Array<[string, number]>) {
      const { divided, walked } = bothCounts(join(paths.mapsDir, `${name}.bsp`));
      expect(divided, name).toBe(walked);
      expect(walked, name).toBe(expected);
    }
  });
});
