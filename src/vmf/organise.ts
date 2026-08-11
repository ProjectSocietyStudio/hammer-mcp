/**
 * The organisation of a `.vmf`: visgroups, groups and the cordon.
 *
 * None of it reaches the compiled map. A visgroup hides a brush in the editor and not from
 * vbsp; a group is a selection convenience; a cordon limits what a test compile includes.
 * That is exactly why it was invisible to this toolkit and exactly why it matters at scale:
 * on a map with two thousand brushes, "the brushes of the north tenement" has to be a name
 * that lives in the file, or every selector is a bounding box someone typed from memory.
 *
 * The format was read out of srctools' own `vmf.py` rather than recalled, and reading it
 * turned up something worth knowing:
 *
 * **srctools cannot read group membership back from a Hammer map.** Its writer emits
 * `"groupid"` and its parser looks for `group`, so `Solid.group_id` comes back None for
 * every brush. Measured on `ttt_traps.vmf`, 11/08/2026: the file has ten `"groupid"` lines
 * and srctools reports group membership on zero of its 24 brushes. So the sidecar is not
 * an oracle for this one, and the checks here are against the file's own bytes.
 *
 * Membership lives in each object's `editor` block -- `"visgroupid"` repeated once per
 * group, `"groupid"` once -- while the visgroups themselves are declared in a top-level
 * `visgroups` block and the groups in `group` blocks inside `world`. Two places, and an id
 * in one that is missing from the other is a file Hammer opens and quietly repairs.
 */
import { children, get, parse } from "../kv/parse.js";
import type { KvBlock, KvNode, KvPair } from "../kv/parse.js";
import { maxId } from "./edit.js";
import { findSolids, isEmptySelector, lineRange, matchesSolid } from "./select.js";
import type { SolidSelector } from "./select.js";
import { checkVmfSolids } from "./solid.js";
import type { SolidCheck, Vec3 } from "./solid.js";
import { applySplices } from "./splice.js";
import type { Splice } from "./splice.js";

export class VmfOrganiseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VmfOrganiseError";
  }
}

export interface VisgroupInfo {
  id: number;
  name: string;
  color: string;
  /** Visgroups nested inside this one, as Hammer's tree shows them. */
  children: VisgroupInfo[];
  /** Solids and entities carrying this id in their editor block. */
  solidCount: number;
  entityCount: number;
}

export interface GroupInfo {
  id: number;
  solidCount: number;
}

export interface CordonInfo {
  name: string;
  active: boolean;
  mins: Vec3;
  maxs: Vec3;
}

export interface OrganisationReport {
  visgroups: VisgroupInfo[];
  groups: GroupInfo[];
  cordons: CordonInfo[];
  /** Whether the cordon is switched on. A compile with it on ships only what it contains. */
  cordonsActive: boolean;
  /** Solids belonging to no visgroup at all. */
  ungroupedSolids: number;
  warnings: string[];
}

const isPair = (n: KvNode): n is KvPair => n.kind === "pair";
const isBlock = (n: KvNode): n is KvBlock => n.kind === "block";

/** Every value of a repeated key in a block. `get` returns only the first. */
function allValues(block: KvBlock, key: string): string[] {
  return block.entries.filter(isPair).filter((p) => p.key === key).map((p) => p.value);
}

/** The `editor` sub-block of a solid or entity, if it has one. */
function editorOf(block: KvBlock): KvBlock | null {
  return block.entries.find((n): n is KvBlock => isBlock(n) && n.name === "editor") ?? null;
}

function parseVec(text: string): Vec3 | null {
  const nums = text.replace(/[()]/g, " ").trim().split(/\s+/).map(Number);
  if (nums.length !== 3 || nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0]!, nums[1]!, nums[2]!];
}

function readVisgroupTree(block: KvBlock): VisgroupInfo[] {
  return children(block, "visgroup").map((v) => ({
    id: Number(get(v, "visgroupid") ?? -1),
    name: get(v, "name") ?? "",
    color: get(v, "color") ?? "255 255 255",
    children: readVisgroupTree(v),
    solidCount: 0,
    entityCount: 0,
  }));
}

