# Architecture

How the data is organised, what lives where, and the rules that must not be broken.
For the record schema and curation workflow, see `data/README.md`.

## The one rule

> **A Tier-2 or Tier-3 record must never be presented as a historical recipe.**

Everything below exists to make that structurally true rather than a matter of
care. The project's value is that its answers are traceable to a cited text; a
modern Kaggle recipe surfacing as "ancient" destroys that in a single reply.

## The three tiers

| Tier | What | Count | File | Authenticity |
|------|------|-------|------|--------------|
| **1** | Ancient recipes from cited historical texts | 199 | `data/recipes.json` | Cited, human-verifiable |
| **2** | Modern Indian dishes, bulk-imported | 5,898 | `data/dishes.json` | None — third-party dataset |
| **3** | Component-role mappings for foreign dishes | 56 | `data/indianization.json` | Derived principle |
| — | Healthier-swap rules | 44 | `data/substitutions.json` | Traditional principle |

Tier 1 is the product. Tier 2 is the "before" that substitution rules transform.
Tier 3 handles dishes that aren't Indian at all, by mapping component *roles*
(base, fat, sweetener, thickener) rather than whole dishes — foreign dishes are
infinite, roles are finite.

## What goes in Pinecone — and what doesn't

Only **Tier 1 and Tier 2** are embedded. They are retrieved by meaning, so they
need vectors.

**Substitutions and indianization rules are not embedded.** They are matched by
explicit `triggers` and `role` fields, not semantics — 26 records totalling ~8 KB.
Load them from JSON at startup and match in memory. Putting them in a vector
store adds a sync path that can fail and buys nothing.

### Namespaces

Each corpus owns a Pinecone namespace:

```
tier1-ancient   199 vectors     from data/recipes.json   ← live
tier2-modern      0 vectors     from data/dishes.json    ← not synced; no sync path exists
```

**Tier 2 is not embedded, and `sync.ts` cannot embed it.** The script hardcodes
`data/recipes.json` and `NAMESPACES.tier1Ancient`; the `npm run sync <corpus>`
argument documented below does not exist yet. That is deliberate for now —
without a tier router, a Kaggle record and a cited historical one would compete
in the same result set, which is the one rule this document opens with.

This is not organisational tidiness — it is the safety boundary.

**Why namespaces and not one namespace with a `tier` filter:** sync deletes
vectors that no longer appear in its source file. If both corpora shared a
namespace, a Tier-1 sync would see 5,898 unrecognised ids and delete them.
Namespacing makes that impossible rather than merely unlikely.

Every vector *also* carries `tier` in its metadata, so retrieval can assert what
it expects instead of trusting that it queried the right namespace. Two
independent guards, because one silent failure here is a wrong answer presented
with a citation.

## Data flow

```
data/*.json  ──►  embed (Gemini)  ──►  Pinecone namespace  ──►  retrieval  ──►  Gemini
  (truth)          gemini-embedding-001      (derived)            top 3–5        answer
                        1536d                                                  + citations
```

**`data/*.json` is the single source of truth.** Pinecone is a derived, disposable
cache — delete the index and `npm run sync` rebuilds it. Never edit a record in
Pinecone; edit the JSON and re-sync.

This is also why the JSON files must be version-controlled. The index is
reproducible in one command. The hand-curated Tier-1 corpus is not.

## Sync

```
npm run index:setup        create the index (once)
npm run sync <corpus>      embed + upsert one corpus
npm run sync <corpus> --dry-run
```

Keyed on each record's stable `id`, and idempotent:

- unchanged records are skipped via a SHA-256 content hash — no re-embedding cost
- new and edited records are upserted
- ids absent from the source file are deleted **from that namespace only**

Consequence: changing an existing `id` reads as *delete that record, add an
unrelated one*. Ids are permanent.

## Embeddings

`gemini-embedding-001` at 1536 dimensions, cosine.

