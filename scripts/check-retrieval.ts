/**
 * Runs the hand-checked query set against retrieval.
 *
 *   npm run corpus:check-retrieval
 *
 * Two failure kinds, and they are not equally bad:
 *   MISS  — expected a dish, got nothing. Costs a card.
 *   WRONG — expected nothing (or another dish), got a dish. Costs the campaign.
 * Exits non-zero on any WRONG, or on more than the allowed number of MISSes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { retrieveForDish } from "../src/lib/retrieval/retrieve";

interface Case {
  q: string;
  expect: string | null;
  why?: string;
  /**
   * `vector` marks a case only the pipeline index can answer. Six queries —
   * samosa, jalebi, puran poli, sambar, halwa, sattu — have genuine records
   * among the 199 and none among the 31, so they expected `null` purely
   * because the test predates the index. They are real expectations, not
   * optional ones, and skipping them when the fallback is off is the honest
   * reading: the answer exists, this configuration just cannot reach it.
   */
  via?: "vector";
}

const ALLOWED_MISSES = 0;
const VECTOR_ON = process.env.VECTOR_FALLBACK === "on";

async function main() {
  const path = join(process.cwd(), "tests", "retrieval-queries.json");
  const all = (JSON.parse(readFileSync(path, "utf8")) as { cases: Case[] }).cases;
  const skipped = VECTOR_ON ? [] : all.filter((c) => c.via === "vector");
  const cases = VECTOR_ON ? all : all.filter((c) => c.via !== "vector");

  const misses: Array<{ c: Case; got: string | null; score: number }> = [];
  const wrongs: Array<{ c: Case; got: string | null; score: number }> = [];
  let pass = 0;

  for (const c of cases) {
    const result = await retrieveForDish(c.q);
    const got = result.empty ? null : result.records[0].slug;

    if (got === c.expect) {
      pass++;
    } else if (c.expect === null || (got !== null && got !== c.expect)) {
      wrongs.push({ c, got, score: result.top_score });
    } else {
      misses.push({ c, got, score: result.top_score });
    }
  }

  console.log(`\n${pass}/${cases.length} hand-checked queries pass\n`);
  if (skipped.length) {
    console.log(
      `  (${skipped.length} skipped — answerable only via the index, which is off: ` +
        `${skipped.map((c) => `"${c.q}"`).join(", ")}.\n   Run with VECTOR_FALLBACK=on to include them.)\n`,
    );
  }

  if (misses.length) {
    console.log(`  MISS (${misses.length}) — expected a dish, retrieval declined:`);
    for (const m of misses) {
      console.log(
        `    "${m.c.q}" → expected ${m.c.expect}, got nothing (top score ${m.score.toFixed(2)})`,
      );
    }
    console.log();
  }

  if (wrongs.length) {
    console.log(`  WRONG (${wrongs.length}) — retrieval returned the wrong ancestor:`);
    for (const w of wrongs) {
      console.log(
        `    "${w.c.q}" → expected ${w.c.expect ?? "nothing"}, got ${w.got ?? "nothing"} ` +
          `(score ${w.score.toFixed(2)})${w.c.why ? `\n        ${w.c.why}` : ""}`,
      );
    }
    console.log();
  }

  if (wrongs.length > 0) {
    console.error("✗ A wrong ancestor is worse than no ancestor. Fix before shipping.\n");
    process.exit(1);
  }
  if (misses.length > ALLOWED_MISSES) {
    console.error(`✗ ${misses.length} misses, ${ALLOWED_MISSES} allowed.\n`);
    process.exit(1);
  }
  console.log("✓ retrieval is clean\n");
}

main();
