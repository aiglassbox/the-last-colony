import { getSubmission, saveTranslation, translatedLangs } from "./client";
import { translateSubmission } from "./translate";
import { SUPPORTED_LANGS, type SupportedLang } from "../lang/types";

/**
 * Fill in every supported language a published submission does not yet have.
 *
 * This lived inline in the pantry route's `after()` callback, which made
 * "publishing" and "translating" the same act only when the publish went
 * through that one route. `scripts/seed-community.ts` calls
 * `publishSubmission()` in the store directly, so twelve seeded recipes went
 * live with no translations at all and nobody noticed until a reader asked for
 * one in Hindi. One function, three callers — the route, the seeder, and the
 * backfill script — is what keeps that from being true again.
 *
 * Never throws. A language that fails is logged and skipped: the recipe is
 * already live in its own language, and a missing translation falls back
 * exactly as a corpus record falls back to English when a localization is
 * missing. Gaps left here are what `npm run community:backfill-translations`
 * exists to close later.
 */
export async function translateMissing(
  id: string,
  log: (line: string) => void = (line) => console.log(line),
): Promise<{ written: number; skipped: number; failed: number }> {
  const result = { written: 0, skipped: 0, failed: 0 };

  const doc = await getSubmission(id);
  if (!doc) {
    // Counted as a failure, not as nothing-to-do. `getSubmission` returns null
    // both for "no such document" and for "the store is unreachable", so a
    // mid-run Atlas outage would otherwise report `0 written, 0 failed` for
    // every remaining document — indistinguishable from a clean pass. That
    // happened on the first backfill run: six recipes were silently skipped
    // while the summary said everything else had succeeded.
    console.error(`[community] translate: submission ${id} not found, or the store is unreachable`);
    result.failed += 1;
    return result;
  }

  const source = doc.dish?.language ?? "";
  let targets: readonly SupportedLang[];
  if (source === "") {
    // The model could not tell what language this submission is written in
    // (the store's "" for an unrecognised script or mixture). No language is
    // then safe to leave untranslated, so all eight run, English included —
    // an explicit branch, not a comparison that happens to fall through.
    targets = SUPPORTED_LANGS;
  } else {
    targets = SUPPORTED_LANGS.filter((lang) => lang !== source);
  }

  const already = await translatedLangs(id);
  // Sequential, not parallel: eight concurrent calls against the same
  // submission is how a quota gets spent on one publish.
  for (const lang of targets) {
    if (already.includes(lang)) {
      log(`[community] translate ${id} -> ${lang}: already stored`);
      result.skipped += 1;
      continue;
    }
    const translated = await translateSubmission(doc.submission, lang);
    if (!translated) {
      console.error(`[community] translate ${id} -> ${lang}: failed`);
      result.failed += 1;
      continue;
    }
    const saved = await saveTranslation(id, translated);
    log(`[community] translate ${id} -> ${lang}: ${saved ? "saved" : "save failed"}`);
    if (saved) result.written += 1;
    else result.failed += 1;
  }
  return result;
}
