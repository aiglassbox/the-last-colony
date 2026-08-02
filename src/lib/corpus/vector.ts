import displacementData from "@pipeline/data/displacements.json";
import type { Recipe } from "@pipeline/lib/types";
import { stripEmDashes } from "@/lib/model/punctuation";
import { makeToday, matchesIngredient } from "./make-today";

import type { CorpusRecord, Ingredient } from "./types";

interface Displacement {
  id: string;
  traditional: string;
  matches: string[];
  replaced_by: string;
  when: string;
  driver: string;
  nutrition_axis: string;
  direction: string;
  /** Present only on changes that were gains. See `keepTraditional`. */
  caution?: string;
}

const DISPLACEMENTS = (displacementData as { displacements: Displacement[] }).displacements;

/**
 * The seam between the app's corpus and the pipeline's index.
 *
 * Two corpora exist. `corpus/` holds 31 hand-authored records with everything a
 * full card needs: an editorial verdict, a modern counterpart to diff against, a
 * cook-tonight method, and a "why it was there" line on every ingredient.
 * `pipeline/` holds 199 recipes drawn from cited texts, indexed in Pinecone,
 * searchable by meaning rather than by name.
 *
* The 199 are a wider net. Mapping one into a `CorpusRecord`
 * is therefore mostly a exercise in refusing to invent the fields it does not
 * have, because every one of those fields is rendered on screen as fact:
 *
 *   - `Ingredient.function` is "the column that does the teaching". A pipeline
 *     record has no such field, so it says so rather than guessing a reason a
 *     historical cook used an ingredient.
 *   - `modern_counterpart_id` drives the Then/Now ingredient diff. Absent, so
 *     null: the card omits it. `substitution_story` is the exception — it is
 *     derived from `displacements.json`, where each claim carries a source.
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
  const name = modern || original;

  return {
    name: stripEmDashes(clarifyPeriodForm(name)),
    sanskrit: original && original !== modern ? original : null,
    quantity_source: quantity || null,
    quantity_modern: null,
    function: "not recorded in this source",
  };
}

/**
 * Names the form an ingredient took when the record was written.
 *
 * A sixteenth-century text says "sugar", and a reader in 2026 pictures the
 * white stuff in a supermarket bag. By our own sourced entry, mill-refined
 * white sugar does not exist at scale until the late nineteenth century, so
 * that word cannot mean what it now means. The card was printing "sugar" in the
 * ingredient table and "keep gur, not white sugar" three beats below, and
 * contradicting itself in front of the reader.
 *
 * This is not a substitution. It is a translation of a word whose referent
 * moved, and it only fires where a displacement documents that move — and only
 * for the losses, since "rock salt" needs no clarifying and must never be
 * nudged away from iodised salt.
 */
/**
 * Not every displacement is a word whose referent moved.
 *
 * "pulses as a daily staple" and "millets and other coarse grains" describe what
 * was on the plate, not what an ingredient was. Appending one to an ingredient
 * name produced "mung dal, urad dal, or chana dal (split, hulled) (pulses as a
 * daily staple in this period)", which is both unreadable and not true of the
 * ingredient. A period form is a name, so a phrase is not one.
 */
const MAX_FORM_WORDS = 4;

