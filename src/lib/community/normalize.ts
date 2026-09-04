/**
 * One spelling for a dish name, applied at ingestion to tags/aliases and at
 * query time (Phase 4) to the reader's words — both sides of the match go
 * through this exact function, which is what makes the match deterministic.
 *
 * Unicode-aware on purpose: \p{L}/\p{N} keep Devanagari, Tamil, Bengali and
 * every other script the form accepts, and \p{M} keeps their vowel signs and
 * viramas. Only Latin diacritics (already split off by NFD) and punctuation
 * are folded, so "Vilepī" meets "vilepi" and "वडा पाव" survives.
 *
 * Format characters (\p{Cf}: ZWJ, ZWNJ, zero-width space, BOM, …) are dropped
 * first. They are invisible, so a reader never types them, but a pasted card
 * or a phone keyboard often carries them — and two spellings that look
 * identical on screen must normalise identical.
 *
 * The closing NFC is load-bearing: NFD splits two-part vowel signs (Tamil ொ,
 * Bengali ো, Kannada ೇ, …) and the reader's query arrives composed, so the
 * stored tag must be recomposed for exact-string equality to hold.
 */
export function normalizeDish(raw: string): string {
  return raw
    .replace(/\p{Cf}/gu, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .normalize("NFC");
}

/** The tag form of a dish name: normalised, spaces to hyphens. What Phase 4 matches on. */
export function dishTag(name: string): string {
  return normalizeDish(name).replace(/\s+/g, "-");
}
