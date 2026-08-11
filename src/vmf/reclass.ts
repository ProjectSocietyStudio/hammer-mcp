/**
 * Moving brushes between the world and a brush entity.
 *
 * This is the single most effective thing anyone does to a Source map's performance, and
 * it is invisible in the compiled file: vbsp folds `func_detail` into the world as detail
 * brushes, so a `.bsp` cannot tell you which brushes were structural. Auditing a shipped
 * map will never surface this. It has to be done on the source, which is why it lives
 * here.
 *
 * What it buys: a structural brush splits the BSP tree and generates visleaves. A pillar,
 * a window frame, a doorstep, a piece of trim -- every one of those cuts the space around
 * it into slivers that vvis then has to compute visibility for, and the result is both a
 * slower compile and a worse PVS. `func_detail` takes a brush out of that entirely.
 *
 * ⚠️ And the trap, which is the reason this file warns rather than just acting: **a
 * `func_detail` brush does not seal the map.** Move a wall into one and the next compile
 * leaks. That is the classic way to lose an afternoon, and no static check here can rule
 * it out -- sealing is a property of the whole hull, not of one brush. So the tool says
 * what to compile next instead of implying the move was safe.
 *
 * The write is a splice like every other in this directory: each solid's byte range is cut
 * and re-inserted at the target, and nothing else in the file moves.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock, KvNode } from "../kv/parse.js";
import { maxId } from "./edit.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfReclassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfReclassError";
  }
}

/** Where a solid should end up. `world` is the worldspawn; anything else is a brush entity. */
export type ReclassTarget =
  | { to: "world" }
  | {
      to: "entity";
      classname: string;
      /**
       * Existing entity to add to. Omitted, a new one is created.
       *
       * Grouping is a matter of taste rather than performance: vbsp dissolves every
       * `func_detail` into the world regardless of how many entities they arrived in.
       * Fewer entities is tidier in Hammer; that is the whole difference.
       */
      entityId?: number;
      keyvalues?: Record<string, string>;
    };

export interface MovedSolid {
  id: number;
  from: string;
  to: string;
}

export interface ReclassResult {
  text: string;
  moved: MovedSolid[];
  /** Id of the entity this created, when it created one. */
  createdEntityId: number | null;
  warnings: string[];
  /** True when the text is unchanged, byte for byte. */
  unchanged: boolean;
}

interface FoundSolid {
  id: number;
  block: KvBlock;
  owner: string;
  /** The root block it currently sits in. */
  ownerBlock: KvBlock;
  /** True when it sits inside a `hidden` wrapper rather than directly in its owner. */
  hidden: boolean;
}

function findSolids(roots: readonly KvBlock[]): FoundSolid[] {
  const out: FoundSolid[] = [];
  const take = (host: KvBlock, ownerBlock: KvBlock, owner: string, hidden: boolean): void => {
    for (const solid of children(host, "solid")) {
      const raw = get(solid, "id");
      if (raw === undefined || !/^\d+$/.test(raw)) continue;
      out.push({ id: Number(raw), block: solid, owner, ownerBlock, hidden });
    }
  };
  for (const root of roots) {
    if (root.name === "world") {
      take(root, root, "world", false);
      for (const h of children(root, "hidden")) take(h, root, "world", true);
    } else if (root.name === "entity") {
      const cls = get(root, "classname") ?? "entity";
      take(root, root, cls, false);
      for (const h of children(root, "hidden")) take(h, root, cls, true);
    }
  }
  return out;
}

/** The full source line range of a block, so cutting it leaves no blank indented line. */
function lineRange(text: string, block: KvBlock): { start: number; end: number } {
  const start = text.lastIndexOf("\n", block.start - 1) + 1;
  const end = text[block.end] === "\n" ? block.end + 1 : block.end;
  return { start, end };
}

/**
 * Moves the named solids to a new owner.
 *
 * Solids already sitting in the target are left where they are and reported rather than
 * cut and re-inserted: a no-op that rewrites bytes is indistinguishable from a real edit
 * in a diff, and the point of this write path is that a diff shows only what changed.
 */
