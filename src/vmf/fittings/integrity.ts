/**
 * What makes an assembly an assembly, checked rather than assumed.
 *
 * `write_vmf_solid` already has an oracle and it is a good one: `read_vmf_solids` recovers
 * each brush's volume from its planes, running the opposite way from the writer, so a sign
 * error cannot hide in both directions at once. That still holds here -- a fitting's parts
 * are brushes and go through the same check.
 *
 * But it says nothing about the thing that makes a counter a counter rather than three
 * boxes near each other. Two failures pass every per-brush check ever written:
 *
 * - a worktop floating two units above its own body, which reads in game as a slab hanging
 *   in mid-air and reads in every report as two perfectly valid brushes;
 * - a toe kick pushed into the body it should sit under, which vbsp merges without comment
 *   and which shows up only as a lighting seam nobody traces back.
 *
 * So the invariant is stated here and tested directly: **the parts of a fitting touch, and
 * their interiors do not meet.** Both halves matter. Touching alone permits a solid block
 * with no articulation; not-overlapping alone permits a scatter.
 *
 * Every fitting in this directory emits axis-aligned boxes, which is why this can be exact.
 * There is no tolerance anywhere below, and there must not be one: the arithmetic is on
 * whole units, so a gap is a gap and a lap is a lap. A tolerance here would be a way of not
 * noticing the very cases this exists to catch.
 */

/** One part of an assembly: an axis-aligned box, and what it is called. */
export interface Part {
  name: string;
  mins: readonly [number, number, number];
  maxs: readonly [number, number, number];
}

/** Two parts whose interiors meet, and by how much. */
export interface Overlap {
  a: string;
  b: string;
  /** The volume the two share. Always positive -- a zero would be a touch, not an overlap. */
  volume: number;
}

export interface Integrity {
  overlaps: Overlap[];
  /**
   * The parts, grouped into pieces that hold together by touching.
   *
   * A count rather than a verdict, because the right count is a fact about the fitting and
   * not about assemblies in general. A counter is one piece. A door casing on both faces of
   * a wall is **two** -- they are joined by the wall, and the wall is not part of the
   * fitting. Demanding one piece everywhere would have made that correct frame illegal.
   */
  components: string[][];
}

/** How far two boxes overlap on one axis. Negative means a gap, zero means they touch. */
const spanOverlap = (
  a: Part,
  b: Part,
  axis: 0 | 1 | 2,
): number => Math.min(a.maxs[axis], b.maxs[axis]) - Math.max(a.mins[axis], b.mins[axis]);

/**
 * Whether two parts share any interior.
 *
 * Strictly: every axis must overlap by more than nothing. Two boxes meeting exactly on a
 * plane overlap by zero on that axis, which is a touch and is what we want everywhere.
 */
export function interiorsMeet(a: Part, b: Part): boolean {
  return spanOverlap(a, b, 0) > 0 && spanOverlap(a, b, 1) > 0 && spanOverlap(a, b, 2) > 0;
}

/**
 * Whether two parts touch: their closures meet, on a face, an edge or a corner.
 *
 * An edge or a corner counts, and that is deliberate rather than sloppy. Skirting mitred
 * round a room meets at the corners and nowhere else, and a rule that demanded face contact
 * would call a correctly built run detached.
 */
export function touch(a: Part, b: Part): boolean {
  return spanOverlap(a, b, 0) >= 0 && spanOverlap(a, b, 1) >= 0 && spanOverlap(a, b, 2) >= 0;
}

/** The volume two parts share. Zero unless their interiors meet. */
function sharedVolume(a: Part, b: Part): number {
  const x = spanOverlap(a, b, 0);
  const y = spanOverlap(a, b, 1);
  const z = spanOverlap(a, b, 2);
  if (x <= 0 || y <= 0 || z <= 0) return 0;
  return x * y * z;
}

/**
 * Checks an assembly against its own invariant.
 *
 * Reports rather than throws: the caller decides what to do about it, and the tool that
 * uses this refuses on the result. Keeping the judgement out of here is what lets a test
 * assert on a broken assembly without catching an exception.
 */
export function checkAssembly(parts: readonly Part[]): Integrity {
  const overlaps: Overlap[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const volume = sharedVolume(parts[i]!, parts[j]!);
      if (volume > 0) overlaps.push({ a: parts[i]!.name, b: parts[j]!.name, volume });
    }
  }

  // Reachability by touching, from the first part. A fitting whose pieces fall into two
  // groups that each hold together is still wrong, and a component count would say so --
  // but naming the ones left out says it in a form a caller can act on.
  //
  // Grouped by index rather than by name: two parts of one fitting may legitimately share a
  // name -- four runs of skirting are all `run` -- and a set of names would silently treat
  // the second one as already visited, merging two pieces that never touched.
  const seen = new Set<number>();
  const components: string[][] = [];
  for (let start = 0; start < parts.length; start++) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    const group: string[] = [];
    while (queue.length > 0) {
      const at = queue.pop()!;
      group.push(parts[at]!.name);
      for (let k = 0; k < parts.length; k++) {
        if (!seen.has(k) && touch(parts[at]!, parts[k]!)) {
          seen.add(k);
          queue.push(k);
        }
      }
    }
    components.push(group);
  }

  return { overlaps, components };
}