/** Reads what a map's organisation is, without judging any of it. */
export function readOrganisation(source: string): OrganisationReport {
  const roots = parse(source).filter(isBlock);
  const warnings: string[] = [];

  const visBlock = roots.find((b) => b.name === "visgroups");
  const visgroups = visBlock ? readVisgroupTree(visBlock) : [];
  const byId = new Map<number, VisgroupInfo>();
  const index = (list: VisgroupInfo[]): void => {
    for (const v of list) {
      byId.set(v.id, v);
      index(v.children);
    }
  };
  index(visgroups);

  const groups = new Map<number, GroupInfo>();
  for (const world of roots.filter((b) => b.name === "world")) {
    for (const g of children(world, "group")) {
      const id = Number(get(g, "id") ?? -1);
      if (id >= 0) groups.set(id, { id, solidCount: 0 });
    }
  }

  // Membership, counted from the objects themselves rather than from the declarations:
  // an id declared with no members and an id used with no declaration are different
  // faults, and Hammer repairs the second one silently on open.
  const unknownVis = new Set<number>();
  const unknownGroup = new Set<number>();
  let ungrouped = 0;

  const countOn = (block: KvBlock, kind: "solid" | "entity"): void => {
    const editor = editorOf(block);
    if (!editor) {
      if (kind === "solid") ungrouped++;
      return;
    }
    const ids = allValues(editor, "visgroupid").map(Number).filter(Number.isFinite);
    if (ids.length === 0 && kind === "solid") ungrouped++;
    for (const id of ids) {
      const info = byId.get(id);
      if (!info) unknownVis.add(id);
      else if (kind === "solid") info.solidCount++;
      else info.entityCount++;
    }
    const groupId = get(editor, "groupid");
    if (groupId !== undefined && /^\d+$/.test(groupId)) {
      const g = groups.get(Number(groupId));
      if (!g) unknownGroup.add(Number(groupId));
      else g.solidCount++;
    }
  };

  for (const found of findSolids(roots)) countOn(found.block, "solid");
  for (const ent of roots.filter((b) => b.name === "entity")) countOn(ent, "entity");

  const cordons: CordonInfo[] = [];
  let cordonsActive = false;
  const cordonBlock = roots.find((b) => b.name === "cordons");
  if (cordonBlock) {
    cordonsActive = get(cordonBlock, "active") === "1";
    for (const c of children(cordonBlock, "cordon")) {
      const box = children(c, "box")[0];
      const mins = box ? parseVec(get(box, "mins") ?? "") : null;
      const maxs = box ? parseVec(get(box, "maxs") ?? "") : null;
      cordons.push({
        name: get(c, "name") ?? "cordon",
        active: get(c, "active") === "1",
        mins: mins ?? [0, 0, 0],
        maxs: maxs ?? [0, 0, 0],
      });
    }
  }

  if (unknownVis.size > 0) {
    warnings.push(
      `${unknownVis.size} visgroup id(s) are used by objects but declared nowhere: ` +
        `${[...unknownVis].join(", ")}. Hammer drops those memberships silently when it ` +
        `opens the file.`,
    );
  }
  if (unknownGroup.size > 0) {
    warnings.push(
      `${unknownGroup.size} group id(s) are used but declared nowhere: ` +
        `${[...unknownGroup].join(", ")}.`,
    );
  }
  if (cordonsActive && cordons.some((c) => c.active)) {
    warnings.push(
      "the cordon is switched on. A compile with it on ships only what the cordon box " +
        "contains, and everything outside it is simply not in the map.",
    );
  }

  return {
    visgroups,
    groups: [...groups.values()],
    cordons,
    cordonsActive,
    ungroupedSolids: ungrouped,
    warnings,
  };
}


