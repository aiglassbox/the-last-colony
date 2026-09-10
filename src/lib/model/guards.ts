import type { CorpusRecord } from "@/lib/corpus/types";

import { HEALTH_CLAIM_SOURCE } from "./health";
import { labTerms } from "./jargon";
import { CITATION_SHAPE_SOURCE, PROVENANCE_CLASS_SOURCE } from "./provenance";

/**
 * Post-hoc checks on generated prose.
 *
 * These do not gate the stream — the reader's actual protection is that the
 * badge, source strip and ingredient table are rendered from the record, so a
 * model claim can never become the citation on screen. What these do is make a
 * violation visible in the logs instead of silently shipping, because "the
 * model upgraded a provenance class" is the failure mode that ends the
 * campaign and it should never be discovered from a screenshot on X.
 */

/**
 * Shares its source with the stripper, on the same principle the health net
 * follows: what the one removes, the other reports. Before that, this audit was
 * the only thing standing between a typed class and the reader — it logged
 * `["ATTESTED"]` on a live upma card and the word shipped regardless.
 */
const CLASS_WORDS = new RegExp(PROVENANCE_CLASS_SOURCE, "gi");
/** Words that assert certainty a not-yet-verified record cannot support. */
const CERTAINTY_WORDS = /\b(attested|proven|confirmed|documented|verified)\b/gi;
/**
 * A chapter/verse/page shape the model was told never to type. Shares its
 * source with `stripCitationShapes`, so what the one removes the other reports.
 */
const CITATION_SHAPE = new RegExp(CITATION_SHAPE_SOURCE, "giu");
/**
 * A verdict on the reader's health, where rule 4 allows only a named axis.
 *
 * Shares its source with the stripper rather than keeping a second list. The
 * two had drifted: `stripHealthClaims` and this audit both knew "healthier" and
 * neither knew "aids digestion", so a claim that reached a card was not merely
 * unstripped, it was unlogged as well. What the one removes, the other reports.
 */
const HEALTH_WORDS = new RegExp(HEALTH_CLAIM_SOURCE, "giu");
/**
 * Attribution with nothing behind it. Harmless beside a record, because the
 * source strip renders the real one; on an empty card it is a citation the
 * reader has no way to check, and no badge appears to say so.
 */
const SOURCELESS_ATTRIBUTION =
  /\b((?:\w+[- ])?(?:century |ancient |old |early |medieval )?(?:court records|texts?|manuscripts?|records?|sources?|treatises?|manuals?)\s+(?:describe|mention|record|refer|say|note)s?)\b/gi;

/**
 * A grocery brand roll-call, which the sourcing section forbids.
 *
 * Matched on the SHAPE and not on a list of names, deliberately. A brand list
 * is open-ended — there are thousands of Indian food brands — so a net built
 * from names fails on coverage the day it ships and never stops needing
 * additions. The framing verb does not: a reply naming brands almost always
 * introduces them, and it introduces them in English even mid-Hinglish, so six
 * words catch the observed failure ("brands like Conscious Food, Organic
 * Tattva, or 24 Mantra Organic") in every language we answer in.
 *
 * It does not catch a brand smuggled in without the frame, and it is not meant
 * to. This logs only. The model reached for those names because the prompt gave
 * it none; now it has a real list and a closed-world rule, so the fix is
 * upstream and this is the instrument that says whether it held. If the log
 * proves it did not, the stripper that follows cuts the whole sentence — a
 * sentence built around a brand list has nothing left once the list is gone —
 * and it must share this source, and be added to BOTH seams, the stream's
 * `clean` in the chat route and `sanitiseCompletion`.
 */
const BRAND_ROLL_CALL =
  /\b(?:brands?|labels?|companies|makers?|marques?)\s+(?:like|such\s+as|including|include)\b/gi;

export interface ProseAudit {
  provenanceClaims: string[];
  certaintyClaims: string[];
  citationShapes: string[];
  healthClaims: string[];
  sourcelessAttributions: string[];
  /** Grocery brands offered as a list. One shop is named here, and it is ours. */
  brandRollCalls: string[];
  /**
   * Lab vocabulary with no safe plain equivalent, so `plainWords` leaves it
   * standing rather than paraphrasing the claim out from under it. Reported
   * here so the register drift is visible instead of silent.
   */
  labTerms: string[];
}

export function auditProse(text: string, records: CorpusRecord[]): ProseAudit {
  const unverified = records.some(
    (r) => r.tier === "ancient" && r.verification.status !== "editor_verified",
  );

  return {
    provenanceClaims: [...new Set(text.match(CLASS_WORDS) ?? [])],
    certaintyClaims: unverified ? [...new Set(text.match(CERTAINTY_WORDS) ?? [])] : [],
    citationShapes: [...new Set(text.match(CITATION_SHAPE) ?? [])],
    healthClaims: [...new Set(text.match(HEALTH_WORDS) ?? [])],
    // Only a concern with no record on screen. Beside one, the attribution is
    // the record's own and the source strip is already showing it.
    sourcelessAttributions: records.length
      ? []
      : [...new Set(text.match(SOURCELESS_ATTRIBUTION) ?? [])],
    brandRollCalls: [...new Set(text.match(BRAND_ROLL_CALL) ?? [])],
    labTerms: labTerms(text),
  };
}

export function isClean(audit: ProseAudit): boolean {
  return Object.values(audit).every((hits) => hits.length === 0);
}
