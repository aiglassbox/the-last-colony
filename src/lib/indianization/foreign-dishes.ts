import { fold } from "@/lib/retrieval/normalize";

/**
 * Dishes that are not Indian in origin, named so retrieval can recognise one.
 *
 * Retrieval matches a dish name against the corpus, and "dosa pizza fusion"
 * matches dosa: one strong hit, nothing ambiguous about it, so the turn became
 * a RESTORATION and the card came up carrying the Dhosaka record, its source
 * strip and an ATTESTED badge, with the model's invented pizza sitting under
 * them. That is the one thing this project must never render. A fusion is not a
 * restoration of the Indian half, and the corpus record is not evidence for it.
 *
 * So a query naming any of these is never a restoration, whatever else it
 * names. It goes to the resolver, which has the Indianisation card and no badge
 * to put on it.
 *
 * This is a separate list from the component roles in `rules.json` on purpose.
 * Those name parts, and their `foreign` arrays are full of words that are not
 * dishes and not foreign in an Indian kitchen: butter, cheese, sugar, bread,
 * noodles, oil. Matching on those would take "butter chicken" out of the corpus.
 * Only whole dishes belong here, and only ones no one would call Indian.
 */
export const FOREIGN_DISHES = [
  // Italian
  "pizza", "pasta", "spaghetti", "macaroni", "lasagna", "lasagne", "risotto",
  "ravioli", "penne", "carbonara", "tiramisu", "bruschetta", "focaccia",
  // American
  "burger", "cheeseburger", "hamburger", "hot dog", "corn dog", "fries",
  "french fries", "nuggets", "mac and cheese", "meatloaf", "brownie",
  "cheesecake", "pancake", "waffle", "donut", "doughnut", "bagel", "muffin",
  "cupcake", "milkshake", "sundae", "coleslaw", "caesar salad",
  // Mexican
  "taco", "burrito", "quesadilla", "fajita", "nachos", "enchilada", "guacamole",
  // Japanese, Korean, south-east Asian
  "sushi", "maki", "sashimi", "ramen", "tempura", "teriyaki", "gyoza", "wonton",
  "pho", "pad thai", "kimchi", "bibimbap", "miso soup",
  // European and west Asian
  "croissant", "baguette", "quiche", "crepe", "paella", "hummus", "falafel",
  "shawarma", "doner", "gyro", "couscous", "pita", "tortilla", "burrata",
  "garlic bread", "spring roll", "sandwich", "panini", "gelato", "ice cream",
  // Packaged and cereal-aisle foreign staples
  "cornflakes", "granola", "muesli", "oats", "quinoa",
] as const;

/**
 * Phrases first, so "ice cream" is recognised before "cream" could be, and so
 * the longest name wins when two overlap ("french fries" over "fries").
 */
const SORTED = [...FOREIGN_DISHES].sort((a, b) => b.length - a.length);

/**
 * The foreign dish a query names, or null.
 *
 * Whole words only, on the same fold retrieval uses, so punctuation and case
 * are already gone and "Dosa + Pizza fusion" is matched exactly as "dosa pizza
 * fusion" would be. A trailing "s" is allowed because a reader types "tacos".
 */
export function namesForeignDish(query: string): string | null {
  const folded = ` ${fold(query)} `;
  for (const dish of SORTED) {
    if (folded.includes(` ${dish} `) || folded.includes(` ${dish}s `)) return dish;
  }
  return null;
}
