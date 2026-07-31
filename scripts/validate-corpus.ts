/**
 * Validates every corpus record and prints a verification ledger.
 *
 *   npm run corpus:validate
 *
 * Exits non-zero on any validation failure, so it can gate a build.
 */
import { loadCorpus } from "../src/lib/corpus/load";
import { CorpusValidationError } from "../src/lib/corpus/validate";

function main() {
  let corpus;
  try {
    corpus = loadCorpus();
  } catch (err) {
    if (err instanceof CorpusValidationError) {
      console.error("\n✗ Corpus validation failed\n");
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const { records, swaps } = corpus;
  const ancient = records.filter((r) => r.tier === "ancient");
  const modernDishes = records.filter((r) => r.provenance_class === "MODERN_DISH");
  const unverified = records.filter((r) => r.verification.status === "unverified_seed");

  console.log(`\n✓ ${records.length} records, ${swaps.length} swaps — all valid\n`);
  console.log(`  ancient originals   ${ancient.length}`);
  console.log(`  modern-dish records ${modernDishes.length}`);
  console.log(`  swap entries        ${swaps.length}`);

  const byClass = new Map<string, number>();
  for (const r of records) {
    byClass.set(r.provenance_class, (byClass.get(r.provenance_class) ?? 0) + 1);
  }
  console.log("\n  provenance classes");
  for (const [k, v] of [...byClass].sort()) console.log(`    ${k.padEnd(15)} ${v}`);

  if (unverified.length) {
    console.log(
      `\n  ⚠ ${unverified.length} record(s) awaiting editorial verification against a printed edition.`,
    );
    console.log("    None of these may render an ATTESTED badge or a verse quotation.\n");
    for (const r of unverified) {
      console.log(`      ${r.slug.padEnd(20)} ${r.provenance_class.padEnd(15)} ${r.source.text}`);
    }
  }

  const noCounterpart = records.filter((r) => r.tier === "ancient" && !r.modern_counterpart_id);
  if (noCounterpart.length) {
    console.error(`\n✗ ancient records missing a modern counterpart: ${noCounterpart.length}`);
    process.exit(1);
  }

  console.log();
}

main();
