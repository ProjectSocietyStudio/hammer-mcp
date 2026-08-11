export interface CompileFinding {
  severity: "error" | "warning" | "info";
  rule: string;
  message: string;
  /** The compiler line this came from, kept so nothing here has to be trusted blind. */
  line: string;
}

interface Rule {
  rule: string;
  severity: CompileFinding["severity"];
  match: RegExp;
  /** Written for the person who has to fix it, not to restate the compiler. */
  explain: (m: RegExpMatchArray) => string;
}

/**
 * What the Source compilers say, and what it actually means.
 *
 * The compilers report in prose aimed at whoever wrote them in 2004. Several of their
 * most common messages name the wrong thing -- a leak gives no location, a displacement
 * error prints brush id 0 every time -- so each rule here carries the correction rather
 * than repeating the line.
 */
const RULES: Rule[] = [
  {
    rule: "leak",
    severity: "error",
    match: /\*\*\* leaked \*\*\*|Entity .* leaked!/i,
    explain: () =>
      "the map is not sealed: something inside it can see the void. vvis and vrad " +
      "results are meaningless until this is fixed, and the map loads fullbright. " +
      "vbsp writes a .lin pointfile beside the map -- read_leak turns it into a " +
      "location and the entity nearest to it",
  },
  {
    rule: "bad-surface-extents",
    severity: "error",
    match: /Bad surface extents/i,
    explain: () =>
      "a face has a texture scale outside [0.1, 10], or an axis perpendicular to it. " +
      "The face index printed here cannot be found in Hammer; read_vmf_lint finds the " +
      "brush and side by id before you compile",
  },
  {
    rule: "displacement-on-entity",
    severity: "error",
    match: /Displacement found on a\(n\) (\w+) entity/i,
    explain: (m) =>
      `a displacement sits on a ${m[1]} instead of on world geometry. The brush id ` +
      `printed by vbsp is always 0 and cannot be used; read_vmf_lint reports the real one`,
  },
  {
    rule: "max-map-limit",
    severity: "error",
    match: /(MAX_MAP_\w+)/,
    explain: (m) =>
      `${m[1]} is full. read_map_geometry shows how close each lump is to its ceiling, ` +
      `and read_vmf_lint checks the same limits before a compile is started`,
  },
  {
    rule: "too-many-t-junctions",
    severity: "warning",
    match: /too many t-junctions|t-junction/i,
    explain: () =>
      "too many contacts between func_detail and world brushes. Usually means detail " +
      "geometry is touching structural geometry it does not need to",
  },
  {
    rule: "cubemap-size-mismatch",
    severity: "info",
    match: /weren't compiled with the same size texture|Can't load skybox file .* to build the default cubemap/i,
    explain: () =>
      "vbsp could not build the default cubemap for this skybox. Harmless for geometry; " +
      "run buildcubemaps in game to replace it. read_pakfile counts the c-*.vtf files " +
      "afterwards, which is how you check it actually happened",
  },
  {
    rule: "material-missing",
    severity: "warning",
    match: /Material (\S+) not found|Can't load (\S+)/i,
    explain: (m) =>
      `${m[1] ?? m[2]} is missing. It will render as the purple checkerboard, and if ` +
      `it is a custom asset it also has to be packed into the .bsp`,
  },
  {
    rule: "no-entities",
    severity: "warning",
    match: /No entities in the map|Map has no entities/i,
    explain: () => "the map has no entities at all, which usually means the wrong file was compiled",
  },
];

const TIMING = /^(\d+) threads|^Done \(([\d.]+)\)|^\s*(\d+) seconds elapsed/i;

export interface CompileLogReport {
  findings: CompileFinding[];
  bySeverity: Record<string, number>;
  byRule: Record<string, number>;
  /** True when nothing at error severity was found. */
  clean: boolean;
  leaked: boolean;
}

/** Turns a compiler's output into structured findings. */
export function parseCompileLog(text: string): CompileLogReport {
  const findings: CompileFinding[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || TIMING.test(line)) continue;

    // First match wins, so the specific rules above take precedence over the general
    // ones below them. Without this, "Can't load skybox file ... to build the default
    // cubemap" is reported as a missing material and advised to be packed, which is
    // wrong: nothing is missing, vbsp just could not build a placeholder.
    for (const rule of RULES) {
      const m = line.match(rule.match);
      if (!m) continue;
      // One occurrence per rule per distinct line: a leak prints its banner more than
      // once, and repeating it does not add information.
      const key = `${rule.rule}::${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          severity: rule.severity,
          rule: rule.rule,
          message: rule.explain(m),
          line,
        });
      }
      break;
    }
  }

  const bySeverity: Record<string, number> = {};
  const byRule: Record<string, number> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
    byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  }

  return {
    findings,
    bySeverity,
    byRule,
    clean: (bySeverity["error"] ?? 0) === 0,
    leaked: (byRule["leak"] ?? 0) > 0,
  };
}
