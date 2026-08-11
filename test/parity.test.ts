import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/index.js";

const DOC = join(import.meta.dirname, "..", "docs", "hammer-parity.md");
const text = (): string => readFileSync(DOC, "utf8");

/**
 * The parity table is the answer to "can an agent do everything a mapper can", and its
 * whole value is that it can be argued with. A row naming a tool that does not exist is
 * worse than no row: it is a claim that reads as checked and is not.
 *
 * So the document checks itself. Not for whether the coverage claims are *true* -- no test
 * can say whether `clip_solids` really covers Hammer's clip tool -- but for whether the
 * names in it are names this server answers to, and whether the count it states is the
 * count there is.
 */
describe("docs/hammer-parity.md", () => {
  const names = new Set(allTools.map((t) => t.name));

  it("names only tools this server has, in the column that claims one", () => {
    // Scoped to the "Here" column of a table row. An allow-list of everything else that
    // gets backticked -- keyvalues, classnames like env_fog_controller, console commands
    // like mat_leafvis -- was the first version, and a list of exceptions that grows every
    // time the prose does is a check that will eventually be turned off rather than fixed.
    // The column is the claim; the prose is prose.
    // And only under a header that has a "Here" column: the "Beyond Hammer" table puts the
    // tool in column 1 and what Hammer has instead in column 2, so reading column 2 there
    // finds console commands rather than claims.
    const claimed = new Set<string>();
    let inParityTable = false;
    for (const line of text().split("\n")) {
      if (line.startsWith("| Hammer |")) {
        inParityTable = line.includes("| Here |");
        continue;
      }
      if (!line.startsWith("|")) {
        inParityTable = false;
        continue;
      }
      if (!inParityTable || line.includes("|---")) continue;
      const here = line.split("|")[2] ?? "";
      for (const m of here.matchAll(/`([a-z_]{4,})`/g)) {
        if (m[1]!.includes("_")) claimed.add(m[1]!);
      }
    }
    expect(claimed.size, "the table must claim some tools").toBeGreaterThan(20);

    const unknown = [...claimed].filter((n) => !names.has(n));
    expect(unknown, `claimed in the Here column and not registered: ${unknown.join(", ")}`).toEqual(
      [],
    );
  });

  it("states the tool count it was last checked against", () => {
    // "58 tools" in a document nobody re-counts is how a table starts lying. If this fails,
    // the number moved and the table needs reading rather than patching.
    const stated = text().match(/\*\*(\d+) tools\*\*/);
    expect(stated, "the document must state how many tools it was checked against").not.toBeNull();
    expect(Number(stated![1])).toBe(allTools.length);
  });

  it("accounts for every tool the server has, in one table or the other", () => {
    // The other direction, and the one that turned up a missing section rather than a
    // missing row: twenty-two of these tools answer questions Hammer never asked, so they
    // belong under "Beyond Hammer" rather than in a parity row. A tool in neither table is
    // a capability the document does not account for.
    const body = text();
    const missing = [...names].filter((n) => !body.includes(`\`${n}\``));
    expect(
      missing,
      `tools with no row: ${missing.join(", ")}. Either add a row or say why it is not a ` +
        `Hammer command.`,
    ).toEqual([]);
  });

  it("gives a reason for every gap, in the column meant for it", () => {
    // A gap is a row whose middle column is italicised rather than naming a tool. Selecting
    // them by the phrases they happen to contain was the first version, and a sabotage that
    // replaced "*not covered*" with "*nope*" passed: the row was no longer selected at all,
    // so the check ran over an empty list and agreed with itself.
    const rows = text()
      .split("\n")
      .filter((line) => /^\|[^|]+\|\s*\*[^*]+\*\s*\|/.test(line));
    expect(rows.length, "the document must have gaps, or it is not being honest").toBeGreaterThan(
      3,
    );
    for (const row of rows) {
      // "| Hammer | Here | Notes |" splits to ["", Hammer, Here, Notes, ""], so the notes
      // are index 3. Reading index 2 was the first version, which checked that the gap
      // marker was non-empty -- true by construction, since that is what selected the row.
      const reason = row.split("|")[3] ?? "";
      const hasReason = reason.trim().length > 0;
      expect(hasReason, `a gap with an empty reason column: ${row.trim()}`).toBe(true);
    }
  });
});
