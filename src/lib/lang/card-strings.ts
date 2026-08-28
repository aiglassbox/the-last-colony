import type { SupportedLang } from "./types";

import DATA from "./card-strings.data.json";

/**
 * Static UI chrome for the recordless restoration card (modern / gap / foreign).
 *
 * The record card gets its labels from the per-record localized store
 * (`localize:corpus`); a recordless card has no record, so its section labels,
 * table headers and "no ancestor" note fell back to English while the model's
 * prose was already in the reader's language. These are the fixed strings that
 * half needs, translated once per language by `localize:ui` and committed —
 * reviewed data, the same trust model as the corpus.
 *
 * Native script per language, keyed by `lang`. A record card never reads this.
 */

export type RecordlessKind = "modern" | "gap" | "foreign";
export type HistoryBeat = "THEN" | "WHAT_CHANGED" | "RESTORE_TODAY";

export interface CardStrings {
  /** The one-line "why no ancestor" note under the verdict, per kind. */
  note: Record<RecordlessKind, string>;
  /** Section headings, relabelled per kind (a modern dish has no "Then"). */
  title: Record<RecordlessKind, Record<HistoryBeat, string>>;
  /** ModernRecipe section headers. */
  ingredients: string;
  method: string;
  /** Ingredient-table headers on the recordless table. */
  ingredient: string;
  quantity: string;
  whyThisOne: string;
  /** NutritionDelta caption on a recordless card. */
  usualRestored: string;
}

export const EN_CARD_STRINGS: CardStrings = {
  note: {
    modern:
      "This one is younger than it tastes, so there is no older version to go back to. " +
      "What follows is a version built on older principles rather than taken from a text.",
    gap:
      "An Indian dish we have not written up yet. Nothing below is drawn from a text, " +
      "because we do not hold one for it.",
    foreign:
      "This one did not come from India, so there is no older version to find. Nothing " +
      "below is drawn from a text, and none is implied.",
  },
  title: {
    modern: {
      THEN: "What's in it",
      WHAT_CHANGED: "Where its parts came from",
      RESTORE_TODAY: "Cook it closer",
    },
    gap: {
      THEN: "What we can say",
      WHAT_CHANGED: "What likely changed",
      RESTORE_TODAY: "Cook it closer",
    },
    foreign: {
      THEN: "What's in it",
      WHAT_CHANGED: "Where its parts came from",
      RESTORE_TODAY: "Cook it closer",
    },
  },
  ingredients: "Ingredients",
  method: "Method",
  ingredient: "Ingredient",
  quantity: "Quantity",
  whyThisOne: "Why this one",
  usualRestored: "Usual → restored, by axis",
};

const TABLE = DATA as Partial<Record<SupportedLang, CardStrings>>;

/**
 * The card chrome for a language, English per field where a translation is
 * missing. English and the fallback language both get the English source, so a
 * partial or absent translation is only ever untranslated, never blank.
 */
export function cardStrings(lang: SupportedLang | undefined): CardStrings {
  const t = lang && lang !== "en" ? TABLE[lang] : undefined;
  if (!t) return EN_CARD_STRINGS;
  const E = EN_CARD_STRINGS;
  return {
    note: { ...E.note, ...t.note },
    title: {
      modern: { ...E.title.modern, ...t.title?.modern },
      gap: { ...E.title.gap, ...t.title?.gap },
      foreign: { ...E.title.foreign, ...t.title?.foreign },
    },
    ingredients: t.ingredients ?? E.ingredients,
    method: t.method ?? E.method,
    ingredient: t.ingredient ?? E.ingredient,
    quantity: t.quantity ?? E.quantity,
    whyThisOne: t.whyThisOne ?? E.whyThisOne,
    usualRestored: t.usualRestored ?? E.usualRestored,
  };
}
