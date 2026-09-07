/**
 * Fill in translations for published submissions that are missing some.
 *
 *   npm run community:backfill-translations -- --dry   # list the gaps, call nothing
 *   npm run community:backfill-translations            # translate them
 *
 * Reads every green, published document and asks `translateMissing` to close
 * whatever gaps it finds. Idempotent: a language already stored is skipped
 * without a model call, so a second run is nearly free.
 *
 * Two ways a gap happens, and both are normal rather than exceptional:
 *   - a document published before the translation job existed, or published by
 *     a path that did not run it (the seed script did exactly this, which is
 *     what this script was written to repair);
 *   - a single language whose model call failed at publish time. That failure
 *     is deliberately not fatal — the recipe is already live in its own
 *     language — so the gap it leaves is meant to be closed here.
 *
 * Never writes to a `submissions` document: translations live in their own
 * collection and a translation must not alter the submission it translates.
 */
import { communityDb, SUBMISSIONS, type SubmissionDoc } from "../src/lib/community/client";
import { translateMissing } from "../src/lib/community/publish-translations";
import { SUPPORTED_LANGS } from "../src/lib/lang/types";

const dry = process.argv.includes("--dry");

(async () => {
  const db = await communityDb();
  if (!db) {
    console.error(
      "backfill-translations: no store. ATLAS_URL/ATLAS_USER/ATLAS_PASSWORD unset,\n" +
        "or Atlas Network Access does not allow this machine.",
    );
    process.exit(1);
  }

  const docs = await db
    .collection<SubmissionDoc>(SUBMISSIONS)
    .find(
      { status: "green", published_at: { $exists: true } },
      { projection: { "submission.recipe_name": 1, "submission.state": 1, "dish.language": 1 } },
    )
    .sort({ published_at: -1 })
    .toArray();

  console.log(`${docs.length} published document(s).\n`);

  let written = 0;
  let failed = 0;
  let calls = 0;

  for (const doc of docs) {
    const id = String(doc._id);
    const label = `${doc.submission.recipe_name} · ${doc.submission.state}`;
    const source = doc.dish?.language ?? "";
    // An unknown source language means every language is a target, English
    // included — the same rule `translateMissing` applies.
    const targetCount = source === "" ? SUPPORTED_LANGS.length : SUPPORTED_LANGS.length - 1;

    if (dry) {
      console.log(`  ${label} — source ${source || "unknown"}, up to ${targetCount} language(s)`);
      calls += targetCount;
      continue;
    }

    // Printed whole, after the await, rather than as a "label … " prefix
    // before it: the Mongo driver writes its own errors to stderr during that
    // await, and a half-finished line lets them interleave, so a result ends
    // up printed against the wrong recipe. That happened on the first run and
    // cost a real chunk of time chasing a store inconsistency that was only
    // ever a garbled log.
    const r = await translateMissing(id, () => {});
    written += r.written;
    failed += r.failed;
    console.log(`  ${label} — ${r.written} written, ${r.skipped} already there, ${r.failed} failed`);
  }

  if (dry) {
    console.log(`\n--dry: nothing was written. At most ${calls} model call(s) if none are stored yet.`);
    process.exit(0);
  }

  console.log(`\n${written} translation(s) written, ${failed} failed.`);
  if (failed) console.log("Re-run to retry the failures; stored languages are skipped without a call.");
  // The pooled Mongo client holds the event loop open otherwise.
  process.exit(failed > 0 ? 1 : 0);
})();
