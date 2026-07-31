import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRepository, RepoHit } from "@/lib/corpus/repository";
import type { CorpusRecord, RetrievalResult } from "@/lib/corpus/types";

/**
 * Hybrid retrieval, keyword-first.
 *
 * The brief's rule, restated as code: match on dish name and aliases with BM25;
 * fall back to vectors only when keyword search finds nothing; and if the top
 * keyword match is below threshold, return empty rather than the nearest
 * neighbour. A wrong ancestor is worse than no ancestor, so every ambiguous
 * case resolves to "not in the restored corpus yet" and gets logged for
 * corpus expansion.
 */

/**
 * Below this BM25 score, a match is a coincidence rather than a naming.
 * Calibrated against `tests/retrieval-queries.json` — re-run
 * `npm run corpus:check-retrieval` after changing it.
 */
export const MIN_KEYWORD_SCORE = 1.2;

/** More than three records and the model starts averaging across dishes. */
export const MAX_INJECTED_RECORDS = 3;

export interface RetrieveOptions {
  repo?: CorpusRepository;
  minScore?: number;
}

const EMPTY: RetrievalResult = {
  records: [],
  top_score: 0,
  matched_on: null,
  empty: true,
};

export async function retrieveForDish(
  query: string,
  { repo = fileCorpus, minScore = MIN_KEYWORD_SCORE }: RetrieveOptions = {},
): Promise<RetrievalResult> {
  if (!query.trim()) return EMPTY;

  const keyword = await repo.searchKeyword(query, MAX_INJECTED_RECORDS);

  if (!keyword.length || keyword[0].score < minScore) {
    // Vectors are the fallback, not the default. When they are wired up they
    // inherit the same threshold discipline: below it, we return empty.
    const vector = await repo.searchVectors(query, MAX_INJECTED_RECORDS);
    if (!vector.length) return { ...EMPTY, top_score: keyword[0]?.score ?? 0 };
    return withCounterparts(vector, "vector", repo);
  }

  if (isAmbiguous(keyword)) {
    return { ...EMPTY, top_score: keyword[0].score };
  }

  // When the head noun disambiguates, answer with that record rather than
  // whichever happened to score highest.
  const heads = keyword.filter((h) => h.head_phrase);
  const ordered =
    heads.length === 1 && !keyword[0].explains_query
      ? [heads[0], ...keyword.filter((h) => h !== heads[0])]
      : keyword;

  return withCounterparts(ordered, "alias", repo);
}

/**
 * Two records each explaining part of the query and neither explaining all of
 * it is not a ranking problem, it is a different dish. "vada pav" is half vada
 * and half pav bhaji; answering with either one puts a confidently wrong
 * ancestor on screen. Decline, and let the fallback card offer components.
 */
function isAmbiguous(hits: RepoHit[]): boolean {
  if (hits.length < 2) return false;
  if (hits.some((h) => h.explains_query)) return false;
  const distinct = new Set(hits.map((h) => h.record.id));
  if (distinct.size < 2) return false;

  // One record owning the query's head noun resolves it: "aloo poha" is a poha
  // with a qualifier in front, even though `aloo` also appears in the aliases
  // for aloo paratha and aloo tahari. "vada pav" has no such owner — no record
  // is called simply "pav" — so it stays ambiguous and declines.
  const heads = hits.filter((h) => h.head_phrase);
  return heads.length !== 1;
}

/**
 * The ancient record and its modern counterpart travel together — the diff is
 * the product, and a card without both halves has nothing to show in
 * WHAT CHANGED. Counterparts do not count against the injection cap; they are
 * the other half of a record, not a competing dish.
 */
async function withCounterparts(
  hits: RepoHit[],
  matchedOn: "alias" | "name" | "vector",
  repo: CorpusRepository,
): Promise<RetrievalResult> {
  const top = hits.slice(0, MAX_INJECTED_RECORDS);
  const out: CorpusRecord[] = [];
  const seen = new Set<string>();

  for (const { record } of top) {
    if (!seen.has(record.id)) {
      out.push(record);
      seen.add(record.id);
    }
    if (record.modern_counterpart_id && !seen.has(record.modern_counterpart_id)) {
      const counterpart = await repo.byId(record.modern_counterpart_id);
      if (counterpart) {
        out.push(counterpart);
        seen.add(counterpart.id);
      }
    }
  }

  return {
    records: out,
    top_score: top[0]?.score ?? 0,
    matched_on: matchedOn,
    empty: out.length === 0,
  };
}

/** Direct slug lookup for /dish/[slug] — QR codes must not go through search. */
export async function retrieveBySlug(
  slug: string,
  repo: CorpusRepository = fileCorpus,
): Promise<RetrievalResult> {
  const record = await repo.bySlug(slug);
  if (!record) return EMPTY;
  return withCounterparts(
    [{ record, score: Infinity, explains_query: true, head_phrase: true }],
    "alias",
    repo,
  );
}
