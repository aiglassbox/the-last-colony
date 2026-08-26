/**
 * Multilingual retrieval A/B — the real production surface.
 *   npm run eval:multilingual   (from repo root)
 *
 * Unlike a synthetic proxy, this drives exactly what ships:
 *
 *   Path B (production):  normalize(query).english  ->  retrieveForDish  (BM25
 *     keyword-first, the 132/132 engine). This is the code path a real request
 *     takes. No prompt is duplicated — the production `normalize` is imported.
 *   Path A (benchmark):   the raw multilingual query  ->  searchVectors (the
 *     cross-lingual Gemini-embedding + Pinecone vector fallback). No translation.
 *
 * WHY PER-ENGINE GOLD. The two engines return different records for the same
 * dish — BM25 returns the root corpus record (slug "idli"), the vector index
 * returns the historical record ("man-iddarika-012", named "…(medieval idli)").
 * Their id spaces do not overlap, so a single shared gold is impossible. Each
 * path is therefore scored on CONSISTENCY: does the language variant reach the
 * same record the path's own English query reaches?
 *
 *   consistency = variant reaches the same record as English, in that engine.
 *
 * Consistency alone can hide an engine that is reliably wrong (the vector index
 * retrieves the wrong record for "poha" even in English), so each English anchor
 * is also checked for correctness — does the anchor record's name actually name
 * the dish — and reported as `anchorValid`. A path's ABSOLUTE score counts only
 * variants that are both consistent and anchored to the right dish.
 *
 * Records everything to report.md + report.json. Both are committed on purpose:
 * the numbers are the evidence for the production routing decision.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { fileCorpus } from "@/lib/corpus/load";
import { normalize } from "@/lib/lang/normalize";
import { retrieveForDish } from "@/lib/retrieval/retrieve";

interface Dish {
  english: string;
  variants: Record<string, string>;
}

/** Top record a raw query reaches through the vector fallback, or null. */
async function vectorTop(query: string): Promise<{ id: string; name: string } | null> {
  const hits = await fileCorpus.searchVectors(query, 1);
  const r = hits[0]?.record;
  return r ? { id: r.slug, name: r.dish_name_modern } : null;
}

/** Top record a query reaches through production keyword-first retrieval, or null. */
async function bm25Top(query: string): Promise<{ id: string; name: string } | null> {
  const res = await retrieveForDish(query);
  if (res.empty || !res.records.length) return null;
  return { id: res.records[0].slug, name: res.records[0].dish_name_modern };
}

/** Does the anchor record actually name the dish? Guards against a path that is
 *  reliably wrong even in English (vector "poha" is a barley-ball dish). Accepts
 *  a slug match too, because BM25 slugs are the dish token itself while a record
 *  whose modern name differs from the slug (bedhai → "Bedmi Poori") would
 *  otherwise read as a false miss. Vector slugs are pipeline ids, so this only
 *  rescues the correct BM25 anchor, never a wrong vector one. */
function anchorValid(dish: string, rec: { id: string; name: string } | null): boolean {
  if (!rec) return false;
  return rec.id.toLowerCase() === dish.toLowerCase() || rec.name.toLowerCase().includes(dish.toLowerCase());
}

interface Row {
  dish: string;
  lang: string;
  query: string;
  englishB: string; // what normalize translated the variant to
  aId: string | null;
  bId: string | null;
  aConsistent: boolean;
  bConsistent: boolean;
  aAbsolute: boolean;
  bAbsolute: boolean;
}

