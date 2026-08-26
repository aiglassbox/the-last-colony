/**
 * Precompute the localized restoration cards.
 *   npm run localize:corpus              # all searchable records, all languages
 *   npm run localize:corpus -- idli dosa # only these slugs
 *   npm run localize:corpus -- --force   # re-translate even if unchanged
 *
 * One structured model call per (record, language), written to
 * corpus/localized/<lang>/<slug>.json (committed, reviewable). Content-hash
 * idempotent: a record whose translatable fields are unchanged is skipped, so
 * a corpus edit re-translates only what moved. Live (spends API), never part of
 * `npm run check`.
 */
import "dotenv/config";

import { fileCorpus } from "../src/lib/corpus/load";
import { translateRecord } from "../src/lib/lang/localize";
import { sourceHash, storedHash, writeLocalized } from "../src/lib/lang/localized-store";
import { SUPPORTED_LANGS, type SupportedLang } from "../src/lib/lang/types";

/** Roughly what one translation call costs at paid-tier flash pricing. */
const COST_PER_CALL = 0.00394;

const LANGS = SUPPORTED_LANGS.filter((l): l is Exclude<SupportedLang, "en"> => l !== "en");

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const slugs = args.filter((a) => !a.startsWith("--"));

  const all = await fileCorpus.all();
  // Only records that can appear on a card render record-derived content worth
  // translating: ancient records and searchable MODERN_DISH records.
  const searchable = all.filter(
    (r) => r.tier === "ancient" || r.provenance_class === "MODERN_DISH",
  );
  const records = slugs.length ? searchable.filter((r) => slugs.includes(r.slug)) : searchable;

  if (!records.length) {
    console.error(slugs.length ? `No searchable record matches: ${slugs.join(", ")}` : "No searchable records.");
    process.exit(1);
  }

  console.log(
    `Localizing ${records.length} record(s) × ${LANGS.length} languages ` +
      `(${records.length * LANGS.length} pairs)${force ? " [--force]" : ""}\n`,
  );

  let translated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    const hash = sourceHash(record);
    const done: string[] = [];
    for (const lang of LANGS) {
      if (!force && storedHash(record.slug, lang) === hash) {
        skipped++;
        continue;
      }
      const card = await translateRecord(record, lang);
      if (card) {
        writeLocalized(record, card);
        translated++;
        done.push(lang);
      } else {
        failed++;
        console.log(`  FAIL ${record.slug} ${lang}`);
      }
    }
    if (done.length) console.log(`  ok  ${record.slug} → ${done.join(" ")}`);
  }

  console.log(
    `\ntranslated ${translated}, skipped ${skipped} (up to date), failed ${failed}` +
      `\nestimated spend this run: ~$${(translated * COST_PER_CALL).toFixed(2)}\n`,
  );
  if (failed) process.exit(1);
}

main();
