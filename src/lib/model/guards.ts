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

export interface ProseAudit {
  provenanceClaims: string[];
  certaintyClaims: string[];
  citationShapes: string[];
}

export function auditProse(text: string, records: CorpusRecord[]): ProseAudit {
  const unverified = records.some(
    (r) => r.tier === "ancient" && r.verification.status !== "editor_verified",
  );

  return {
    provenanceClaims: [...new Set(text.match(CLASS_WORDS) ?? [])],
    certaintyClaims: unverified ? [...new Set(text.match(CERTAINTY_WORDS) ?? [])] : [],
    citationShapes: [...new Set(text.match(CITATION_SHAPE) ?? [])],
  };
}

export function isClean(audit: ProseAudit): boolean {
  return (
    audit.provenanceClaims.length === 0 &&
    audit.certaintyClaims.length === 0 &&
    audit.citationShapes.length === 0
  );
}
