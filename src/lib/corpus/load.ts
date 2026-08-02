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
    // OFF by default, and the reason is measured rather than cautious.
    //
    // Wiring this to the 199-record index works: "snake gourd" finds Snake
    // Gourd in Ghee, and "something for bleeding disorders" finds three records
    // whose ayurvedic text names raktapitta — a property query BM25 over dish
    // names could never answer.
    //
    // It also breaks rule 3, "retrieval declines rather than guesses". With it
    // on, `tests/retrieval-queries.json` falls from 132/132 to 108/132:
    //
    //     "asdfgh"          -> ksk-tindisaka-031      (0.57)
    //     "recipe"          -> pbr-arisi-upma-025     (0.64)
    //     "butter chicken"  -> wf-puryalakhya-153     (0.60)
    //
    // A wrong ancestor for butter chicken is the campaign risk this project
    // exists to avoid. And no threshold fixes it: "asdfgh" scores 0.57 while
    // "jalebi" scores 0.72 and is *correct* — the pipeline's own negative
    // controls found the same overlap, on cosine and on rerank scores alike.
    //
    // What is missing is a decline gate for the vector path equivalent to the
    // unknown-token veto and ambiguity gate the keyword path already has.
    // Until that exists and the harness passes at 132/132 with this on, the
    // wider net stays behind a switch.
    if (process.env.VECTOR_FALLBACK !== "on") return [];

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
