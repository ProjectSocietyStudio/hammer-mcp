import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config.js";

/**
 * Where GMod looks for scripted entities. Each of these holds one directory or one
 * `.lua` file per class, named after the class itself.
 *
 * `reference/` is deliberately absent: it is a read-only corpus of an old production
 * server, not code this one loads, and treating its classes as defined would silence
 * warnings about entities that genuinely are not here.
 */
const ENTITY_DIRS = [
  "addons/*/lua/entities",
  "gamemodes/*/entities/entities",
  "srcds/garrysmod/addons/*/lua/entities",
  "srcds/garrysmod/gamemodes/*/entities/entities",
];

function expandOneStar(root: string, pattern: string): string[] {
  const star = pattern.indexOf("*");
  if (star === -1) return [join(root, pattern)];

  const before = pattern.slice(0, star).replace(/\/$/, "");
  const after = pattern.slice(star + 1).replace(/^\//, "");
  const base = join(root, before);
  if (!existsSync(base)) return [];

  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    out.push(join(base, entry.name, after));
  }
  return out;
}

/**
 * Class names of every scripted entity this repo defines in Lua.
 *
 * The FGD is not the whole truth in GMod: a gamemode or addon registers entities at
 * runtime that Hammer never hears about. Without this list a VMF lint reports
 * `ttt_damageowner` as an unknown class, when
 * `gamemodes/terrortown/entities/entities/ttt_damageowner.lua` plainly defines it.
 *
 * Errs towards knowing too much: a class listed here is merely not flagged, so a false
 * entry costs a missed warning, while a missing one costs a wrong accusation on every
 * map that uses it.
 */
export function luaEntityClasses(config: Config): string[] {
  const found = new Set<string>();

  for (const pattern of ENTITY_DIRS) {
    for (const dir of expandOneStar(config.repoRoot, pattern)) {
      if (!existsSync(dir)) continue;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // A folder holds init.lua / cl_init.lua; the folder is the class.
          found.add(entry.name);
        } else if (entry.name.endsWith(".lua")) {
          found.add(entry.name.slice(0, -4));
        }
      }
    }
  }

  return [...found].sort();
}