Chosen on evidence, not vibes — see `eval/`. Measured against `multilingual-e5-large`
on a 36-query gold set (32 positive, 4 negative controls), **at the full 199-record
corpus**:

| | Recall@1 | Recall@3 | MRR |
|---|---|---|---|
| gemini-embedding-001 | 88% | 97% | — |
| **gemini-embedding-001 + rerank** | **97%** | **100%** | **0.984** |
| multilingual-e5-large | 72% | 75% | 0.762 |
| multilingual-e5-large + rerank | 91% | 94% | 0.922 |

> **These replace an earlier table reporting 91% / 100% / 0.943**, measured
> against a **24-record** corpus. Re-run `npm run eval` whenever the corpus
> changes size materially — a recall number means nothing without the corpus it
> was measured on.

**Two separate things moved between the 24-record table and this one, and they
must not be conflated.** An intermediate run at 199 records scored 69% / 84%
dense and 75% / 97% reranked. Most of that apparent collapse was **measurement
error**: `expect` in the gold set still listed only the original 24 records, so
the eval marked correct answers wrong — it returned the *Buttermilk* record for
"recipes made with buttermilk" and scored zero. Correcting the gold set
(69 → 109 accepted answers across 13 queries) recovered ~19 points of Recall@1
without changing a line of retrieval code. Reranking is the part that is a real
improvement; the rest was the ruler, not the thing being measured.

### Is the gold set biased toward the retriever?

It was built from review sheets showing each query's **top 10** candidates, so
it can only contain answers the retriever already ranked well. That is worth
taking seriously, but the two failure modes point in opposite directions and are
easy to confuse:

| Mechanism | Direction | Attacked by |
|---|---|---|
| Valid answers **missing** from `expect` — the retriever returns one at rank 1, no `expect` member is there, scored a miss | **downward** | depth / corpus-wide predicates |
| Marginal records **ticked because** the retriever ranked them first — rubber-stamping the system with its own output | **upward** | predicates independent of ranking |

`npm run gold:audit` measures both. For the 11 queries with an objective test —
an ingredient the record must list, an indication its ayurvedic field must
state — the predicate runs over **all 199 records**, owing nothing to the
retriever:

```
accepted answers in gold:   57
valid answers gold misses:  74
gold answers unsupported:    2
→ the gold set holds 57 of 131 answers a corpus-wide search finds (44%)
```

So the curated gold set is **less than half complete**. The sensitivity run —
`gold:audit:write` then `eval --gold=gold-queries.expanded.json`, an answer key
2.3× larger and built without reference to any ranking — returns:

```
gemini + rerank:  1st 31   2nd 1   missed 0     (R@1 97%, R@3 100%)   ← unchanged
```

**Identical.** Adding 74 independently-derived answers moved nothing, because
the reranker was already placing a valid answer first in 31 of 32 cases. The
headline number is robust to the completeness of the answer key.

What remains unmeasured: `paraphrase` and `source-period` have no objective
predicate, so their bias is untested, and the 2 "gold answers unsupported" are
places where a predicate is too tight or an expectation is wrong. Read 97% as
well-supported but resting on 32 queries, where one flip is 3 points.

Gemini remains the right choice, by a wider margin than before. Both models
handle Devanagari, transliteration and English names at 100%.

Documents embed with `RETRIEVAL_DOCUMENT`, queries with `RETRIEVAL_QUERY`.
The dimension is fixed at index creation; changing it means recreating the index.

## Retrieval: a similarity threshold is not enough

The eval's negative controls found that **no score cutoff cleanly rejects junk**:

```
0.449  "what is the capital of France"     rejected
0.496  "best pasta carbonara"              rejected
0.574  worst genuine match
0.575  "chicken tikka masala recipe"       indistinguishable
0.603  "how do I make pizza"               scores above every real match
```

Both failures are *recipe requests*. Embeddings match the shape of a query, and
"how do I make X" looks like a recipe document whether or not X appears in a
16th-century Sanskrit text.