async function main() {
  const path = join(process.cwd(), "eval", "multilingual", "queries.json");
  const dishes = (JSON.parse(readFileSync(path, "utf8")) as { dishes: Dish[] }).dishes;

  const rows: Row[] = [];
  const anchors: Array<{ dish: string; aId: string | null; aValid: boolean; bId: string | null; bValid: boolean }> = [];

  for (const d of dishes) {
    // English anchors, one per engine.
    const aAnchor = await vectorTop(d.english);
    const bAnchor = await bm25Top(d.english);
    const aValid = anchorValid(d.english, aAnchor);
    const bValid = anchorValid(d.english, bAnchor);
    anchors.push({ dish: d.english, aId: aAnchor?.id ?? null, aValid, bId: bAnchor?.id ?? null, bValid });

    for (const [lang, q] of Object.entries(d.variants)) {
      const aTop = await vectorTop(q);
      const n = await normalize(q);
      const bTop = await bm25Top(n.english);

      const aConsistent = !!aAnchor && aTop?.id === aAnchor.id;
      const bConsistent = !!bAnchor && bTop?.id === bAnchor.id;
      rows.push({
        dish: d.english,
        lang,
        query: q,
        englishB: n.english,
        aId: aTop?.id ?? null,
        bId: bTop?.id ?? null,
        aConsistent,
        bConsistent,
        aAbsolute: aConsistent && aValid,
        bAbsolute: bConsistent && bValid,
      });
    }
  }

  const count = (k: keyof Row) => rows.filter((r) => r[k]).length;
  const group = (key: "lang" | "dish", metric: keyof Row) => {
    const m: Record<string, { hit: number; total: number }> = {};
    for (const r of rows) {
      const g = r[key] as string;
      m[g] ??= { hit: 0, total: 0 };
      m[g].total++;
      if (r[metric]) m[g].hit++;
    }
    return m;
  };

  const report = {
    total: rows.length,
    pathA: { consistent: count("aConsistent"), absolute: count("aAbsolute") },
    pathB: { consistent: count("bConsistent"), absolute: count("bAbsolute") },
    perLang: { aConsistent: group("lang", "aConsistent"), bConsistent: group("lang", "bConsistent") },
    perDish: { aAbsolute: group("dish", "aAbsolute"), bAbsolute: group("dish", "bAbsolute") },
    anchors,
    rows,
  };

  writeFileSync(
    join(process.cwd(), "eval", "multilingual", "report.json"),
    JSON.stringify(report, null, 2),
  );

  const frac = (h: number, t: number) => `${h}/${t}`;
  const langs = Object.keys(report.perLang.bConsistent).sort();
  const badAnchorsA = anchors.filter((a) => !a.aValid).map((a) => a.dish);
  const misses = rows.filter((r) => !r.bAbsolute);

  const md = [
    "# Multilingual retrieval — Path A vs Path B",
    "",
    "**Path B (production):** `normalize(query).english` → `retrieveForDish` (BM25 keyword-first, the 132/132 engine). Exactly what a real request runs — the production `normalize` is imported, not re-implemented.",
    "**Path A (benchmark):** raw multilingual query → `searchVectors` (cross-lingual Gemini embedding + Pinecone). No translation.",
    "",
    "Scored on **consistency** (does the variant reach the same record its English form reaches, in that engine?) and **absolute** (consistent *and* the English anchor actually names the dish). See `run.ts` for why per-engine gold is required.",
    "",
    `Total variant queries: **${report.total}** across ${dishes.length} dishes and ${langs.length} language buckets.`,
    "",
    "| Path | Consistent | Absolute |",
    "|---|---|---|",
    `| A — raw → vector | ${frac(report.pathA.consistent, report.total)} | ${frac(report.pathA.absolute, report.total)} |`,
    `| B — translate → BM25 (production) | ${frac(report.pathB.consistent, report.total)} | ${frac(report.pathB.absolute, report.total)} |`,
    "",
    badAnchorsA.length
      ? `> Path A's English anchor is the **wrong dish** for: ${badAnchorsA.join(", ")}. The vector index retrieves a wrong record for these even in English, so their Path-A "consistency" is consistently-wrong and scores 0 absolute.`
      : "> Every English anchor names its dish in both engines.",
    "",
    "## By language (consistency)",
    "",
    "| Lang | Path A | Path B |",
    "|---|---|---|",
    ...langs.map((l) => {
      const a = report.perLang.aConsistent[l] ?? { hit: 0, total: 0 };
      const b = report.perLang.bConsistent[l] ?? { hit: 0, total: 0 };
      return `| ${l} | ${frac(a.hit, a.total)} | ${frac(b.hit, b.total)} |`;
    }),
    "",
    "## By dish (absolute)",
    "",
    "| Dish | Path A | Path B |",
    "|---|---|---|",
    ...dishes.map((d) => {
      const a = report.perDish.aAbsolute[d.english] ?? { hit: 0, total: 0 };
      const b = report.perDish.bAbsolute[d.english] ?? { hit: 0, total: 0 };
      return `| ${d.english} | ${frac(a.hit, a.total)} | ${frac(b.hit, b.total)} |`;
    }),
    "",
    "## Where Path B (production) misses",
    "",
    misses.length ? "| Dish | Lang | Query | normalize → english | BM25 got |" : "_No Path-B misses._",
    ...(misses.length ? ["|---|---|---|---|---|"] : []),
    ...misses.map(
      (r) => `| ${r.dish} | ${r.lang} | ${r.query} | ${JSON.stringify(r.englishB)} | ${r.bId ?? "declined"} |`,
    ),
    "",
    "Per-query detail (both paths, every row) is in `report.json`.",
    "",
  ].join("\n");

  writeFileSync(join(process.cwd(), "eval", "multilingual", "report.md"), md);
  console.log(md);
}

main();
