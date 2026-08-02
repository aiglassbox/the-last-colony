import type { Recipe } from "@pipeline/lib/types";

import type { CorpusRecord, Ingredient } from "./types";

/**
 * The seam between the app's corpus and the pipeline's index.
 *
 * Two corpora exist. `corpus/` holds 31 hand-authored records with everything a
 * full card needs: an editorial verdict, a modern counterpart to diff against, a
 * cook-tonight method, and a "why it was there" line on every ingredient.
 * `pipeline/` holds 199 recipes drawn from cited texts, indexed in Pinecone,
 * searchable by meaning rather than by name.
 *
 * The 199 are a wider net, not a richer record. Mapping one into a `CorpusRecord`
 * is therefore mostly a exercise in refusing to invent the fields it does not
 * have, because every one of those fields is rendered on screen as fact:
 *
 *   - `Ingredient.function` is "the column that does the teaching". A pipeline
 *     record has no such field, so it says so rather than guessing a reason a
 *     historical cook used an ingredient.
 *   - `substitution_story` and `modern_counterpart_id` drive the Then/Now diff
 *     and the nutrition delta. Absent, so null: the card simply omits them.
 *   - `share_verdict` is written by an editor precisely so the most
 *     screenshotted artefact is never generated. Absent, so null.
 *   - `restore_today` is a real tested method. Absent, so the card falls back to
 *     the model writing one, clearly framed as such.
 *
 * The result is a thinner card for these dishes. That is the honest rendering of
 * a thinner record, and it is a great deal better than the alternative these
 * records replace, which was "not in the restored corpus yet".
 */

/**
 * Provenance, mapped conservatively.
 *
 * All 199 pipeline records are `sourced-unverified` or
 * `sourced-needs-primary-check`; not one is `verified`. Rule 2 of AGENTS.md is
 * that an unverified record cannot claim ATTESTED, cannot carry
 * original-language text, and has its locus withheld from the model. So nothing
 * arriving through this path may present itself as attested, and the mapping
 * below is the enforcement rather than a convention.
 *
 * `verified` is handled anyway, because the day a record is promoted this should
 * already be correct rather than silently keep calling it reconstructed.
 */
function provenanceOf(recipe: Recipe): {
  provenance_class: CorpusRecord["provenance_class"];
  verification: CorpusRecord["verification"];
} {
  const verified = recipe.verification_status === "verified";
  return {
    // Even a verified pipeline record only gets RECONSTRUCTED: ATTESTED means
    // the verse is quoted on the card, and these records carry a citation
    // string, not a rendered passage.
    provenance_class: "RECONSTRUCTED",
    verification: {
      status: verified ? "editor_verified" : "unverified_seed",
      checked_by: null,
      checked_on: null,
      note: verified
        ? "Verified in the retrieval corpus."
        : recipe.verification_status === "sourced-needs-primary-check"
          ? "Sourced from a printed edition, but the primary text has not been checked. No verse or page is shown."
          : "Sourced but unverified: nobody has opened the printed edition against this record. No verse or page is shown.",
    },
  };
}

/**
 * A pipeline ingredient has an original name, a modern name and a quantity —
 * but no statement of what it was doing in the dish.
 *
 * `function` is not optional in the schema and the table renders it under "Why
 * it was there", so it cannot be left blank and must not be filled in. Saying
 * plainly that it is unrecorded is the only honest option; the reader learns
 * what the record does and does not contain.
 */
function ingredientOf(source: Recipe["ingredients"][number]): Ingredient {
  const original = source.original?.trim() ?? "";
  const modern = source.modern_name?.trim() ?? "";
  const quantity = source.quantity?.trim() ?? "";
  return {
    name: modern || original,
    sanskrit: original && original !== modern ? original : null,
    quantity_source: quantity || null,
    quantity_modern: null,
    function: "not recorded in this source",
  };
}

/**
 * Turns a retrieved recipe into the record the card renders.
 *
 * `slug` is the pipeline id, which is already kebab-case and stable — ids are
 * permanent by invariant 2 of ARCHITECTURE.md, which is exactly the property a
 * URL needs.
 */
export function toCorpusRecord(recipe: Recipe): CorpusRecord {
  const { provenance_class, verification } = provenanceOf(recipe);

  return {
    id: recipe.id,
    slug: recipe.id,
    dish_name_modern: recipe.name.english,
    dish_name_source: recipe.name.transliteration || recipe.name.original || null,
    aliases: recipe.aliases ?? [],
    share_verdict: null,
    tier: "ancient",
    source: {
      text: recipe.source.text,
      author: recipe.source.author || null,
      century: recipe.source.period,
      // Withheld: an unverified record must not show a verse or page. That is
      // a rule about *checked* references, not about provenance in general.
      locus: null,
      edition: null,
      page: null,
      // Always carried. Every one of the 199 has both, and a card that names a
      // text without saying where it came from or how to reach it is asking to
      // be taken on trust — which is the opposite of the point.
      citation: recipe.source.citation || null,
      url: recipe.source.url || null,
    },
    // An editor has not transcribed a passage for these. `name.original` is a
    // dish name in Devanagari, not source text, and putting it here would read
    // as a quoted original.
    original_text: null,
    transliteration: null,
    translation: null,
    ingredients: recipe.ingredients.map(ingredientOf),
    method_reconstructed: recipe.steps,
    provenance_class,
    // Not measured for these records. Mid values rather than invented
    // confidence; nothing in the UI reads them today.
    confidence: { identification: 0.5, ingredients: 0.5, method: 0.5 },
    contested_points: recipe.notes ? [recipe.notes] : [],
    modern_counterpart_id: null,
    substitution_story: null,
    restore_today: null,
    region: recipe.region || null,
    season: recipe.properties.season,
    vitalife_relevance: "none",
    verification,
  };
}

/** True when a record came from the index rather than `corpus/`. */
export function isVectorRecord(record: CorpusRecord): boolean {
  return record.restore_today === null && record.share_verdict === null;
}