function isPeriodForm(traditional: string): boolean {
  return traditional.split(/[(—,]/)[0].trim().split(/\s+/).length <= MAX_FORM_WORDS;
}

function clarifyPeriodForm(name: string): string {
  const lower = name.toLowerCase();
  for (const d of DISPLACEMENTS) {
    if (d.caution) continue;
    if (!isPeriodForm(d.traditional)) continue;
    if (!matchesIngredient(lower, d.matches)) continue;
    // Already specific enough — the record said "sesame oil", not "oil".
    const traditional = d.traditional.split(/[—(]/)[0].trim();
    if (lower.includes(traditional.toLowerCase().split(" ")[0])) return name;
    // Brackets rather than a dash. This string is an ingredient name in a table
    // cell, and rule 7 applies to it exactly as it applies to prose: the
    // sanitiser only sees model output, so anything built here reaches the
    // reader unfiltered.
    return `${name} (${traditional} in this period)`;
  }
  return name;
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
    // House style applies to these, and only to these. Ingredient names, steps
    // and notes are editorial English written for this corpus, so rule 7 covers
    // them like any other line we put on screen. A quoted passage would not be
    // touched, and there is none here: `original_text`, `transliteration` and
    // `translation` are null for every pipeline record by design.
    method_reconstructed: recipe.steps.map(stripEmDashes),
    provenance_class,
    // Not measured for these records. Mid values rather than invented
    // confidence; nothing in the UI reads them today.
    confidence: { identification: 0.5, ingredients: 0.5, method: 0.5 },
    contested_points: recipe.notes ? [stripEmDashes(recipe.notes)] : [],
    modern_counterpart_id: null,
    substitution_story: substitutionStoryOf(recipe),
    restore_today: null,
    make_today_notes: (() => {
      const mt = makeToday(recipe);
      if (!mt) return null;
      return {
        keep: mt.keep,
        techniques: mt.techniques.map((t) => ({
          archaic: t.archaic,
          modern: t.modern,
          keep: t.keep,
        })),
      };
    })(),
    region: recipe.region || null,
    season: recipe.properties.season,
    vitalife_relevance: "none",
    verification,
  };
}

/**
 * The WHAT CHANGED beat, derived from the record's own ingredients.
 *
 * These 199 records document how a dish was made and say nothing about what
 * happened to it since — which is two thirds of the product missing. Writing
 * that per dish is 199 research jobs; writing it per *ingredient* is eight,
 * because the corpus is concentrated (ghee appears in 98 recipes, sugar in 76).
 *
 * So `data/displacements.json` holds one sourced narrative per displaced
 * ingredient, and this matches them against what the recipe actually contains.
 * Every claim on the card traces to an entry with a citation and a URL. Nothing
 * is inferred here, which is the point: three attempts at deriving this
 * automatically — name overlap, ingredient overlap, reverse-matching the swap
 * rules — all produced confident nonsense like "lotus buds displaced by
 * caffeinated soft drinks".
 *
 * `nutrition_delta` only carries axes the schema defines. The salt entry names
 * iodine, which is not one of them and which moved *up* — a public-health gain,
 * not a loss — so it contributes a change without a delta rather than being
 * bent into the decline narrative.
 */
const DELTA_AXES = new Set([
  "protein",
  "fibre",
  "glycaemic_load",
  "iron",
  "calcium",
  "fat_quality",
]);

function substitutionStoryOf(recipe: Recipe): CorpusRecord["substitution_story"] {
  const haystack = recipe.ingredients
    .map((i) => `${i.modern_name ?? ""} ${i.original ?? ""}`.toLowerCase())
    .join(" | ");

  // Word boundaries, not substrings: "dal" otherwise matches "kadalikanda".
  // Shared with `make-today.ts` so the two derivations cannot disagree about
  // which displacements apply to the same dish.
  const applicable = DISPLACEMENTS.filter((d) => matchesIngredient(haystack, d.matches));
  if (applicable.length === 0) return null;

  const nutrition_delta: Record<string, string> = {};
  for (const d of applicable) {
    if (DELTA_AXES.has(d.nutrition_axis)) nutrition_delta[d.nutrition_axis] = d.direction;
  }

  return {
    changed: applicable.map((d) => ({
      from: d.traditional,
      to: d.replaced_by,
      period: d.when,
      driver: d.driver,
    })),
    nutrition_delta: nutrition_delta as CorpusRecord["substitution_story"] extends null
      ? never
      : NonNullable<CorpusRecord["substitution_story"]>["nutrition_delta"],
  };
}

/**
 * True when a record came from the index rather than `corpus/`.
 *
 * Not "has no verdict and no method": every `*-modern` counterpart in `corpus/`
 * is null on both, so that test called 14 of the 31 hand-authored records
 * imported. What actually separates the two is the citation URL, which the
 * mapper always carries through and no hand-authored record has.
 */
export function isVectorRecord(record: CorpusRecord): boolean {
  return Boolean(record.source.url);
}
