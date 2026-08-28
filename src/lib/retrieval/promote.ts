import type { CorpusRecord } from "@/lib/corpus/types";

import { tokenize } from "./normalize";

/**
 * Whether a semantic candidate may be shown as the dish the user named.
 *
 * Vector search returns nearest neighbours, and nearest is not the same dish:
 * a sweep found "thalipeeth" reaching Vilepī (rice gruel), "thecha" reaching
 * Takra (buttermilk), "sol kadhi" reaching a gram fritter — every one a
 * confident wrong ancestor. The resolve prompt tells the model to promote a
 * candidate only when it genuinely is the dish, and the model does it anyway,
 * so this is the deterministic backstop the prompt cannot be.
 *
 * The rule that separated every wrong promote from every correct one in that
 * sweep: a candidate is the dish only if its name, source name or an alias
 * shares a content token with the query. "parpata" → Parpata keeps its record;
 * "thalipeeth" → Vilepī loses it and RESTORE falls to component restoration
 * rather than stamping a wrong ancestor. The comparison is over the same
 * phonetic fold retrieval matches on, so "vilepi" still matches "Vilepī" and
 * spelling variance does not slip a real neighbour past the guard.
 *
 * Biases toward withholding: a real ancestor whose modern name shares no token
 * with its ancient one is dropped to a miss, which the brief prefers to a wrong
 * ancestor ("a miss is a corpus gap; a wrong ancestor is a campaign risk").
 */
// ponytail: any-token overlap, not all-tokens. A shared *generic* dish-form
// word is its ceiling — "sol kadhi" (a kokum drink) still matches a besan
// "kadhi vada" record on the one word "kadhi". Requiring every query token to
// match would close that but drops real multi-word dishes whose ancestor is
// recorded under a shorter name (e.g. "puran poli" → "poli"), and a miss there
// is the wrong trade. Tighten to distinctive-token weighting only if these
// generic-word residuals actually matter.
export function mayPromoteCandidate(
  queryEnglish: string,
  candidate: Pick<CorpusRecord, "dish_name_modern" | "dish_name_source" | "aliases">,
): boolean {
  const q = new Set(tokenize(queryEnglish).phonetic);
  if (!q.size) return false;

  for (const name of [candidate.dish_name_modern, candidate.dish_name_source, ...candidate.aliases]) {
    if (!name) continue;
    for (const tok of tokenize(name).phonetic) {
      if (q.has(tok)) return true;
    }
  }
  return false;
}
