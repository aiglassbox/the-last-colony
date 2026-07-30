import type { CorpusRecord, SwapRecord } from "./types";

/**
 * The seam between retrieval and storage.
 *
 * Today this is backed by JSON files on disk. The brief specifies Postgres +
 * pgvector; when that lands, it implements this interface and nothing above it
 * changes. `searchVectors` is deliberately part of the contract now — the file
 * implementation returns nothing, which is the correct behaviour for a fallback
 * that isn't wired up yet, and keeps the retrieval code honest about the fact
 * that keyword search is the default and vectors are the fallback.
 */
export interface RepoHit {
  record: CorpusRecord;
  score: number;
  /**
   * Whether this record accounts for every content token in the query. Used to
   * detect ambiguity: "vada pav" is half-explained by two different records and
   * fully explained by neither, which is a decline, not a coin flip.
   */
  explains_query: boolean;
  /**
   * Whether this record's own one-word name is the query's final token — the
   * head noun. "aloo poha" is a poha; "vada pav" is neither a vada nor a
   * bhaji.
   */
  head_phrase: boolean;
}

export interface CorpusRepository {
  all(): Promise<CorpusRecord[]>;
  byId(id: string): Promise<CorpusRecord | null>;
  bySlug(slug: string): Promise<CorpusRecord | null>;
  /** BM25 over dish names and aliases. Best first. */
  searchKeyword(query: string, limit: number): Promise<RepoHit[]>;
  /** Vector search over method and ingredient text. Fallback, never the default. */
  searchVectors(query: string, limit: number): Promise<RepoHit[]>;
  swaps(): Promise<SwapRecord[]>;
  findSwap(item: string): Promise<SwapRecord | null>;
}
