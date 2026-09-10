import { lines } from "./candidate";
import type { CommunityMatch } from "./match";
import { BELONGS_TO } from "./schema";

/**
 * What a reader is allowed to see, as a type. Mapped from `CommunityMatch`
 * (`./match.ts`), which is already a projection — `contact` is not a field on
 * it, so it cannot leak here by omission going missing later; the sweep in
 * `scripts/check-community-match.ts` pins that by walking the serialized
 * payload rather than trusting the type alone.
 *
 * The model writes no part of this card: `other_states` is built in code from
 * the match list, and every string below is either stored text or its
 * translation, never a completion.
 */
export interface CommunityCardData {
  /** Hex document id. Builds the photo URL; nothing else uses it. */
  id: string;
  dish_tag: string;
  recipe_name: string;
  display_name: string;
  /** The label form, e.g. "Grandmother", or the free-text belongs_to_other. */
  belongs_to: string;
  state: string;
  city: string | null;
  story: string;
  ingredients: string[];
  method: string[];
  /** ISO 639-1 of the text above, or null. Drives the lang attribute. */
  language: string | null;
  /** Set only when the text above is a machine translation. Carries the
   *  submitter's own words so the card's "show original" needs no fetch. */
  translated_from: {
    /** The row's own source language — `string | null`, not `string`: the
     *  store writes "" when the model could not tell what language a
     *  submission was written in, and `CommunityMatch.language` normalises
     *  that to null. A row with an unknown source can still be translated
     *  into a reader's language (Task 6), and its original text must still
     *  render here — just with no `lang` attribute, exactly like the
     *  top-level `language` field above. */
    language: string | null;
    recipe_name: string;
    story: string;
    ingredients: string[];
    method: string[];
  } | null;
  photo_url: string | null;
  submitted_at: string;
  /** Other states this dish came in from. Template-rendered, never model-written. */
  other_states: string[];
  total: number;
}

/**
 * A translated copy of a submission's text. Defined here rather than in
 * `translate.ts` because this is where it is first consumed: Task 6 imports it
 * to produce one, and this task's mapper accepts one. Fields carry the same
 * shape the submission stores, so `lines()` splits a translation exactly as it
 * splits an original.
 */
export interface TranslatedFields {
  lang: string;
  recipe_name: string;
  story: string;
  ingredients: string;
  method: string;
  model: string;
}

/**
 * `belongs_to` maps through `BELONGS_TO` to its label. The free-text answer
 * wins when the value is "other" — checked first, ahead of the table, because
 * `BELONGS_TO` itself carries an "other" entry whose label ("Other…") is not
 * what a reader should see. A legacy document carrying something unlisted
 * renders its own raw value rather than disappearing.
 */
function belongsToLabel(value: string, other: string | undefined): string {
  if (value === "other") return other || value;
  return BELONGS_TO.find((b) => b.value === value)?.label ?? value;
}

/**
 * Pure, no Mongo vocabulary. `contact` is not in scope because it takes the
 * already-projected match — the PII was never fetched, not merely omitted.
 *
 * `translation` non-null puts the translated text on top and the submitter's
 * own words into `translated_from`, tagged with the row's own source
 * language (possibly null). `translation` null leaves the original on top and
 * `translated_from` null.
 */
export function toCommunityCard(
  match: CommunityMatch,
  others: string[],
  total: number,
  translation: TranslatedFields | null,
): CommunityCardData {
  const s = match.submission;
  const original = {
    recipe_name: s.recipe_name,
    story: s.story,
    ingredients: lines(s.ingredients),
    method: lines(s.method),
  };

  return {
    id: match.id,
    dish_tag: match.dish.tag,
    recipe_name: translation ? translation.recipe_name : original.recipe_name,
    display_name: s.display_name,
    belongs_to: belongsToLabel(s.belongs_to, s.belongs_to_other),
    state: match.state,
    city: s.city ?? null,
    story: translation ? translation.story : original.story,
    ingredients: translation ? lines(translation.ingredients) : original.ingredients,
    method: translation ? lines(translation.method) : original.method,
    language: translation ? translation.lang : match.language,
    translated_from: translation ? { language: match.language, ...original } : null,
    photo_url: s.photo ? `/api/community/photo/${match.id}` : null,
    submitted_at: match.created_at.toISOString(),
    other_states: others,
    total,
  };
}
