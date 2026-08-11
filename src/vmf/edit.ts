/**
 * Editing a `.vmf` by splicing byte ranges of the original text.
 *
 * The rule this file exists to enforce: **never reserialise a VMF.** Every edit is
 * computed as a range over the source and applied last-first, so everything untouched
 * comes through byte-identical.
 *
 * Worth stating precisely, because the imprecise version cost a test: a VMF straight out
 * of Hammer is canonical enough that our own formatter round-trips it byte for byte, so
 * "reserialising loses data" is false for that case and a byte-equality test on such a
 * file proves nothing. What a reserialiser really drops is what the grammar does not
 * model -- `//` comments, blank lines, indentation that is not one tab per level -- and
 * a parser that reads values as numbers (srctools) would reformat floats on top. Editors
 * other than Hammer and hand-edited maps have all of these, and losing them is silent.
 *
 * The same discipline already governs the entity-lump write path (`../entity/edit.ts`),
 * but a VMF is harder in one specific way. A lump entity is a flat block of pairs, so
 * rewriting it whole is harmless. A VMF entity contains `solid`, `connections` and
 * `editor` sub-blocks holding the actual geometry: rewriting the block whole would either
 * drop them or reformat them. So keyvalue edits splice **individual pairs**, and new pairs
 * are inserted just before the first sub-block, which is where Hammer puts them.
 *
 * Brush geometry is not handled here, and the reason has changed. It used to be a refusal:
 * creating a brush means choosing planes and texture axes, and a tool that does that
 * without an oracle produces maps that compile and are wrong. That argument is still
 * correct -- it is the conclusion that is out of date, because the oracles now exist.
 * `./solid.ts` rebuilds a brush's volume from its planes and runs the check in the
 * opposite direction from the writer; vbsp refuses what it cannot bound; a sealed room
 * either boots or does not. So brush creation moved to `./build.ts`, with those checks
 * wired in front of the write rather than left to the caller. This file keeps the entity
 * and keyvalue half of the write path.
 */
import { children, get, pairs, parse } from "../kv/parse.js";
import type { KvBlock, KvNode } from "../kv/parse.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfEditError";
  }
}

/** One `entity { ... }` block at the root of a VMF. */
export interface VmfEntity {
  /** Hammer's own `id`, the number shown in its entity report. Null when absent. */
  id: number | null;
  classname: string;
  targetname: string | null;
  /** Position among the root `entity` blocks, 0-based. Stable within one read. */
  index: number;
  /** Top-level keyvalues, excluding sub-blocks. */
  keyvalues: Record<string, string>;
  solidCount: number;
  block: KvBlock;
}

export interface EntityMatch {
  /** Hammer's `id`. The only selector that survives an edit that adds or removes. */
  id?: number;
  index?: number;
  classname?: string;
  targetname?: string;
}

export type VmfOp =
  | { op: "add"; keyvalues: Record<string, string> }
  | { op: "update"; match: EntityMatch; set?: Record<string, string>; unset?: string[] }
  | { op: "remove"; match: EntityMatch }
  | { op: "addOutput"; match: EntityMatch; output: string; value: string }
  | { op: "removeOutput"; match: EntityMatch; output: string; valueContains?: string };

export interface OpOutcome {
  op: VmfOp["op"];
  matched: number;
  /** Hammer ids of the entities acted on, so a caller can find them in the editor. */
  ids: Array<number | null>;
  warnings: string[];
}

export interface VmfEditResult {
  text: string;
  outcomes: OpOutcome[];
  warnings: string[];
  entitiesBefore: number;
  entitiesAfter: number;
  /** True when the text is unchanged, byte for byte. */
  unchanged: boolean;
}

/** Reads the root `entity` blocks of a VMF, keeping every source offset. */
export function readEntities(text: string): { nodes: KvNode[]; entities: VmfEntity[] } {
  const nodes = parse(text);
  const entities: VmfEntity[] = [];

  for (const node of nodes) {
    if (node.kind !== "block" || node.name !== "entity") continue;
    const kv = Object.fromEntries(pairs(node));
    const rawId = kv["id"];
    entities.push({
      id: rawId !== undefined && /^\d+$/.test(rawId) ? Number(rawId) : null,
      classname: kv["classname"] ?? "",
      targetname: kv["targetname"] ?? null,
      index: entities.length,
      keyvalues: kv,
      solidCount: children(node, "solid").length,
      block: node,
    });
  }
  return { nodes, entities };
}

