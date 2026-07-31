/**
 * Tier 3 — Indianisation.
 *
 * The corpus restores Indian dishes to their pre-colonial form, and component
 * restoration handles modern Indian dishes with no ancient original. Neither
 * covers a dish that is not Indian at all — a pizza, a pasta, a burger.
 *
 * For those, there is nothing to restore, so we do not pretend to. Instead we
 * rebuild the dish from Indian, healthier components — but only from the
 * mappings below, the same way component restoration only quotes real swap
 * ratios. The model decomposes the dish; this map supplies every Indian part it
 * is allowed to use. A fabricated "Indian equivalent" is the same class of
 * failure as a fabricated verse.
 *
 * This lives outside `corpus/` on purpose: it is not a restoration record and
 * must not pass through the corpus loader or its validator.
 */
import rulesJson from "./rules.json";

export interface IndianizationRule {
  id: string;
  /** base | dairy | sauce | fat | sweetener | protein | thickener | technique | flavor */
  role: string;
  foreign: string[];
  indian_healthy: string[];
  technique_swap: string | null;
  rationale: string;
  derived_from: string[];
  verification_status: string;
}

export const INDIANIZATION_RULES = rulesJson as IndianizationRule[];

/**
 * Dishes we will Indianise rather than restore. Deliberately explicit and
 * conservative: an unknown *Indian* dish must never land here — it falls
 * through to component restoration, per the repo's decline-don't-guess rule.
 * Words that double as Indian dish names (roll, wrap, cutlet) are left out.
 */
const FOREIGN_DISHES = [
  "pizza", "pasta", "spaghetti", "macaroni", "lasagna", "lasagne", "risotto",
  "burger", "cheeseburger", "hamburger", "hot dog", "hotdog", "sandwich", "panini",
  "taco", "burrito", "quesadilla", "fajita", "nachos", "enchilada",
  "sushi", "maki", "ramen", "miso soup", "udon", "pad thai",
  "chow mein", "chowmein", "hakka noodles", "fried rice", "manchurian", "spring roll",
  "french fries", "fries", "mashed potato", "garlic bread", "coleslaw",
  "donut", "doughnut", "bagel", "croissant", "muffin", "cupcake", "pancake", "waffle", "crepe",
  "mac and cheese", "macaroni cheese", "falafel", "hummus", "shawarma", "gyro", "doner",
  "milkshake", "smoothie bowl", "quiche", "cornflakes", "cereal",
  "dumpling", "gyoza", "wonton", "momo", "cheesecake",
];

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the query names a dish of non-Indian origin. Multi-word names match
 * as a substring; single words match a whole token, so "pizza" fires but
 * "subzi" never matches "sub"-anything.
 */
export function isForeignDish(query: string): boolean {
  const q = fold(query);
  if (!q) return false;
  // Token set plus a naive singular of each token, so "tacos" matches "taco"
  // and "burgers" matches "burger" without loosening to substring matching.
  const forms = new Set<string>();
  for (const t of q.split(" ")) {
    forms.add(t);
    if (t.length > 3 && t.endsWith("s")) forms.add(t.slice(0, -1));
  }
  return FOREIGN_DISHES.some((d) => {
    const df = fold(d);
    return df.includes(" ") ? q.includes(df) : forms.has(df);
  });
}

/**
 * The map the model is handed on an Indianisation turn — the Tier-3 analogue of
 * `renderComponentSwaps`. Compact prose, not JSON, so the model maps against it
 * rather than restating it.
 */
export function renderIndianizationBlock(rules: IndianizationRule[] = INDIANIZATION_RULES): string {
  const body = rules
    .map((r) => {
      const technique = r.technique_swap ? `\n    technique: ${r.technique_swap}` : "";
      return (
        `  <component role="${r.role}">\n` +
        `    foreign: ${r.foreign.join(", ")}\n` +
        `    indian_healthy: ${r.indian_healthy.join(" | ")}` +
        `${technique}\n` +
        `  </component>`
      );
    })
    .join("\n");

  return (
    "<indianization_map>\n" +
    "These are the ONLY component substitutions you may use to Indianise a " +
    "foreign dish. Decompose the dish into its parts, map each part to an option " +
    "here, and rebuild from those. Do not invent an Indian equivalent that is not " +
    "in this map; if a part has no entry, say so rather than guessing.\n" +
    `${body}\n` +
    "</indianization_map>"
  );
}
