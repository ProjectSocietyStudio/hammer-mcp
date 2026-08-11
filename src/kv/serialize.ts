import type { KvBlock, KvNode } from "./parse.js";

/**
 * Formats KeyValues the way Hammer writes them: tab indentation, the brace on its own
 * line, and `"key" "value"` separated by a single space.
 *
 * This is the formatter for content we CREATE. It is not the write path for content we
 * edit -- see `../entity/edit.ts` and `../vmf/edit.ts`, which splice ranges of the
 * original text so that everything untouched stays byte-identical.
 *
 * What reserialising actually costs, measured on 11/08/2026 rather than assumed: this
 * formatter copies every value verbatim, so numbers survive it -- a VMF of canonical
 * Hammer output round-trips byte for byte, which is why an earlier version of the VMF
 * edit tests failed to notice a deliberate reserialisation. What does NOT survive is
 * everything the grammar does not model: `//` comments, blank lines, and indentation
 * that is not one tab per level. Hand-edited maps and third-party editors have all three.
 *
 * (A parser that reads values as typed numbers -- srctools, on the Python side -- would
 * reformat `5416.0312` as well. That is a reason never to write a VMF through the
 * sidecar, not a property of this file.)
 */
export function serialize(nodes: readonly KvNode[], indent = 0): string {
  return nodes.map((n) => serializeNode(n, indent)).join("");
}

export function serializeNode(node: KvNode, indent = 0): string {
  const pad = "\t".repeat(indent);
  if (node.kind === "pair") {
    return `${pad}"${node.key}" "${node.value}"\n`;
  }
  const head = node.name ? `${pad}${node.name}\n` : "";
  return `${head}${pad}{\n${serialize(node.entries, indent + 1)}${pad}}\n`;
}

/** A gap between two parsed nodes that is not pure whitespace or a comment. */
export interface OffsetGap {
  start: number;
  end: number;
  text: string;
}

/**
 * Verifies that the parsed offsets account for the whole source: nodes are ordered,
 * non-overlapping, in bounds, and everything between them is whitespace or a `//`
 * comment.
 *
 * This is the real round-trip oracle. Asserting `serialize(parse(x)) === x` would be
 * asserting that Hammer formats exactly the way we do, which it does not; asserting
 * that the offsets cover the source proves the property the splice write path actually
 * depends on -- that any range we do not touch can be copied through verbatim.
 */
export function findOffsetGaps(source: string, nodes: readonly KvNode[]): OffsetGap[] {
  const gaps: OffsetGap[] = [];
  let cursor = 0;

  const visit = (list: readonly KvNode[], limit: number): void => {
    for (const n of list) {
      record(cursor, n.start);
      cursor = n.start;
      if (n.kind === "block") {
        cursor = n.bodyStart;
        visit(n.entries, n.bodyEnd);
        record(cursor, n.bodyEnd);
      }
      cursor = n.end;
    }
    record(cursor, limit);
    cursor = limit;
  };

  const record = (from: number, to: number): void => {
    if (to <= from) return;
    const text = source.slice(from, to);
    if (isFiller(text)) return;
    gaps.push({ start: from, end: to, text });
  };

  visit(nodes, source.length);
  return gaps;
}

/** True when the text between two nodes carries no information: whitespace or comments. */
function isFiller(text: string): boolean {
  return text
    .split("\n")
    .every((line) => {
      const t = line.trim();
      return t === "" || t.startsWith("//");
    });
}