/**
 * The largest `id` anywhere in the file.
 *
 * Hammer numbers every entity, solid, side and editor node from one counter, so a new
 * entity reusing a number already taken by a brush side makes the file unopenable. The
 * whole tree is scanned rather than just the entities.
 */
export function maxId(nodes: readonly KvNode[]): number {
  let max = 0;
  const walk = (list: readonly KvNode[]): void => {
    for (const n of list) {
      if (n.kind === "pair") {
        if (n.key === "id" && /^\d+$/.test(n.value)) max = Math.max(max, Number(n.value));
      } else {
        walk(n.entries);
      }
    }
  };
  walk(nodes);
  return max;
}

function select(entities: readonly VmfEntity[], m: EntityMatch): VmfEntity[] {
  if (m.id === undefined && m.index === undefined && !m.classname && !m.targetname) {
    throw new VmfEditError("match needs at least one of id, index, classname, targetname");
  }
  return entities.filter(
    (e) =>
      (m.id === undefined || e.id === m.id) &&
      (m.index === undefined || e.index === m.index) &&
      (!m.classname || e.classname === m.classname) &&
      (!m.targetname || e.targetname === m.targetname),
  );
}

/** Indentation of the line `offset` sits on, so inserted lines match their neighbours. */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const match = /^[\t ]*/.exec(text.slice(lineStart, offset));
  return match ? match[0] : "\t";
}

/**
 * Where a new top-level pair goes inside an entity block: after the last existing pair,
 * before the first sub-block. Hammer writes keyvalues first and `solid`/`connections`/
 * `editor` after, and an inserted pair that lands between two solids is legal but reads
 * as damage in a diff.
 */
function insertionPoint(block: KvBlock): number {
  let last = block.bodyStart;
  for (const node of block.entries) {
    if (node.kind === "block") break;
    last = node.end;
  }
  return last;
}

function setPair(
  text: string,
  block: KvBlock,
  key: string,
  value: string,
  splices: Splice[],
): void {
  const existing = block.entries.find((n): n is Extract<KvNode, { kind: "pair" }> =>
    n.kind === "pair" && n.key === key,
  );
  if (existing) {
    splices.push({ start: existing.start, end: existing.end, text: `"${key}" "${value}"` });
    return;
  }
  const at = insertionPoint(block);
  const indent = indentAt(text, block.entries.find((n) => n.kind === "pair")?.start ?? at);
  splices.push({ start: at, end: at, text: `\n${indent}"${key}" "${value}"` });
}

function removePair(text: string, block: KvBlock, key: string, splices: Splice[]): void {
  for (const node of block.entries) {
    if (node.kind !== "pair" || node.key !== key) continue;
    // Take the line with it, indentation included, or removal leaves a blank indented line.
    const lineStart = text.lastIndexOf("\n", node.start - 1) + 1;
    const end = text[node.end] === "\n" ? node.end + 1 : node.end;
    splices.push({ start: lineStart, end, text: "" });
  }
}

/** Formats a new `entity` block the way Hammer writes them: tab indent, brace on its own line. */
function formatEntity(kv: Record<string, string>, id: number): string {
  const body = Object.entries({ id: String(id), ...kv })
    .map(([k, v]) => `\t"${k}" "${v}"\n`)
    .join("");
  return `entity\n{\n${body}}\n`;
}

/**
 * Applies operations to VMF text.
 *
 * Nothing is written here: the caller decides what to do with the result. An empty op list
 * returns the input unchanged, which is the property the whole design rests on and which
 * the tests assert byte for byte.
 */
