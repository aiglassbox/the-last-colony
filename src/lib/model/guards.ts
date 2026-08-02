import type { CorpusRecord } from "@/lib/corpus/types";

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

const CLASS_WORDS = /\b(attested|reconstructed|inferred)\b/gi;
/** Words that assert certainty a not-yet-verified record cannot support. */
const CERTAINTY_WORDS = /\b(attested|proven|confirmed|documented|verified)\b/gi;
/** A chapter/verse/page shape the model was told never to type. */
const CITATION_SHAPE =
  /\b(adhy[āa]ya|chapter|verse|v\.\s*\d|p{1,2}\.\s*\d|page\s+\d|folio)\b/gi;
/** A verdict on the reader's health, where rule 4 allows only a named axis. */
const HEALTH_WORDS = /\b(healthier|healthy|nourishing|nutrient[- ]dense|wholesome)\b/gi;
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
  };
}

export function isClean(audit: ProseAudit): boolean {
  return Object.values(audit).every((hits) => hits.length === 0);
}