/**
 * The `editor` block of a solid, creating one when the file has none.
 *
 * Hammer always writes one; a generated or hand-written `.vmf` need not, and
 * `test/fixtures/gen_probe.py` does not. A tool that skipped those brushes would be unable
 * to organise exactly the maps this toolkit builds, which is the wrong half to be missing.
 * The block goes at the end of the solid, where Hammer puts it, and carries the two
 * `visgroupshown` flags Hammer writes on every one.
 */
function ensureEditor(
  source: string,
  solid: KvBlock,
  splices: Splice[],
  extra: string,
): { editor: KvBlock | null; created: boolean } {
  const editor = editorOf(solid);
  if (editor) return { editor, created: false };
  const indent = indentOf(source, solid);
  splices.push({
    start: solid.bodyEnd,
    end: solid.bodyEnd,
    text:
      `${indent}\teditor\n${indent}\t{\n${indent}\t\t"color" "0 180 220"\n` +
      `${indent}\t\t${extra}\n` +
      `${indent}\t\t"visgroupshown" "1"\n${indent}\t\t"visgroupautoshown" "1"\n` +
      `${indent}\t}\n`,
  });
  return { editor: null, created: true };
}

export interface VisgroupResult {
  text: string;
  visgroupId: number;
  created: boolean;
  solidsChanged: number;
  warnings: string[];
  unchanged: boolean;
}

/** Indentation of the line a block starts on. */
function indentOf(source: string, block: KvBlock): string {
  const lineStart = source.lastIndexOf("\n", block.start - 1) + 1;
  return source.slice(lineStart, block.start).match(/^[\t ]*/)?.[0] ?? "\t";
}

/**
 * Puts the selected solids in a visgroup, creating it when it does not exist.
 *
 * A membership is one `"visgroupid"` pair in the object's `editor` block, and the group
 * itself is one entry in the top-level `visgroups` block. Both halves are written, because
 * a membership whose group is not declared is dropped by Hammer without a word.
 */
export function setVisgroup(
  source: string,
  selector: SolidSelector,
  options: { name: string; remove?: boolean; color?: string },
): VisgroupResult {
  if (isEmptySelector(selector)) {
    throw new VmfOrganiseError(
      "refusing an empty selector: it would put every brush in the map in one visgroup",
    );
  }
  if (options.name.trim().length === 0) {
    throw new VmfOrganiseError("a visgroup needs a name");
  }

  const nodes = parse(source);
  const roots = nodes.filter(isBlock);
  const report = readOrganisation(source);

  const flat: VisgroupInfo[] = [];
  const walk = (list: VisgroupInfo[]): void => {
    for (const v of list) {
      flat.push(v);
      walk(v.children);
    }
  };
  walk(report.visgroups);

  const existing = flat.find((v) => v.name === options.name);
  // Visgroup ids are their own numbering space, not the one solids and entities share:
  // srctools keeps a separate IDMan for them, and a visgroup declares `visgroupid` rather
  // than `id`, so maxId cannot see one. Taking the next id from maxId gave the second
  // visgroup of a map the same id as the first, which Hammer reads as one visgroup and
  // this tool reported as two.
  const nextVisgroupId = flat.reduce((m, v) => Math.max(m, v.id), 0) + 1;
  if (!existing && options.remove) {
    throw new VmfOrganiseError(
      `there is no visgroup called ${JSON.stringify(options.name)} to remove anything from`,
    );
  }

  const splices: Splice[] = [];
  const visgroupId = existing?.id ?? nextVisgroupId;
  const created = !existing;

  if (created) {
    const visBlock = roots.find((b) => b.name === "visgroups");
    const colour = options.color ?? "255 255 255";
    const entry =
      `\tvisgroup\n\t{\n\t\t"name" "${options.name}"\n` +
      `\t\t"visgroupid" "${visgroupId}"\n\t\t"color" "${colour}"\n\t}\n`;
    if (visBlock) {
      splices.push({ start: visBlock.bodyEnd, end: visBlock.bodyEnd, text: entry });
    } else {
      // No visgroups block at all: a map that has never had one. Put it where Hammer does,
      // before the world, so the file still reads the way Hammer wrote it.
      const world = roots.find((b) => b.name === "world");
      const at = world ? lineRange(source, world).start : source.length;
      splices.push({ start: at, end: at, text: `visgroups\n{\n${entry}}\n` });
    }
  }

  const checks = new Map<number, SolidCheck>();
  for (const s of checkVmfSolids("(memory)", source).solids) {
    if (s.id !== null) checks.set(s.id, s);
  }

  let changed = 0;
  const warnings: string[] = [];
  for (const found of findSolids(roots)) {
    const check = checks.get(found.id);
    if (!check || !matchesSolid(check, selector)) continue;

    const editor = editorOf(found.block);
    if (!editor) {
      if (options.remove) continue;
      ensureEditor(source, found.block, splices, `"visgroupid" "${visgroupId}"`);
      changed++;
      continue;
    }
    const has = allValues(editor, "visgroupid").includes(String(visgroupId));

    if (options.remove) {
      if (!has) continue;
      for (const p of editor.entries.filter(isPair)) {
        if (p.key !== "visgroupid" || p.value !== String(visgroupId)) continue;
        const lineStart = source.lastIndexOf("\n", p.start - 1) + 1;
        const end = source[p.end] === "\n" ? p.end + 1 : p.end;
        splices.push({ start: lineStart, end, text: "" });
      }
      changed++;
      continue;
    }

    if (has) continue;
    // Before `visgroupshown`, which is where Hammer puts it, so a diff of the file reads
    // the way a diff of a Hammer save would.
    const anchor =
      editor.entries.filter(isPair).find((p) => p.key === "visgroupshown") ??
      editor.entries.filter(isPair)[0];
    const at = anchor ? anchor.start : editor.bodyEnd;
    const indent = indentOf(source, editor) + "\t";
    splices.push({ start: at, end: at, text: `"visgroupid" "${visgroupId}"\n${indent}` });
    changed++;
  }

  if (changed === 0 && !created) {
    warnings.push("every selected brush was already as asked, so nothing was written");
  }

  const text = applySplices(source, splices);
  return { text, visgroupId, created, solidsChanged: changed, warnings, unchanged: text === source };
}