export function applyVmfOps(text: string, ops: readonly VmfOp[]): VmfEditResult {
  const { nodes, entities } = readEntities(text);
  const splices: Splice[] = [];
  const appends: string[] = [];
  /** Outputs to add, gathered per entity so one splice serves all of them. */
  const pendingOutputs = new Map<VmfEntity, Array<[string, string]>>();
  const outcomes: OpOutcome[] = [];
  const warnings: string[] = [];
  let nextId = maxId(nodes);
  let delta = 0;

  for (const op of ops) {
    if (op.op === "add") {
      const classname = op.keyvalues["classname"];
      if (!classname) throw new VmfEditError("add: keyvalues must include a classname");
      if (op.keyvalues["id"] !== undefined) {
        throw new VmfEditError("add: id is assigned here, to avoid colliding with a brush side");
      }
      const w: string[] = [];
      if (/^func_|^trigger_/.test(classname)) {
        // A brush entity with no solid is legal in the file and vanishes at compile time.
        w.push(
          `${classname} is normally a brush entity. This adds a point entity with no solid; ` +
            `vbsp will drop it unless brushes are attached in Hammer.`,
        );
      }
      nextId += 1;
      appends.push(formatEntity(op.keyvalues, nextId));
      outcomes.push({ op: "add", matched: 1, ids: [nextId], warnings: w });
      warnings.push(...w);
      delta += 1;
      continue;
    }

    const targets = select(entities, op.match);
    const w: string[] = [];

    switch (op.op) {
      case "remove":
        for (const e of targets) {
          const lineStart = text.lastIndexOf("\n", e.block.start - 1) + 1;
          const end = text[e.block.end] === "\n" ? e.block.end + 1 : e.block.end;
          if (e.solidCount > 0) {
            w.push(
              `entity ${e.id ?? e.index} (${e.classname}) carries ${e.solidCount} solid(s); ` +
                `removing it removes that geometry too`,
            );
          }
          splices.push({ start: lineStart, end, text: "" });
        }
        delta -= targets.length;
        break;

      case "update":
        for (const e of targets) {
          for (const k of op.unset ?? []) {
            if (k === "id") throw new VmfEditError("update: id cannot be unset");
            removePair(text, e.block, k, splices);
          }
          for (const [k, v] of Object.entries(op.set ?? {})) {
            if (k === "id") throw new VmfEditError("update: id cannot be changed");
            setPair(text, e.block, k, v, splices);
          }
        }
        break;

      case "addOutput":
        // Collected rather than spliced here. Every offset in this loop comes from one
        // parse of the original text, so two addOutput ops on an entity with no
        // connections block would each create one -- and Hammer reads only the first,
        // so half the outputs would vanish in the editor with nothing to show for it.
        for (const e of targets) {
          const list = pendingOutputs.get(e) ?? [];
          list.push([op.output, op.value]);
          pendingOutputs.set(e, list);
        }
        break;

      case "removeOutput":
        for (const e of targets) {
          const conn = children(e.block, "connections")[0];
          if (!conn) continue;
          for (const node of conn.entries) {
            if (node.kind !== "pair" || node.key !== op.output) continue;
            if (op.valueContains && !node.value.includes(op.valueContains)) continue;
            const lineStart = text.lastIndexOf("\n", node.start - 1) + 1;
            const end = text[node.end] === "\n" ? node.end + 1 : node.end;
            splices.push({ start: lineStart, end, text: "" });
          }
        }
        break;
    }

    outcomes.push({
      op: op.op,
      matched: targets.length,
      ids: targets.map((e) => e.id),
      warnings: w,
    });
    warnings.push(...w);
  }

  for (const [e, outputs] of pendingOutputs) {
    const conn = children(e.block, "connections")[0];
    if (conn) {
      const at = insertionPoint(conn);
      const indent = indentAt(text, conn.entries.find((n) => n.kind === "pair")?.start ?? at);
      splices.push({
        start: at,
        end: at,
        text: outputs.map(([k, v]) => `\n${indent}"${k}" "${v}"`).join(""),
      });
    } else {
      const at = insertionPoint(e.block);
      const indent = indentAt(text, e.block.entries.find((n) => n.kind === "pair")?.start ?? at);
      const body = outputs.map(([k, v]) => `\n${indent}\t"${k}" "${v}"`).join("");
      splices.push({
        start: at,
        end: at,
        text: `\n${indent}connections\n${indent}{${body}\n${indent}}`,
      });
    }
  }

  let out = applySplices(text, splices);
  if (appends.length > 0) {
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += appends.join("");
  }

  return {
    text: out,
    outcomes,
    warnings,
    entitiesBefore: entities.length,
    entitiesAfter: entities.length + delta,
    unchanged: out === text,
  };
}

/** Classname of an entity block, for callers that only need that much. */
export function classnameOf(block: KvBlock): string {
  return get(block, "classname") ?? "";
}
