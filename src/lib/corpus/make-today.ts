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
 * Which displaced ingredients the cook should hold on to.
 *
 * **Not every displacement is a loss, and this is the safety rule.** Rock salt
 * gave way to iodised salt through a public-health programme that corrected a
 * real deficiency, and solid fuel gave way to LPG because its smoke causes
 * respiratory disease. Both entries carry `direction: "up"` and a caution
 * saying so. Feeding them through a "keep the traditional side" instruction
 * would tell a reader to avoid iodised salt and cook on charcoal, which is
 * advice that harms people.
 *
 * So only a displacement that actually went the wrong way — `direction: "down"`,
 * and no caution attached — becomes something to preserve.
 */
export function keepTraditional(recipe: Recipe): Array<{ keep: string; not: string }> {
  const haystack = recipe.ingredients
    .map((i) => `${i.modern_name ?? ""} ${i.original ?? ""}`.toLowerCase())
    .join(" | ");

  return DISPLACEMENTS.filter(
    (d) =>
      d.direction === "down" &&
      !d.caution &&
      d.matches.some((m) => haystack.includes(m.toLowerCase())),
  ).map((d) => ({ keep: d.traditional, not: d.replaced_by }));
}

/** Archaic methods in this recipe's steps, and how to do them now. */
export function translateTechniques(recipe: Recipe): Technique[] {
  const steps = recipe.steps.join(" ").toLowerCase();
  return TECHNIQUES.filter((t) => t.matches.some((m) => steps.includes(m.toLowerCase())));
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
