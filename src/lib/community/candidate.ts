import type { CorpusRecord, Ingredient } from "../corpus/types";
import type { StoredSubmission } from "./client";

/**
 * A GREEN submission in the corpus record's shape, for hand incorporation.
 *
 * Humans remain the only writers of corpus files; this is copy-shape work, not
 * a promotion. Three things are fixed by construction and pinned by the check
 * script: it can never claim ATTESTED (a family recipe is a modern dish with
 * no ancient original), it carries no original-language text (repo rule 2 —
 * an unverified record cannot), and the submitter's contact never leaves the
 * pantry — a corpus file is public. The photo stays in the store too; the
 * corpus has no field for it and the community card serves it from there.
 */
export type CorpusCandidate = CorpusRecord & {
  community: {
    display_name: string;
    belongs_to: string;
    belongs_to_other: string | null;
    story: string;
    state: string;
    city: string | null;
    language: string;
    mode: "manual" | "image";
    submitted_at: string;
    verdict_model: string | null;
    submission_id: string;
  };
};

/** One entry per non-blank line, leading bullets and step numbers removed. */
function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}

export function toCorpusCandidate(doc: StoredSubmission): CorpusCandidate {
  const s = doc.submission;
  const tag = doc.dish?.tag || "untagged";
  const short = doc.id.slice(-6);
  const ingredients: Ingredient[] = lines(s.ingredients).map((name) => ({
    name,
    sanskrit: null,
    quantity_source: null,
    quantity_modern: null,
    function: "",
  }));

  return {
    id: `community-${tag}-${short}`,
    slug: `${tag}-community-${short}`,
    dish_name_modern: s.recipe_name,
    dish_name_source: null,
    aliases: doc.dish?.aliases ?? [],
    share_verdict: null,
    tier: "modern",
    source: {
      text: "Community submission",
      author: s.display_name,
      century: "21st",
      locus: null,
      edition: null,
      page: null,
      citation: `Submitted to The Kranti Cookbook by ${s.display_name}, ${s.state}${s.city ? `, ${s.city}` : ""}`,
      url: null,
    },
    original_text: null,
    transliteration: null,
    translation: null,
    ingredients,
    method_reconstructed: lines(s.method),
    provenance_class: "MODERN_DISH",
    confidence: { identification: 0, ingredients: 0, method: 0 },
    contested_points: [],
    modern_counterpart_id: null,
    substitution_story: null,
    restore_today: null,
    region: s.state,
    season: null,
    vitalife_relevance: "none",
    verification: {
      status: "unverified_seed",
      checked_by: null,
      checked_on: null,
      note: "Community submission. Verify before any provenance claim; never ATTESTED.",
    },
    community: {
      display_name: s.display_name,
      belongs_to: s.belongs_to,
      belongs_to_other: s.belongs_to_other ?? null,
      story: s.story,
      state: s.state,
      city: s.city ?? null,
      language: s.language,
      mode: doc.mode,
      submitted_at: doc.created_at.toISOString(),
      verdict_model: doc.verdict?.model ?? null,
      submission_id: doc.id,
    },
  };
}