So `minScore` (≈0.52) only filters non-food queries. **The grounding prompt does
the real work** — "answer only from the provided sources; if it is not there, say
so." Anti-hallucination is a prompt guarantee backed by retrieval, not a
threshold.

**Nor does reranking fix it — measured, not assumed.** The eval now scores
negative controls through the cross-encoder too, on its own scale, so the same
question can be asked of both stages. On `jina-reranker-v3`:

```
worst genuine match  -0.0806
best junk query      +0.0495     overlap of 0.1301
```

Junk outscores the weakest real answer, exactly as it does on cosine. A
smoke test had suggested otherwise — `bge` returned 0.947 for a correct record
against 0.002 for its neighbours — but that was one query, and across the full
negative-control set no cutoff separates the populations.

The `bge` version of this measurement is **unfinished**: Pinecone's 500/month
rerank quota ran out before it could run. So "can a cross-encoder reject junk"
is answered *no for Jina* and *unknown for bge*.

**Rejection therefore remains the grounding prompt's job**, backed by the fact
that every hit carries its own citation. Do not add a rerank-score cutoff
without re-running this on whichever reranker is actually in use.

Note that "chicken tikka masala" is a *correct* Tier-2 query. Once Tier 2 is
live it stops being a negative control and becomes a tier-routing decision.

## Retrieval: two stages

`lib/retrieval.ts` is the query path — dense recall, then cross-encoder
precision:

```
query ─► embedQuery ─► Pinecone topK=20 ─► bge-reranker-v2-m3 ─► top 3–5
         RETRIEVAL_QUERY   (recall)          (precision)
```

**Why two stages and not a better embedding.** One recipe is one vector built
from the whole record, so the single line naming a dish's ayurvedic property
competes against nine lines of ingredients and method. A bi-encoder compresses
the document in advance without knowing the query. At 24 records nothing else
was close; at 199, the 93 records carrying properties all crowd the same region.
The measured consequence, and what the reranker recovers:

| Recall@3 by category | dense | + rerank |
|---|---|---|
| devanagari / transliteration / english-name | 100% | 100% |
| source-period / paraphrase | 100% | 100% |
| **ingredient** | 80% | **100%** |
| **ayurvedic** | 100% | **100%** |

Names were never the problem. Properties were, and reranking is the stage that
reads query and document *together* rather than comparing two summaries.

Rank distribution, reranked: **31 of 32 queries answered at rank 1**, one at
rank 2, none missed. The remaining headroom is a single query.

**Field-scoped vectors are not needed, and this is why.** The plan was to embed
`properties.ayurvedic` as its own vector so property queries would stop
competing with method prose — a re-embed of the 93 records carrying properties.
Recall@1 per category settles it:

| ayurvedic | Recall@1 | Recall@3 |
|---|---|---|
| dense only | 60% | 100% |
| **+ rerank** | **100%** | **100%** |

Dense retrieval really is weak here: it puts the right record in the top three
every time but first only three times in five, which is exactly the dilution a
second vector would fix. The cross-encoder already fixes it completely. A second
index, a second sync path and a merge step buy nothing on top of 100%, so the
work is closed rather than deferred — revisit only if reranking is ever removed
or the ayurvedic figure regresses.

One defect worth recording, because it was invisible in every metric until the
per-category breakdown existed: `buildEmbeddingText` appends `properties` after
`Preparation`, the longest field, and the reranker truncates from the end. The
ayurvedic line — the entire reason for reranking those records — was being cut
off before the cross-encoder read it. `buildRerankText` exists to order fields
by what a query is likely to be *about*, and the eval and `lib/retrieval.ts` now
share it. They previously reranked two different strings, so the measured lift
was not the shipped one.

### Which reranker

`lib/rerank.ts` is a vendor seam, matching `provider.ts`: whichever key is
present wins, `RERANK_PROVIDER` forces a choice. Measured on the same 32-query
gold set, with `gemini-embedding-001` underneath:

