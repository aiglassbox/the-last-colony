/**
 * Tier 3 — Indianisation.
 *
 * The corpus restores Indian dishes to their pre-colonial form, and component
 * restoration handles modern Indian dishes with no ancient original. Neither
 * covers a dish that is not Indian at all — a pizza, a pasta, a burger.
 *
 * For those, there is nothing to restore, so we do not pretend to. Instead we
 * rebuild the dish from Indian, healthier components — but only from the
 * mappings below, the same way component restoration only quotes real swap
 * ratios. The model decomposes the dish; this map supplies every Indian part it
 * is allowed to use. A fabricated "Indian equivalent" is the same class of
 * failure as a fabricated verse.
 *
 * This lives outside `corpus/` on purpose: it is not a restoration record and
 * must not pass through the corpus loader or its validator.
 */
import rulesJson from "./rules.json";

export interface IndianizationRule {
  id: string;
  /** base | dairy | sauce | fat | sweetener | protein | thickener | technique | flavor */
  role: string;
  foreign: string[];
  indian_healthy: string[];
  technique_swap: string | null;
  rationale: string;
  derived_from: string[];
  verification_status: string;
}

export const INDIANIZATION_RULES = rulesJson as IndianizationRule[];

/**
 * The map the model is handed on an Indianisation turn — the Tier-3 analogue of
 * `renderComponentSwaps`. Compact prose, not JSON, so the model maps against it
 * rather than restating it.
 */
export function renderIndianizationBlock(rules: IndianizationRule[] = INDIANIZATION_RULES): string {
  const body = rules
    .map((r) => {
      const technique = r.technique_swap ? `\n    technique: ${r.technique_swap}` : "";
      return (
        `  <component role="${r.role}">\n` +
        `    foreign: ${r.foreign.join(", ")}\n` +
        `    indian_healthy: ${r.indian_healthy.join(" | ")}` +
        `${technique}\n` +
        `  </component>`
      );
    })
    .join("\n");

  return (
    "<indianization_map>\n" +
    "Component substitutions for Indianising a foreign dish. Decompose the dish " +
    "into its parts and use these where they fit: they are checked, and a part " +
    "listed here should be swapped the way it says. Where a part is not listed, " +
    "use your own knowledge of Indian cooking and name the swap you would " +
    "actually make. Prefer a real, specific ingredient a kirana sells over a " +
    "vague one.\n" +
    "This licence is culinary and stops there. It does not extend to the dish's " +
    "history: no century, no region of origin, no text, no account of what " +
    "displaced what, and no citation of any kind. Those belong to a record, this " +
    "card has none, and an unverifiable history under a confident card is the " +
    "failure this project exists to avoid. Say what the swap does in the pot.\n" +
    `${body}\n` +
    "</indianization_map>"
  );
}