export interface GroupResult {
  text: string;
  groupId: number | null;
  solidsChanged: number;
  warnings: string[];
  unchanged: boolean;
}

/**
 * Puts the selected solids in one Hammer group, or takes them out of theirs.
 *
 * A group is a `group` block inside `world` plus a `"groupid"` on each member. Unlike a
 * visgroup it has no name: Hammer shows it as "one thing" when you click any of its parts,
 * and that is all it is.
 */
export function groupSolids(
  source: string,
  selector: SolidSelector,
  options: { ungroup?: boolean } = {},
): GroupResult {
  if (isEmptySelector(selector)) {
    throw new VmfOrganiseError(
      "refusing an empty selector: it would put every brush in the map in one group",
    );
  }
  const nodes = parse(source);
  const roots = nodes.filter(isBlock);
  const checks = new Map<number, SolidCheck>();
  for (const s of checkVmfSolids("(memory)", source).solids) {
    if (s.id !== null) checks.set(s.id, s);
  }

  const wanted = findSolids(roots).filter((f) => {
    const c = checks.get(f.id);
    return c ? matchesSolid(c, selector) : false;
  });
  if (wanted.length === 0) {
    return {
      text: source,
      groupId: null,
      solidsChanged: 0,
      warnings: ["nothing matched the selector"],
      unchanged: true,
    };
  }

  const splices: Splice[] = [];
  const warnings: string[] = [];
  let changed = 0;

  if (options.ungroup) {
    for (const found of wanted) {
      const editor = editorOf(found.block);
      if (!editor) continue;
      for (const p of editor.entries.filter(isPair)) {
        if (p.key !== "groupid") continue;
        const lineStart = source.lastIndexOf("\n", p.start - 1) + 1;
        const end = source[p.end] === "\n" ? p.end + 1 : p.end;
        splices.push({ start: lineStart, end, text: "" });
        changed++;
      }
    }
    const text = applySplices(source, splices);
    if (changed === 0) warnings.push("none of the selected brushes was in a group");
    return { text, groupId: null, solidsChanged: changed, warnings, unchanged: text === source };
  }

  if (wanted.length < 2) {
    warnings.push(
      "a group of one brush is a group Hammer will show but nobody can use. Two or more " +
        "is what a group is for.",
    );
  }

  const world = roots.find((b) => b.name === "world");
  if (!world) throw new VmfOrganiseError("this file has no world block to put a group in");
  const groupId = maxId(nodes) + 1;
  const indent = "\t";
  splices.push({
    start: world.bodyEnd,
    end: world.bodyEnd,
    text:
      `${indent}group\n${indent}{\n${indent}\t"id" "${groupId}"\n` +
      `${indent}\teditor\n${indent}\t{\n${indent}\t\t"color" "220 220 220"\n${indent}\t}\n` +
      `${indent}}\n`,
  });

  for (const found of wanted) {
    const editor = editorOf(found.block);
    if (!editor) {
      ensureEditor(source, found.block, splices, `"groupid" "${groupId}"`);
      changed++;
      continue;
    }
    const current = editor.entries.filter(isPair).find((p) => p.key === "groupid");
    if (current) {
      splices.push({ start: current.start, end: current.end, text: `"groupid" "${groupId}"` });
    } else {
      const anchor =
        editor.entries.filter(isPair).find((p) => p.key === "visgroupshown") ??
        editor.entries.filter(isPair)[0];
      const at = anchor ? anchor.start : editor.bodyEnd;
      const ind = indentOf(source, editor) + "\t";
      splices.push({ start: at, end: at, text: `"groupid" "${groupId}"\n${ind}` });
    }
    changed++;
  }

  const text = applySplices(source, splices);
  return { text, groupId, solidsChanged: changed, warnings, unchanged: text === source };
}

