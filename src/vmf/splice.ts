/**
 * Applying byte-range edits to text without reserialising it.
 *
 * This is the primitive the whole VMF write path rests on, and it existed in three copies
 * -- `./edit.ts`, `./lightmap.ts` and `./reclass.ts` each declared the same `Splice` shape
 * and the same last-first loop. Three copies of a rule is three chances to drift from it,
 * and the rule matters: everything a splice does not name comes through byte-identical,
 * which is what makes a diff of a machine edit readable by a human.
 *
 * Two things the copies did not do, and that are the reason this file is worth its
 * existence rather than being a tidy-up:
 *
 * **Overlapping ranges were silently wrong.** Two edits over the same bytes produced text
 * that depended on which was sorted first, and no caller checked. That is reachable today:
 * `applyVmfOps` will happily accept an op that removes an entity and another that sets a
 * keyvalue on it, because `select()` matches the same block twice. The result parses --
 * it is simply not what either op asked for. Here it throws.
 *
 * **Insertions at one point came out backwards.** Setting two new keyvalues in one op
 * pushes two zero-length splices at the same offset; sorted last-first, the second one
 * landed before the first. Nothing tested it, so nothing said so. Ties now resolve in
 * push order, which is the order the caller wrote.
 */

export class SpliceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpliceError";
  }
}

/**
 * One replacement of `[start, end)` in the source text.
 *
 * `start === end` is an insertion. Offsets are always measured against the *original*
 * text -- that is the point of applying last-first, and it is why a caller may parse once
 * and compute every edit from that single parse.
 */
export interface Splice {
  start: number;
  end: number;
  text: string;
}

/**
 * Applies splices to `source`, last-first, so every offset stays valid as the text is
 * rewritten behind it.
 *
 * Throws on a range that is backwards, outside the text, or that overlaps another.
 * Zero-length insertions never overlap anything, including each other and the boundary of
 * a replaced range -- an insertion at the edge of a deletion is how `reclass.ts` moves a
 * solid to a destination that happens to sit next to it.
 */
export function applySplices(source: string, splices: readonly Splice[]): string {
  if (splices.length === 0) return source;

  for (const s of splices) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) {
      throw new SpliceError(`splice offsets must be integers, got [${s.start}, ${s.end})`);
    }
    if (s.start < 0 || s.end > source.length) {
      throw new SpliceError(
        `splice [${s.start}, ${s.end}) is outside a text of ${source.length} bytes`,
      );
    }
    if (s.end < s.start) {
      throw new SpliceError(`splice [${s.start}, ${s.end}) ends before it starts`);
    }
  }

  // Push order decides ties, so remember it before sorting.
  const ordered = splices.map((splice, index) => ({ splice, index }));
  ordered.sort((a, b) => b.splice.start - a.splice.start || b.index - a.index);

  // Only ranges that actually replace bytes can collide; an insertion occupies none.
  const spans = ordered.filter((o) => o.splice.end > o.splice.start).map((o) => o.splice);
  for (let i = 1; i < spans.length; i += 1) {
    const later = spans[i - 1]!;
    const earlier = spans[i]!;
    if (earlier.end > later.start) {
      throw new SpliceError(
        `splices [${earlier.start}, ${earlier.end}) and [${later.start}, ${later.end}) ` +
          `overlap; one edit would land inside the other and the result would depend on ` +
          `which was applied first`,
      );
    }
  }

  let out = source;
  for (const { splice } of ordered) {
    out = out.slice(0, splice.start) + splice.text + out.slice(splice.end);
  }
  return out;
}