| Reranker | R@1 | R@3 | MRR | devanagari R@1 |
|---|---|---|---|---|
| none (dense only) | 88% | 97% | 0.925 | 100% |
| **`bge-reranker-v2-m3`** (Pinecone) | **97%** | **100%** | **0.984** | **100%** |
| `jina-reranker-v3` | 91% | 94% | 0.933 | 75% |

**Jina is a downgrade here, and not a marginal one.** Its Recall@3 is *below
dense-only* — it demotes correct answers dense retrieval had already placed in
the top three — and Devanagari Recall@1 falls from 100% to 75%, which is the
multilingual capability this corpus most depends on. It is kept as a configured
option because its free allowance is generous enough to run the eval, which is
how these numbers exist at all. It is not the production choice.

`bge-reranker-v2-m3` is the model to run. The obstacle is only where to host it:
Pinecone caps the free plan at **500 rerank requests per month across the whole
organisation**, which one afternoon of evaluation exhausted. The weights are
Apache 2.0, so self-hosting is available and gives identical numbers.

### Failure behaviour

The reranker is a soft dependency: on failure `lib/rerank.ts` keeps the dense
ordering and logs, rather than returning nothing. An inference outage degrades
ranking quality; it must never turn into "no results", because declining is a
product decision made upstream.

That degradation is invisible from the product — Recall@1 drops from 97% to 88%
and nothing on screen changes — so **`npm run rerank:check` exists to make it
visible**. It sends a probe whose dense order is deliberately seeded wrong, so a
correct answer at rank 1 can only mean a real rerank happened. A configured key
proves nothing: the Pinecone key stayed valid throughout the month its quota
was spent.

Rate limits are retried rather than treated as failures. Jina allows 100,000
tokens per minute and one eval sweep is 216 reranks of twenty documents; the
first run silently degraded 43 queries to dense order and reported the result as
if reranking had happened. Backoff is measured in tens of seconds because the
limit is per minute.

`RERANK_CANDIDATES` (20) is the ceiling on what reranking can recover — a
document dense retrieval never returned cannot be reordered into the answer.
Each call is one rerank unit regardless of document count, so widening the
window costs latency, not billing.

## Invariants

1. `data/*.json` is truth; Pinecone is derived and disposable.
2. Ids are unique and permanent. Changing one deletes and recreates.
3. A sync only ever writes to and deletes from its own namespace.
4. Every vector carries `tier`; retrieval asserts it.
5. Tier 1 answers always cite `source.text`, `source.period`, and `source.url`.
6. Rule sets (substitutions, indianization) stay out of the vector store.
7. `verification_status` travels with every Tier-1 record — nothing is
   presented as confirmed history when it is `sourced-unverified`.

## Known gaps

- **No Tier-1 record is `verified`.** All 199 are `sourced-unverified` (195) or
  `sourced-needs-primary-check` (4). Retrieval must surface this, not hide it.
- **The gold set is a first pass, not an audit.** 40 of the 109 accepted
  answers were ticked in one review sitting against the record text; nobody has
  second-checked them, and the top-10 shortlist bias above is unresolved. It is
  good enough to stop the eval reporting nonsense, and not good enough to defend
  a published number.
- **32 queries is too few to tune against.** One query flipping moves Recall@1
  by 3 points, so the difference between 94% and 97% is a single result. Roughly
  100 queries would make these numbers stable enough to act on.
- **Tier 2 is unverified third-party data** and has no sync path. Check the
  Kaggle licence, and build a tier router, before either changes.
- **Gemini free-tier rate limits** will throttle a 5,898-record sync (~118
  batched requests). Sync needs pacing, not just retry.
- **Nothing consumes `lib/retrieval.ts` yet.** The query path exists and is
  measured; no application calls it.

Closed since the last revision: `aliases` are now populated on **178 of 199**
records, which is why devanagari, transliteration and english-name queries all
sit at 100%.
