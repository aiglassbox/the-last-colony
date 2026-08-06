import displacementData from "@pipeline/data/displacements.json";
import techniqueData from "@pipeline/data/techniques.json";
import type { Recipe } from "@pipeline/lib/types";

/**
 * MAKE TODAY, assembled rather than invented.
 *
 * The beat is not a new recipe. It is the same ancestral dish cooked in a
 * modern kitchen: the ingredients stay as the record gives them, and only the
 * method is translated — equipment that no longer exists, technology that makes
 * it convenient, and a substitute only where something is genuinely gone.
 *
 * Three tables do the work, and none of them is guesswork:
 *   - `displacements.json` says which ingredient to keep and which modern
 *     default to avoid. This is where the health lives: ghee rather than
 *     vanaspati, gur rather than refined sugar.
 *   - `techniques.json` maps an archaic method to a modern one — charcoal to a
 *     gas flame, a grinding stone to a mixer, ambient warmth to an oven light.
 *   - the record's own ingredients and steps, unchanged.
 *
 * What is deliberately absent is quantities. Ten records carry real proportions
 * ("one-eighth part rice to one-twelfth part mudga"); the rest say "to cook"
 * and "for boiling", which are instructions rather than amounts. Inventing
 * numbers to fill that gap would be writing recipes and calling them history,
 * so the beat gives method and leaves amounts to the cook or to an editor.
 */

interface Displacement {
  id: string;
  traditional: string;
  matches: string[];
  replaced_by: string;
  direction: string;
  caution?: string;
}

interface Technique {
  id: string;
  archaic: string;
  matches: string[];
  modern: string;
  keep?: string;
  convenience?: string;
}

const DISPLACEMENTS = (displacementData as { displacements: Displacement[] }).displacements;
const TECHNIQUES = (techniqueData as { techniques: Technique[] }).techniques;

/**
 * Matching that does not fire inside other words.
 *
 * Plain `includes` found "dal" in "kadalikanda" — the Sanskrit for banana
 * rhizome — and told a reader to keep the pulses in a dish that has none. Every
 * table in this project has now been bitten by substring matching at least
 * once, so the boundaries are explicit.
 *
 * `whole` for ingredients, where every term is a complete word. Prefix-only for
 * techniques, where terms like "deep-fr" and "fumigat" are deliberately partial
 * so they catch "deep-fried" and "fumigating".
 */
export function matchesIngredient(haystack: string, terms: string[]): boolean {
  return matches(haystack, terms, "whole");
}

function matches(haystack: string, terms: string[], mode: "whole" | "prefix"): boolean {
  return terms.some((term) => {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = mode === "whole" ? `\\b${escaped}\\b` : `\\b${escaped}`;
    return new RegExp(pattern, "i").test(haystack);
  });
}

/**
 * Which displaced ingredients the cook should hold on to.
 *
 * **Not every displacement is a loss, and this is the safety rule.** Rock salt
 * gave way to iodised salt through a public-health programme that corrected a
 * real deficiency, and solid fuel gave way to LPG because its smoke causes
 * respiratory disease. Telling a reader to reverse either is advice that harms
 * them, so both are excluded.
 *
 * The test is the presence of a `caution`, which is what that field marks. It
 * is emphatically **not** `direction`, which only says which way a nutrition
 * axis moved and means opposite things on different axes: fat quality went
 * *down* with vanaspati and glycaemic load went *up* with refined sugar, and
 * both are losses. Filtering on `direction === "down"` silently dropped the
 * sugar guidance from every sweet dish in the corpus — 76 recipes — because its
 * axis happens to point the other way.
 */
export function keepTraditional(recipe: Recipe): Array<{ keep: string; not: string }> {
  const haystack = recipe.ingredients
    .map((i) => `${i.modern_name ?? ""} ${i.original ?? ""}`.toLowerCase())
    .join(" | ");

  return DISPLACEMENTS.filter(
    (d) => !d.caution && matches(haystack, d.matches, "whole"),
  ).map((d) => ({ keep: d.traditional, not: d.replaced_by }));
}

/** Archaic methods in this recipe's steps, and how to do them now. */
export function translateTechniques(recipe: Recipe): Technique[] {
  const steps = recipe.steps.join(" ").toLowerCase();
  return TECHNIQUES.filter((t) => matches(steps, t.matches, "prefix"));
}

export interface MakeToday {
  /** The record's own method, unchanged — the thing being translated. */
  historicalSteps: string[];
  /** Ingredients to keep in their traditional form, and what to avoid. */
  keep: Array<{ keep: string; not: string }>;
  /** Archaic techniques with a modern equivalent. */
  techniques: Technique[];
  /** True when the record states real proportions rather than "to cook". */
  hasProportions: boolean;
}

/** Everything needed to cook the dish tonight, minus the amounts. */
export function makeToday(recipe: Recipe): MakeToday | null {
  const keep = keepTraditional(recipe);
  const techniques = translateTechniques(recipe);
  if (keep.length === 0 && techniques.length === 0) return null;

  return {
    historicalSteps: recipe.steps,
    keep,
    techniques,
    hasProportions: recipe.ingredients.some((i) =>
      /\d\s*\/\s*\d|one-(eighth|twelfth|fourth|third|half|sixteenth)|\bpart\b/i.test(
        i.quantity ?? "",
      ),
    ),
  };
}
