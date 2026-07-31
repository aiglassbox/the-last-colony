import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Bm25Index, buildDocument } from "@/lib/retrieval/bm25";
import { fold } from "@/lib/retrieval/normalize";

import type { CorpusRepository } from "./repository";
import type { CorpusRecord, SwapRecord } from "./types";
import { CorpusValidationError, validateCorpusSet, validateRecord, validateSwap } from "./validate";

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
    return loadCorpus().bySlug.get(slug) ?? null;
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
  async searchVectors() {
    // Not wired up. Returning nothing is the correct behaviour for a fallback
    // that does not exist yet: retrieval reports empty and the product says so,
    // rather than quietly substituting a nearest neighbour.
    return [];
  },
  async swaps() {
    return loadCorpus().swaps;
  },
  async findSwap(item) {
    const { swapByAlias } = loadCorpus();
    return swapByAlias.get(fold(item)) ?? null;
  },
};
