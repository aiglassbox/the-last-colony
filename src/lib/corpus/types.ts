/**
 * The corpus record. One JSON file per culinary item, under `corpus/`.
 *
 * This is Part 3 of the brief with one addition: `verification`. The brief's
 * red line #1 is a fabricated verse citation, and a hand-authored seed corpus
 * is exactly where one would enter. So every record declares whether a human
 * has checked its locus against the printed edition, and the validator refuses
 * to let an unverified record claim ATTESTED. The UI degrades accordingly —
 * see `SourceDrawer`.
 */

export type ProvenanceClass =
  | "ATTESTED" // verse exists and is quoted
  | "RECONSTRUCTED" // verse exists, gaps filled by food-history inference
  | "INFERRED" // no direct verse; built from period ingredient availability
  | "MODERN_DISH"; // no ancient original exists — component-level restoration only

export type Tier = "ancient" | "modern";

/** Whether a human has opened the printed edition and checked this locus. */
export type VerificationStatus = "editor_verified" | "unverified_seed";

export interface Verification {
  status: VerificationStatus;
  /** Who checked it, and against what. Null while unverified. */
  checked_by: string | null;
  /** ISO date of the check. Null while unverified. */
  checked_on: string | null;
  /** What still needs doing, in plain words. Shown in the source drawer. */
  note: string;
}

export interface Source {
  text: string;
  author: string | null;
  century: string;
  /** Chapter/verse reference, e.g. "Adhyāya 13 (Annabhoga), v. 47". */
  locus: string | null;
  edition: string | null;
  page: number | null;
  /**
   * A free-text reference to where the record came from, and a link to it.
   *
   * Distinct from `locus`, and the distinction is the whole point. A locus is a
   * checked chapter-and-verse an editor has opened the printed edition to
   * confirm, and an unverified record must not show one. A citation is simply
   * where this record was drawn from — it makes no claim to have been verified,
   * so it can and should be shown even while `locus` is withheld.
   *
   * Every record in the retrieval index carries both, and dropping them left a
   * card naming a text with no way for a reader to go and look.
   *
   * Optional because the 31 hand-authored records predate them.
   */
  citation?: string | null;
  url?: string | null;
}

export interface Ingredient {
  name: string;
  /** Source-language name where one is recorded. */
  sanskrit: string | null;
  /** Quantity as the source gives it, if it gives one at all. */
  quantity_source: string | null;
  /** Usable modern quantity. */
  quantity_modern: string | null;
  /** Why it was there. This is the column that does the teaching. */
  function: string;
}

export type NutritionDirection = "up" | "down" | "unchanged" | "mixed";

export interface SubstitutionChange {
  from: string;
  to: string;
  period: string;
  driver: string;
}

export interface SubstitutionStory {
  changed: SubstitutionChange[];
  /** Comparative axes only. Never a health claim. */
  nutrition_delta: Partial<
    Record<
      "protein" | "fibre" | "glycaemic_load" | "iron" | "calcium" | "fat_quality",
      NutritionDirection
    >
  >;
}

export interface RestoreToday {
  ingredients: string[];
  steps: string[];
  time_min: number;
}

export type VitalifeRelevance = "none" | "low" | "medium" | "high";

export interface CorpusRecord {
  id: string;
  /** URL slug. Drives /dish/[slug] and therefore the QR codes on the cans. */
  slug: string;
  dish_name_modern: string;
  dish_name_source: string | null;
  aliases: string[];
  /**
   * The verdict line for the share image, written by an editor.
   *
   * The 1080×1350 card is the artefact most likely to be screenshotted and
   * fact-checked, so nothing on it is generated. Deriving the headline from the
   * substitution story produced true but unquotable sentences; writing it once,
   * per record, keeps it both deterministic and sharp. Null falls back to the
   * derived line.
   */
  share_verdict: string | null;
  tier: Tier;
  source: Source;
  /** Devanagari / source script. Null until an editor transcribes it. */
  original_text: string | null;
  transliteration: string | null;
  translation: string | null;
  ingredients: Ingredient[];
  method_reconstructed: string[];
  provenance_class: ProvenanceClass;
  confidence: {
    identification: number;
    ingredients: number;
    method: number;
  };
  contested_points: string[];
  modern_counterpart_id: string | null;
  substitution_story: SubstitutionStory | null;
  restore_today: RestoreToday | null;
  region: string | null;
  season: string | null;
  vitalife_relevance: VitalifeRelevance;
  verification: Verification;
}

/** An ingredient swap, for the swap tool. Two swaps maximum per item, ranked. */
export interface SwapOption {
  swap: string;
  /** Actual usable numbers, e.g. "1 cup sugar → 3/4 cup grated jaggery". */
  ratio: string;
  /** Honest, including when the swap is worse. */
  taste_and_texture: string;
  /** One line, one named axis. Comparative only. */
  nutritional_rationale: string;
}

export interface SwapRecord {
  id: string;
  modern_item: string;
  aliases: string[];
  /** Ranked, best first. Maximum two. */
  options: SwapOption[];
  /** How the modern item displaced the old one. One line. */
  where_it_went: string;
}

/** What retrieval hands to the model. Never more than 3 records. */
export interface RetrievalResult {
  records: CorpusRecord[];
  /** The keyword score of the top match, for logging and threshold tuning. */
  top_score: number;
  matched_on: "alias" | "name" | "vector" | null;
  /** True when nothing cleared the threshold. The product says so out loud. */
  empty: boolean;
}
