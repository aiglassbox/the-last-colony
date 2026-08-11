import type { CorpusRecord } from "@/lib/corpus/types";

import { HEALTH_CLAIM_SOURCE } from "./health";
import { labTerms } from "./jargon";
import { PROVENANCE_CLASS_SOURCE } from "./provenance";

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
/** A chapter/verse/page shape the model was told never to type. */
const CITATION_SHAPE =
  /\b(adhy[āa]ya|chapter|verse|v\.\s*\d|p{1,2}\.\s*\d|page\s+\d|folio)\b/gi;
/**
 * A verdict on the reader's health, where rule 4 allows only a named axis.
 *
 * Shares its source with the stripper rather than keeping a second list. The
 * two had drifted: `stripHealthClaims` and this audit both knew "healthier" and
 * neither knew "aids digestion", so a claim that reached a card was not merely
 * unstripped, it was unlogged as well. What the one removes, the other reports.
 */
const HEALTH_WORDS = new RegExp(HEALTH_CLAIM_SOURCE, "gi");
/**
 * Attribution with nothing behind it. Harmless beside a record, because the
 * source strip renders the real one; on an empty card it is a citation the
 * reader has no way to check, and no badge appears to say so.
 */
const SOURCELESS_ATTRIBUTION =
  /\b((?:\w+[- ])?(?:century |ancient |old |early |medieval )?(?:court records|texts?|manuscripts?|records?|sources?|treatises?|manuals?)\s+(?:describe|mention|record|refer|say|note)s?)\b/gi;

export interface ProseAudit {
  provenanceClaims: string[];
  certaintyClaims: string[];
  citationShapes: string[];
  healthClaims: string[];
  sourcelessAttributions: string[];
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
    labTerms: labTerms(text),
  };
}

export function isClean(audit: ProseAudit): boolean {
  return Object.values(audit).every((hits) => hits.length === 0);
}
