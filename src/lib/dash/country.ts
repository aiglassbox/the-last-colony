/**
 * Turning an ISO country code into something a person reads.
 *
 * Built into the platform, so it needs no lookup table shipped beside it. That
 * matters more than it sounds: a hand-maintained country list is a file that is
 * wrong the first time a name changes and that nobody remembers to update.
 *
 * There was a `countryFlag` here too, mapping the code onto the regional
 * indicator block. It is gone rather than kept for later: Windows ships no
 * glyphs for that block, so it rendered as a bare letter pair beside the name
 * on half the machines this dashboard is read from — a permanent small glitch
 * in exchange for decoration the name already provides.
 */

/**
 * `IN` → `India`. Falls back to the code itself, which is the right failure:
 * an unrecognised code is still a country, and printing `ZZ` is better than
 * printing nothing or guessing.
 */
export function countryName(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