export interface CordonResult {
  text: string;
  name: string;
  active: boolean;
  warnings: string[];
  unchanged: boolean;
}

/**
 * Sets the cordon box, and whether it is on.
 *
 * The one piece of a map's organisation that changes what compiles: with the cordon on,
 * vbsp is handed only what the box contains and everything outside it is simply not in the
 * map. It is how a mapper tests one room of a city without waiting for the city, and it is
 * also how a map ships with three quarters of itself missing.
 */
export function setCordon(
  source: string,
  box: { mins: Vec3; maxs: Vec3 },
  options: { name?: string; active?: boolean } = {},
): CordonResult {
  for (const axis of [0, 1, 2] as const) {
    if (box.maxs[axis] <= box.mins[axis]) {
      throw new VmfOrganiseError(
        `a cordon box needs mins below maxs on every axis; got ${box.mins[axis]} and ` +
          `${box.maxs[axis]} on axis ${axis}`,
      );
    }
  }
  const name = options.name ?? "cordon";
  const active = options.active !== false;

  const roots = parse(source).filter(isBlock);
  const existing = roots.find((b) => b.name === "cordons");
  const body =
    `{\n\t"active" "${active ? 1 : 0}"\n\tcordon\n\t{\n\t\t"name" "${name}"\n` +
    `\t\t"active" "${active ? 1 : 0}"\n\t\tbox\n\t\t{\n` +
    `\t\t\t"mins" "(${box.mins.join(" ")})"\n\t\t\t"maxs" "(${box.maxs.join(" ")})"\n` +
    `\t\t}\n\t}\n}`;

  const splices: Splice[] = [];
  if (existing) {
    splices.push({ start: existing.bodyStart - 1, end: existing.end, text: body });
  } else {
    const at = source.endsWith("\n") ? source.length : source.length;
    splices.push({ start: at, end: at, text: `cordons\n${body}\n` });
  }

  const warnings: string[] = [];
  if (active) {
    warnings.push(
      "the cordon is on. The next compile ships only what this box contains -- everything " +
        "outside it will not be in the map, and vbsp does not warn about it.",
    );
  }

  const text = applySplices(source, splices);
  return { text, name, active, warnings, unchanged: text === source };
}