export function reclassSolids(
  source: string,
  solidIds: readonly number[],
  target: ReclassTarget,
): ReclassResult {
  if (solidIds.length === 0) throw new VmfReclassError("no solids to move");

  const nodes: KvNode[] = parse(source);
  const roots = nodes.filter((n): n is KvBlock => n.kind === "block");
  const found = findSolids(roots);
  const byId = new Map(found.map((s) => [s.id, s]));

  const missing = solidIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new VmfReclassError(
      `no solid with id ${missing.join(", ")} in this file. ` +
        `read_vmf_solids lists what is there; ids are Hammer's own, not positions.`,
    );
  }

  const targetName = target.to === "world" ? "world" : target.classname;
  const warnings: string[] = [];
  const selected = solidIds.map((id) => byId.get(id)!);

  const inHidden = selected.filter((s) => s.hidden);
  if (inHidden.length > 0) {
    // Moving one out of its `hidden` wrapper would make it visible in Hammer as a side
    // effect of an edit that said nothing about visibility.
    throw new VmfReclassError(
      `solid ${inHidden.map((s) => s.id).join(", ")} sits inside a \`hidden\` block, which is ` +
        `how Hammer stores a brush hidden by a visgroup. Moving it out would silently ` +
        `unhide it. Unhide it in Hammer first, or move a different brush.`,
    );
  }

  const already = selected.filter((s) => s.owner === targetName);
  const moving = selected.filter((s) => s.owner !== targetName);
  if (already.length > 0) {
    warnings.push(
      `solid ${already.map((s) => s.id).join(", ")} already belongs to ${targetName}; ` +
        `left untouched rather than rewritten in place`,
    );
  }

  if (moving.length === 0) {
    return {
      text: source,
      moved: [],
      createdEntityId: null,
      warnings,
      unchanged: true,
    };
  }

  // Locate the destination before anything is cut, because every offset below comes from
  // the original text and stays valid only while the original is intact.
  let insertAt: number;
  let createdEntityId: number | null = null;
  let newEntityPrefix = "";
  let newEntitySuffix = "";

  if (target.to === "world") {
    const world = roots.find((b) => b.name === "world");
    if (!world) throw new VmfReclassError("this file has no `world` block");
    insertAt = world.bodyEnd;
  } else if (target.entityId !== undefined) {
    const entity = roots.find(
      (b) =>
        b.name === "entity" &&
        b.entries.some((e) => e.kind === "pair" && e.key === "id" && e.value === String(target.entityId)),
    );
    if (!entity) {
      throw new VmfReclassError(`no entity with id ${target.entityId} in this file`);
    }
    const cls = get(entity, "classname");
    if (cls !== target.classname) {
      throw new VmfReclassError(
        `entity ${target.entityId} is a ${cls ?? "classless entity"}, not a ${target.classname}. ` +
          `Refusing rather than moving brushes into something other than what was asked for.`,
      );
    }
    insertAt = entity.bodyEnd;
  } else {
    // A brand new entity, appended at the root. Hammer writes entities after the world.
    createdEntityId = maxId(nodes) + 1;
    const kv = { id: String(createdEntityId), classname: target.classname, ...target.keyvalues };
    newEntityPrefix =
      `entity\n{\n` + Object.entries(kv).map(([k, v]) => `\t"${k}" "${v}"\n`).join("");
    newEntitySuffix =
      `\teditor\n\t{\n\t\t"color" "0 180 220"\n\t\t"visgroupshown" "1"\n\t\t"visgroupautoshown" "1"\n\t}\n}\n`;
    insertAt = source.length;
  }

  const body = moving.map((s) => {
    const { start, end } = lineRange(source, s.block);
    return source.slice(start, end);
  });

  const splices: Splice[] = moving.map((s) => {
    const { start, end } = lineRange(source, s.block);
    return { start, end, text: "" };
  });
  splices.push({
    start: insertAt,
    end: insertAt,
    text: newEntityPrefix + body.join("") + newEntitySuffix,
  });

  const text = applySplices(source, splices);

  const leftInWorld = found.filter(
    (s) => s.owner === "world" && !moving.some((m) => m.id === s.id),
  ).length;
  if (targetName !== "world" && leftInWorld === 0) {
    warnings.push(
      `this leaves the world with no brushes at all. Nothing in a func_detail seals a map, ` +
        `so the next compile will leak unless something else holds the hull.`,
    );
  }

  return {
    text,
    moved: moving.map((s) => ({ id: s.id, from: s.owner, to: targetName })),
    createdEntityId,
    warnings,
    unchanged: false,
  };
}
