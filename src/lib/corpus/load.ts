import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Bm25Index, buildDocument } from "@/lib/retrieval/bm25";
import { fold } from "@/lib/retrieval/normalize";

import type { CorpusRepository } from "./repository";
import type { CorpusRecord, SwapRecord } from "./types";
import { CorpusValidationError, validateCorpusSet, validateRecord, validateSwap } from "./validate";
import { toCorpusRecord } from "./vector";

/**
 * Looks a single indexed record up by id.
 *
 * Separate from `searchVectors` because a permalink is a primary-key lookup, not
 * a search: `/dish/[slug]` must never resolve to "the nearest thing", which is
 * the same reason the chat route 404s an unknown slug rather than asking the
 * model about it.
 */
async function fetchIndexedRecord(slug: string): Promise<CorpusRecord | null> {
  try {
    const [{ namespaced, NAMESPACES }, { recipeFromMetadata }] = await Promise.all([
      import("@pipeline/lib/pinecone"),
      import("@pipeline/lib/recipe-text"),
    ]);
    const { records } = await namespaced(NAMESPACES.tier1Ancient).fetch([slug]);
    const metadata = records?.[slug]?.metadata;
    if (!metadata?.record) return null;
    return toCorpusRecord(recipeFromMetadata(metadata));
  } catch {
    // A permalink that cannot be resolved is a 404, which is what the caller
    // already does with null. Never a guess.
    return null;
  }
}

/**
 * File-backed corpus. Reads and validates every record once, at first use, and
 * fails loudly if anything is malformed — a corpus that half-loads is worse
 * than one that doesn't load, because the failure shows up as a missing dish
 * six weeks later rather than as a crash on boot.
 *
 * Swap in a Postgres implementation of `CorpusRepository` and nothing above
 * this file changes.
 */

const CORPUS_DIR = resolve(process.cwd(), "corpus");

function readJsonDir(dir: string): Array<[string, unknown]> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      try {
        return [path, JSON.parse(readFileSync(path, "utf8"))] as [string, unknown];
      } catch (err) {
        throw new CorpusValidationError(path, [`invalid JSON: ${(err as Error).message}`]);
      }
    });
}

interface Loaded {
  records: CorpusRecord[];
  byId: Map<string, CorpusRecord>;
  bySlug: Map<string, CorpusRecord>;
  index: Bm25Index;
  swaps: SwapRecord[];
  swapByAlias: Map<string, SwapRecord>;
}

let cache: Loaded | null = null;

export function loadCorpus(): Loaded {
  if (cache) return cache;

  const records: CorpusRecord[] = [];
  for (const sub of ["ancient", "modern"]) {
    for (const [path, raw] of readJsonDir(join(CORPUS_DIR, sub))) {
      records.push(validateRecord(raw, path));
    }
  }

  const setProblems = validateCorpusSet(records);
  if (setProblems.length) {
    throw new CorpusValidationError("corpus (cross-record)", setProblems);
  }

  const swaps: SwapRecord[] = [];
  for (const [path, raw] of readJsonDir(join(CORPUS_DIR, "swaps"))) {
    swaps.push(validateSwap(raw, path));
  }

  const byId = new Map(records.map((r) => [r.id, r]));
  const bySlug = new Map(records.map((r) => [r.slug, r]));

  // Only searchable records go in the keyword index. A `modern` record that is
  // purely the counterpart half of a diff is reachable through its ancient
  // record, not by name — indexing both would split the score across two docs.
  const searchable = records.filter(
    (r) => r.tier === "ancient" || r.provenance_class === "MODERN_DISH",
  );

  const index = new Bm25Index(
    searchable.map((r) =>
      buildDocument(r.id, [r.dish_name_modern, r.dish_name_source, ...r.aliases]),
    ),
  );

  const swapByAlias = new Map<string, SwapRecord>();
  for (const s of swaps) {
    for (const a of [s.modern_item, ...s.aliases]) swapByAlias.set(fold(a), s);
  }

  cache = { records, byId, bySlug, index, swaps, swapByAlias };
  return cache;
}

/** Test/CLI helper — the app never needs this. */
export function resetCorpusCache(): void {
  cache = null;
}

export const fileCorpus: CorpusRepository = {
  async all() {
    return loadCorpus().records;
  },
  async byId(id) {
    return loadCorpus().byId.get(id) ?? null;
  },
  async bySlug(slug) {
    const local = loadCorpus().bySlug.get(slug);
    if (local) return local;
    // A card built from the index carries an index slug, and its Permalink and
    // Share links point back here. Without this fallback those links 404 on
    // exactly the dishes the index just made findable.
    return fetchIndexedRecord(slug);
  },
  async searchKeyword(query, limit) {
    const { index, byId } = loadCorpus();
    return index
      .search(query)
      .slice(0, limit)
      .map((s) => ({
        record: byId.get(s.id)!,
        score: s.score,
        explains_query: s.explains_query,
        head_phrase: s.head_phrase,
      }))
      .filter((h) => Boolean(h.record));
  },
  async searchVectors(query, limit) {
    // ON by default since the ordering fix. Set VECTOR_FALLBACK=off to disable.
    //
    // The history is worth keeping, because the fix was not the obvious one.
    //
    // Wiring this to the 199-record index works: "snake gourd" finds Snake
    // Gourd in Ghee, and "something for bleeding disorders" finds three records
    // whose ayurvedic text names raktapitta — a property query BM25 over dish
    // names could never answer.
    //
    // It used to break rule 3, "retrieval declines rather than guesses". Wiring
    // the index straight in gave 114/132 on the harness: eighteen wrong
    // ancestors, including a twelfth-century chicken dish for butter chicken,
    // pre-colonial vegetable rice for pizza, and a watermelon recipe for
    // "asdfgh".
    //
    // The instinct was to raise a threshold. No threshold exists: "asdfgh"
    // scored 0.57 and "jalebi" 0.72, and jalebi was correct. Three rerankers
    // and cosine all overlap the same way.
    //
    // It was an ordering bug. Vector search returned a *hit*, so an ancestor was
    // declared before anything asked whether the dish has one — while the model
    // three lines later already classified butter chicken as modern and pizza as
    // foreign, correctly, every time. It was simply never consulted.
    //
    // Now these arrive as `candidates` on a result that is still empty, the
    // model judges the dish, and only a RESTORE verdict promotes one to a
    // record. Harness: 132/132. It also restored a guardrail retrieval had been
    // bypassing — "something for bleeding disorders" now reaches rule 4 and is
    // declined as a medical question instead of rendering an ayurvedic card.
    if (process.env.VECTOR_FALLBACK === "off") return [];

    // Failure returns empty rather than throwing. An index outage should cost
    // the wider net, not the whole turn — a corpus hit still answers, and a miss
    // still declines honestly, which is what the product did before this existed.
    try {
      const { retrieve } = await import("@pipeline/lib/retrieval");
      const hits = await retrieve(query, { topK: limit });
      return hits.map((hit) => ({
        record: toCorpusRecord(hit.recipe),
        score: hit.denseScore,
        // Vector recall is not name matching: it cannot claim to have explained
        // the query or matched its head noun, and saying otherwise would let a
        // semantic near-miss through the ambiguity gate that exists to stop
        // exactly that.
        explains_query: false,
        head_phrase: false,
      }));
    } catch (error) {
      console.warn(
        `[vector-search] index unavailable, keyword-only: ` +
          `${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  },
  async swaps() {
    return loadCorpus().swaps;
  },
  async findSwap(item) {
    const { swapByAlias } = loadCorpus();
    return swapByAlias.get(fold(item)) ?? null;
  },
};
