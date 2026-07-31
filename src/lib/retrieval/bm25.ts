import { phoneticFold, tokenize } from "./normalize";

/**
 * BM25 over dish names and aliases only.
 *
 * Not over ingredients or method — those live in the vector index. Keyword
 * search here is answering one question: "did the user name this dish?" Mixing
 * ingredient text into the same index makes "coconut" retrieve six records and
 * the top hit stops meaning anything.
 */

const K1 = 1.5;
const B = 0.75;
/** Phonetic hits are real but weaker evidence than an exact alias match. */
const PHONETIC_WEIGHT = 0.6;

export interface Document {
  id: string;
  /** Exact-fold tokens from the dish name, source name, and aliases. */
  tokens: string[];
  /** The same set through the phonetic fold. */
  phonetic: string[];
  /** Each alias as its token list, for whole-phrase matching ("pav bhaji"). */
  phrases: string[][];
}

export interface Scored {
  id: string;
  score: number;
  matched_on: "alias" | "name";
  /** True when every content token in the query is accounted for by this doc. */
  explains_query: boolean;
  /**
   * True when the doc has a complete one-word alias equal to the query's final
   * content token. Indian dish names put the head noun last — "aloo poha" is a
   * poha, "dahi vada" is a vada — so this is what distinguishes a qualifier in
   * front of a dish from two dishes jammed together.
   */
  head_phrase: boolean;
}

export function buildDocument(
  id: string,
  names: Array<string | null | undefined>,
): Document {
  const tokens = new Set<string>();
  const phonetic = new Set<string>();
  const phrases: string[][] = [];

  for (const raw of names) {
    if (!raw) continue;
    const t = tokenize(raw);
    if (t.tokens.length) phrases.push(t.tokens.map(phoneticFold));
    for (const tok of t.tokens) {
      tokens.add(tok);
      phonetic.add(phoneticFold(tok));
    }
  }

  return { id, tokens: [...tokens], phonetic: [...phonetic], phrases };
}

export class Bm25Index {
  private readonly docs: Document[];
  private readonly avgLen: number;
  /** term → number of documents containing it. */
  private readonly df = new Map<string, number>();
  private readonly dfPhonetic = new Map<string, number>();
  /** Every token the corpus knows, exact and phonetic. */
  private readonly vocab = new Set<string>();

  constructor(docs: Document[]) {
    this.docs = docs;
    this.avgLen = docs.length
      ? docs.reduce((s, d) => s + d.tokens.length, 0) / docs.length
      : 0;

    for (const d of docs) {
      for (const t of new Set(d.tokens)) {
        this.df.set(t, (this.df.get(t) ?? 0) + 1);
        this.vocab.add(t);
      }
      for (const t of new Set(d.phonetic)) {
        this.dfPhonetic.set(t, (this.dfPhonetic.get(t) ?? 0) + 1);
        this.vocab.add(t);
      }
    }
  }

  private idf(term: string, df: Map<string, number>): number {
    const n = this.docs.length;
    const freq = df.get(term) ?? 0;
    // Standard BM25 IDF with the +1 that keeps single-doc terms positive.
    return Math.log(1 + (n - freq + 0.5) / (freq + 0.5));
  }

  search(query: string): Scored[] {
    const q = tokenize(query);
    if (!q.tokens.length) return [];

    /**
     * Tokens the corpus has never heard of. These are the tell that the user
     * named a dish we don't have: "misal pav" shares `pav` with pav bhaji, but
     * `misal` is unknown, and answering with pav bhaji would be exactly the
     * nearest-neighbour mistake the brief forbids. An unknown token vetoes any
     * match that isn't a complete alias in its own right — so "aloo poha" still
     * finds poha, because `poha` is a whole alias, while "paneer tikka" finds
     * nothing, because `paneer` is only half of "palak paneer".
     */
    const unknown = q.tokens.filter(
      (t, i) => !this.vocab.has(t) && !this.vocab.has(q.phonetic[i]),
    );
    const queryPhonetic = new Set(q.phonetic);
    const head = q.phonetic[q.phonetic.length - 1];

    const results: Scored[] = [];

    for (const doc of this.docs) {
      const len = doc.tokens.length || 1;
      const norm = K1 * (1 - B + (B * len) / (this.avgLen || 1));
      let score = 0;
      let exactHits = 0;
      let phoneticHits = 0;

      for (let i = 0; i < q.tokens.length; i++) {
        const term = q.tokens[i];
        if (doc.tokens.includes(term)) {
          // tf is 1 by construction — names are a set, not prose.
          score += this.idf(term, this.df) * ((1 * (K1 + 1)) / (1 + norm));
          exactHits++;
          continue;
        }
        const ph = q.phonetic[i];
        if (doc.phonetic.includes(ph)) {
          score +=
            PHONETIC_WEIGHT * this.idf(ph, this.dfPhonetic) * ((1 * (K1 + 1)) / (1 + norm));
          phoneticHits++;
        }
      }

      if (!exactHits && !phoneticHits) continue;

      // A whole-alias match is the strongest signal there is, and it is what
      // lets a match survive an unknown token elsewhere in the query.
      const fullPhrase = doc.phrases.some((p) => p.every((tok) => queryPhonetic.has(tok)));
      if (fullPhrase) score *= 1.75;

      if (!fullPhrase && unknown.length > 0) continue;

      results.push({
        id: doc.id,
        score,
        matched_on: exactHits > 0 ? "alias" : "name",
        explains_query: exactHits + phoneticHits === q.tokens.length,
        head_phrase: doc.phrases.some((p) => p.length === 1 && p[0] === head),
      });
    }

    return results.sort((a, b) => b.score - a.score);
  }
}
