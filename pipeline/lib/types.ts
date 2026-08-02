/** Mirrors the record schema documented in data/README.md. */

export type VerificationStatus =
  | 'sourced-unverified'
  | 'sourced-needs-primary-check'
  | 'verified';

export interface Ingredient {
  original: string;
  modern_name: string;
  quantity: string;
}

export interface Recipe {
  id: string;
  /** Modern / colloquial search names so queries like "idli" match "iddarika". */
  aliases?: string[];
  name: {
    original: string;
    transliteration: string;
    english: string;
  };
  source: {
    text: string;
    author: string;
    period: string;
    citation: string;
    url: string;
  };
  region: string;
  category: string;
  ingredients: Ingredient[];
  steps: string[];
  properties: {
    ayurvedic: string | null;
    occasion: string | null;
    season: string | null;
  };
  notes: string | null;
  verification_status: VerificationStatus;
}

/**
 * Tier 2 — modern Indian dishes imported in bulk (e.g. the Kaggle
 * "6000+ Indian Food Recipes" set). NOT authentic ancient recipes: these are
 * the "before" that the substitution rules transform into a healthier "after".
 * `source: 'modern'` and `tier: 2` keep them permanently separable from the
 * Tier-1 corpus so they can never be retrieved or presented as historical.
 */
export interface ModernDish {
  id: string;                 // "modern-<slug>"
  tier: 2;
  source: 'modern';
  dataset: string;            // provenance of the bulk import
  name: string;
  aliases: string[];
  cuisine: string | null;
  course: string | null;
  diet: string | null;
  total_time_mins: number | null;
  servings: number | null;
  ingredients: string[];      // flat modern ingredient list
  steps: string[];
  url: string | null;         // original recipe URL (attribution)
  rich_flags: string[];       // rich/unhealthy elements detected in the dish
  substitution_ids: string[]; // candidate rules from data/substitutions.json
}

/**
 * Tier 3 — one component-role mapping (data/indianization.json).
 * Foreign dishes are infinite, so we never map whole dishes; we map the finite
 * set of component ROLES every dish decomposes into. Gemini decomposes the dish
 * at query time; these rules supply the Indian, healthier equivalent per part.
 */
export interface IndianizationRule {
  id: string;
  /** base | dairy | sauce | fat | sweetener | protein | thickener | technique | flavor */
  role: string;
  foreign: string[];         // trigger terms matched against a decomposed component
  indian_healthy: string[];  // Indian, healthier equivalents to compose from
  technique_swap: string | null;
  rationale: string;
  derived_from: string[];    // substitution rule ids this builds on
  verification_status: string;
}

/** A single healthier-swap rule (data/substitutions.json). */
export interface Substitution {
  id: string;
  replace: string;
  with: string;
  triggers: string[];
  rationale: string;
  ayurvedic_basis: string;
  source: { text: string; url: string | null };
  applies_to_tiers: number[];
  verification_status: string;
}

/**
 * What we store on the Pinecone vector.
 *
 * Pinecone metadata only accepts strings, numbers, booleans, and string
 * arrays — no nested objects. So the queryable fields are flattened to the top
 * level, and the full nested record rides along as a JSON string in `record`.
 * Max record here is ~1.8 KB against Pinecone's 40 KB/vector metadata limit,
 * so retrieval returns the whole recipe without a second datastore.
 */
export interface RecipeMetadata {
  [key: string]: string | number | boolean | string[];
  record: string;
  content_hash: string;

  name_english: string;
  name_transliteration: string;
  source_text: string;
  author: string;
  period: string;
  citation: string;
  url: string;
  region: string;
  category: string;
  verification_status: string;
  /** Modern ingredient names — filterable with `$in`. */
  ingredients_modern: string[];
}
