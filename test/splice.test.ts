import { describe, expect, it } from "vitest";
import { applySplices, SpliceError } from "../src/vmf/splice.js";

const TEXT = "abcdefghij";

describe("applySplices", () => {
  it("returns the source untouched when there is nothing to do", () => {
    const out = applySplices(TEXT, []);
    expect(out).toBe(TEXT);
  });

  it("replaces a range and leaves every other byte where it was", () => {
    const out = applySplices(TEXT, [{ start: 3, end: 6, text: "XY" }]);
    expect(out).toBe("abcXYghij");
  });

  it("applies several ranges, each measured against the original text", () => {
    // The property that matters: both offsets were computed from TEXT, not from the
    // half-rewritten result. Applying left-first would put the second edit in the wrong
    // place, because the first one changed the length before it.
    const out = applySplices(TEXT, [
      { start: 1, end: 3, text: "LONGER" },
      { start: 7, end: 9, text: "Z" },
    ]);
    expect(out).toBe("aLONGERdefgZj");
  });

  it("inserts without deleting when start equals end", () => {
    const out = applySplices(TEXT, [{ start: 5, end: 5, text: "--" }]);
    expect(out).toBe("abcde--fghij");
  });

  it("keeps two insertions at one offset in the order they were pushed", () => {
    // The three copies this file replaced sorted last-first without a tiebreak, so the
    // second insertion landed before the first. Setting two new keyvalues in one op does
    // exactly this, and nothing tested it.
    const out = applySplices(TEXT, [
      { start: 5, end: 5, text: "1" },
      { start: 5, end: 5, text: "2" },
    ]);
    expect(out).toBe("abcde12fghij");
  });

  it("lets an insertion sit on the boundary of a replaced range", () => {
    // reclass.ts moves a solid to a destination that may be adjacent to the cut. An
    // insertion occupies no bytes, so it cannot collide with anything.
    const out = applySplices(TEXT, [
      { start: 3, end: 6, text: "" },
      { start: 6, end: 6, text: "!" },
    ]);
    expect(out).toBe("abc!ghij");
  });

  it("keeps an insertion sitting on the start of a replaced range", () => {
    // The other boundary, and the one that was wrong: applying the insertion first put it
    // inside the range about to be removed, so it vanished with it. reclass.ts moves a
    // solid to a destination that can be exactly where the cut begins.
    const out = applySplices(TEXT, [
      { start: 3, end: 6, text: "" },
      { start: 3, end: 3, text: "!" },
    ]);
    expect(out).toBe("abc!ghij");
  });

  it("keeps an insertion on a start boundary whichever order it was pushed in", () => {
    const before = applySplices(TEXT, [
      { start: 3, end: 3, text: "!" },
      { start: 3, end: 6, text: "" },
    ]);
    expect(before).toBe("abc!ghij");
  });

  it("refuses two ranges that overlap", () => {
    // Reachable today through applyVmfOps: one op removing an entity and another setting
    // a keyvalue on the same entity both match, and the result parses while being neither.
    expect(() =>
      applySplices(TEXT, [
        { start: 2, end: 6, text: "A" },
        { start: 4, end: 8, text: "B" },
      ]),
    ).toThrow(SpliceError);
  });

  it("allows two ranges that merely touch", () => {
    const out = applySplices(TEXT, [
      { start: 2, end: 4, text: "A" },
      { start: 4, end: 6, text: "B" },
    ]);
    expect(out).toBe("abABghij");
  });

  it("refuses a range that runs backwards, or off the end of the text", () => {
    expect(() => applySplices(TEXT, [{ start: 6, end: 3, text: "" }])).toThrow(SpliceError);
    expect(() => applySplices(TEXT, [{ start: 0, end: 99, text: "" }])).toThrow(SpliceError);
    expect(() => applySplices(TEXT, [{ start: -1, end: 2, text: "" }])).toThrow(SpliceError);
  });
});
