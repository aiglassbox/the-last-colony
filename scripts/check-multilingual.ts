/**
 * End-to-end multilingual retrieval: normalize (model call) then retrieve.
 * Needs a model key — NOT part of `npm run check`.
 *   npm run corpus:check-multilingual
 *
 * Same failure taxonomy as check-retrieval: WRONG (returned a different dish)
 * fails the run; MISS (declined when a dish was expected) is counted.
 */
import "dotenv/config";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalize } from "../src/lib/lang/normalize";
import { retrieveForDish } from "../src/lib/retrieval/retrieve";

interface Case {
  q: string;
  lang: string;
  expect: string | null;
  why?: string;
}

async function main() {
  const path = join(process.cwd(), "tests", "multilingual-queries.json");
  const cases = (JSON.parse(readFileSync(path, "utf8")) as { cases: Case[] }).cases;

  const misses: Array<{ c: Case; got: string | null }> = [];
  const wrongs: Array<{ c: Case; got: string | null; english: string }> = [];
  let pass = 0;

  for (const c of cases) {
    const n = await normalize(c.q);
    const result = await retrieveForDish(n.english);
    const got = result.empty ? null : result.records[0].slug;

    if (got === c.expect) {
      pass++;
    } else if (c.expect === null || (got !== null && got !== c.expect)) {
      wrongs.push({ c, got, english: n.english });
    } else {
      misses.push({ c, got });
    }
  }

  console.log(`\n${pass}/${cases.length} multilingual queries pass\n`);

  if (misses.length) {
    console.log(`  MISS (${misses.length}) — expected a dish, retrieval declined:`);
    for (const m of misses)
      console.log(`    "${m.c.q}" (${m.c.lang}) → expected ${m.c.expect}, got nothing`);
    console.log();
  }
  if (wrongs.length) {
    console.log(`  WRONG (${wrongs.length}) — returned the wrong dish:`);
    for (const w of wrongs)
      console.log(
        `    "${w.c.q}" (${w.c.lang}) → english="${w.english}", expected ${w.c.expect ?? "nothing"}, got ${w.got ?? "nothing"}${w.c.why ? `\n        ${w.c.why}` : ""}`,
      );
    console.log();
  }

  if (wrongs.length > 0) {
    console.error("✗ A wrong dish is worse than none. Fix before shipping.\n");
    process.exit(1);
  }
  console.log(`✓ multilingual retrieval clean (${misses.length} misses)\n`);
}

main();
