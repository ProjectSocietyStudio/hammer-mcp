/**
 * A map's own rules, written next to it.
 *
 * "Four metres of pavement, no entrance obstructed, the view from the lobby preserved" is a
 * design brief, and until now it had no form anything here could check. This gives it one.
 *
 * ## Per map, never global
 *
 * The file is `<map>.rules.json`, a **sibling** of the `.vmf`. No walking up the directory
 * tree, no defaults, no built-in bar. A residential street and a warehouse have different
 * right answers for every number in this file, and a shared default would be wrong for both
 * while looking authoritative. Absent means *no checking*, not *checking against something
 * reasonable*.
 *
 * ## It reports; it never refuses
 *
 * `check_vmf_rules` returns violations. The writing tools do not consult it, and must not:
 * a mapper may want a narrow alley, and turning a design choice into a write error is how a
 * tool stops being usable. This is the opposite of the geometry checks, which *do* refuse --
 * a non-planar face is not a choice, and 96 units of corridor is.
 *
 * ## JSON, not KeyValues
 *
 * Valve's format is for Valve's files. This is ours, and JSON buys a schema, a machine-
 * readable parse error and a line number for free.
 */
import { z } from "zod";

export const RULES_VERSION = 1;

/** A point in the world, or a way of finding one. */
const anchorSchema = z.union([
  z.object({ point: z.array(z.number()).length(3) }),
  z.object({ entity: z.string().describe("A targetname. The first match wins.") }),
  z.object({ room: z.number().describe("A room id from read_vmf_rooms: its widest point.") }),
]);

export type Anchor = z.infer<typeof anchorSchema>;

const selectSchema = z
  .object({
    classname: z.string().optional().describe("Entities whose classname contains this."),
    targetname: z.string().optional(),
    room: z
      .union([z.number(), z.literal("*")])
      .optional()
      .describe("A room id, or `*` for every room."),
    portal: z.literal("*").optional().describe("Every doorway between two rooms."),
  })
  .describe("What the rule applies to. An empty selector matches nothing, and is refused.");

export type Selector = z.infer<typeof selectSchema>;

/**
 * The measurements a rule can be about.
 *
 * Deliberately short. Every entry maps to one function in `src/space/measure.ts` with an
 * operative definition; adding a check means adding a measurement, not adding a word here
 * whose meaning is decided at the call site.
 */
export const CHECKS = [
  "circulation_width",
  "clearance_in_front",
  "headroom",
  "sightline",
  "room_area",
] as const;

export type CheckName = (typeof CHECKS)[number];

const ruleSchema = z
  .object({
    id: z.string().min(1).describe("Names this rule in every violation it produces."),
    what: z.enum(CHECKS),
    select: selectSchema.optional(),
    from: anchorSchema.optional().describe("`sightline` only."),
    to: anchorSchema.optional().describe("`sightline` only."),
    mustBe: z.enum(["clear", "blocked"]).optional().describe("`sightline` only."),
    min: z.number().optional().describe("Units, or square units for room_area."),
    max: z.number().optional(),
    hull: z.enum(["standing", "crouching"]).default("standing"),
    severity: z.enum(["error", "warning", "info"]).default("error"),
    note: z.string().optional().describe("Why this rule exists. Carried into every violation."),
  })
  .describe("One checkable statement about the map.");

export type Rule = z.infer<typeof ruleSchema>;

export const rulesFileSchema = z.object({
  version: z.literal(RULES_VERSION),
  map: z.string().optional().describe("Free text: which map this describes, for a reader."),
  rules: z.array(ruleSchema).min(1),
});

export type RulesFile = z.infer<typeof rulesFileSchema>;

export class RulesError extends Error {}

/**
 * Parses a rules file, refusing anything it cannot check.
 *
 * A rule with no bound, or a sightline with no endpoints, would silently pass on every map
 * and read in the file as a rule that is being enforced. That is worse than no rule at all,
 * so it is refused at load rather than ignored at check time.
 */
export function parseRules(text: string, path: string): RulesFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new RulesError(`${path}: not valid JSON -- ${(error as Error).message}`);
  }

  const parsed = rulesFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new RulesError(
      `${path}: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "invalid"}`,
    );
  }

  const seen = new Set<string>();
  for (const rule of parsed.data.rules) {
    if (seen.has(rule.id)) {
      throw new RulesError(
        `${path}: two rules are both called ${JSON.stringify(rule.id)}. An id names a rule ` +
          `in its violations, so a duplicate makes a finding impossible to trace back.`,
      );
    }
    seen.add(rule.id);

    if (rule.what === "sightline") {
      if (!rule.from || !rule.to) {
        throw new RulesError(
          `${path}: rule ${JSON.stringify(rule.id)} is a sightline with no 'from' or no 'to'. ` +
            `It would pass on every map while reading as an enforced rule.`,
        );
      }
    } else {
      if (rule.min === undefined && rule.max === undefined) {
        throw new RulesError(
          `${path}: rule ${JSON.stringify(rule.id)} has neither 'min' nor 'max', so nothing ` +
            `can fail it. A rule that cannot fail is worse than no rule: it reads as ` +
            `enforcement and is not.`,
        );
      }
      if (!rule.select || Object.keys(rule.select).length === 0) {
        throw new RulesError(
          `${path}: rule ${JSON.stringify(rule.id)} has no 'select', so it applies to ` +
            `nothing. Use {"room": "*"} or {"portal": "*"} to mean every one.`,
        );
      }
    }
  }

  return parsed.data;
}

/** Where a map's rules live: its own name with `.rules.json` instead of `.vmf`. */
export function rulesPathFor(mapPath: string): string {
  return mapPath.replace(/\.vmf$/i, "") + ".rules.json";
}
