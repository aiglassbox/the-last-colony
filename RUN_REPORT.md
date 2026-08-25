# Run Report

Ran on 2026-08-21. Node v24.16.0, npm 12.0.1. Windows 11.
Every `npm run` script in both packages, invoked with `.env` already in place.

**Addendum 2026-08-22 — multilingual accessibility (Slices 1–3).** New language
normalize step (`src/lib/lang/`), reply-language mirroring (`reply-instruction.ts`
+ the `VOICE` block), non-English guard coverage, and the Path A vs B eval
(`eval/multilingual/`). Their checks are the four multilingual rows below
(`lang:check`, `corpus:check-multilingual`, `guards:check-multilingual`,
`eval:multilingual`). Full gate (`npm run check`, `npm run lint`, `npm run build`)
re-run clean after the changes.

## Legend

- **PASS** — exit 0, did what it should.
- **PASS (degraded)** — exit 0, but an external service was rate-limited and the
  script fell back. Result still correct; the fallback is worth knowing about.
- **BLOCKED** — exit non-zero because a required env var is missing. Not a code
  bug; fill the var and it runs.
- **NOT RUN** — deliberately skipped (mutates external state or spends real API
  budget). Reason given per row.

---

## Root package (`the-last-colony`)

| Command | Script | Result | Notes |
|---|---|---|---|
| `npm run corpus:validate` | validate-corpus.ts | **PASS** | 31 records, 14 swaps valid. 5 records `RECONSTRUCTED`, awaiting editorial verification (khichdi, laddu, poha, roti, vada) — cannot render ATTESTED. Expected, not an error. |
| `npm run corpus:check-retrieval` | check-retrieval.ts | **PASS** | 132/132 hand-checked queries pass. Reranker now DeepInfra Qwen3-Reranker-4B (was Pinecone bge, which 429'd on its 500/month cap). No rerank errors, no degradation. Fixed by adding `DEEPINFRA_API_KEY` + `RERANK_PROVIDER=deepinfra` to root `.env` — see below. |
| `npm run lang:check` | check-lang.ts | **PASS** | 8/8 deterministic checks for the language pure functions (parse, fallback, `isSupported`). No model, no network — keyless, safe anywhere. |
| `npm run corpus:check-multilingual` | check-multilingual.ts | **PASS** | 9/9 end-to-end: native-script + Hinglish queries across the 8 active languages normalize to English and retrieve the right record; junk still declines. Live (calls the model), so deliberately kept out of `npm run check`. Stable across repeated runs after `temperature: 0` + dish-name-for-search normalization. |
| `npm run guards:check-multilingual` | check-guards-multilingual.ts | **PASS** | Non-English guard leak check. Drives a health-baiting Hindi and Tamil turn through the real `SYSTEM_PROMPT` + `replyInstruction`, then a second model call judges the reply — both CLEAN (the model pivots to comparative nutrition in-language rather than a body claim). Live, not in `check`. |
| `npm run eval:multilingual` | eval/multilingual/run.ts | **PASS** | Path A vs Path B benchmark on the real retrieval surface. **Path B (production, translate→BM25) 41/41 absolute; Path A (raw→vector) 34/41** across 41 variants / 11 dishes / 8 language buckets. Confirms the translate-then-retrieve routing. Live; writes `eval/multilingual/report.{md,json}` (committed). |
| `npm run check:routing` | check-routing.ts | **PASS** | 166/166 routing checks pass. One informational `[rate-limit]` line: no `x-forwarded-for`/`x-real-ip` in test request, so callers share one 240/5min allowance. Set header at proxy in prod. |
| `npm run check:cache` | check-cache.ts | **PASS** | Gemini context cache live and read. model `gemini-3.6-flash`, system prompt 31757 chars, 7634 tokens cached, 100% hit rate over 2 turns. |
| `npm run check` | (validate + check-retrieval + check:routing) | **PASS (degraded)** | Aggregate of the three above. Green overall; carries the Pinecone-rerank 429 degradation. |
| `npm run lint` | eslint | **PASS** | Clean, no output. |
| `npm run build` | next build | **PASS** | Next 16 build OK. Routes prerendered: `/`, 31 `/dish/[slug]` SSG pages, dynamic `/api/*`, `/r`, `/px.gif`, `/unsubscribe`, sitemap/robots. |
| `npm run db:migrate` | db-migrate.ts | **PASS** | `DATABASE_URL` now set. Tables ready (idempotent, `IF NOT EXISTS`): conversations **208 rows**, email_events **4025 rows**, email_suppressions **690 rows**. |
| `npm run report:usage` | usage-report.ts | **PASS** | 167 devices, 208 conversations, 648 messages over 10 days (2026-08-12 → 08-21). Peak 08-15 (69 threads). Most asked: Upma 11, Idli 10, Dosa/Pasta 5. |
| `npm run email:report` | email-report.ts | **PASS** | Launch email: 737/2000 clicked (36.85% CTR). Top links film 1214 / ai 1200 clicks. 694 human opens, 690 unsubscribes. 10.3% traffic automated. |

## Pipeline package (`pipeline/`)

| Command | Script | Result | Notes |
|---|---|---|---|
| `npm run sync:dry` | sync.ts --dry-run | **PASS** | Loaded 199 recipes. 0 to upsert, 199 unchanged, 0 to delete. Pinecone index already in sync. Nothing written. |
| `npm run rerank:check` | check-rerank.ts | **PASS** | Reranker vendor **deepinfra**, model **Qwen/Qwen3-Reranker-4B**. Probe put correct doc first, 0.9860 clear of second. This is the prod reranker — working. |
| `npm run gold:review` | gold-review.ts | **PASS** | 199 recipes, 32 queries, depth 10. Real embed + rerank ran. **Wrote `eval/gold-review.md`** (109 pre-ticked, 237 candidates to judge). |
| `npm run gold:audit` | gold-audit.ts | **PASS** | 11 queries audited. Gold holds 57 of 131 findable answers (44% shortlist bias). Read-only audit. |
| `npm run search -- "..."` | search.ts | **PASS** | End-to-end query ("a cooling summer drink") returned ranked recipes with dense + rerank scores. Full retrieval path works. |
| `npm run make-today` | make-today-sheet.ts | **PASS** | Wrote `data/make-today-sheet.md` (25 records). Scaffold sheet — yaml blocks to fill by hand. |
| `npm run sync` | sync.ts | **NOT RUN** | Mutates Pinecone (upserts vectors). Dry-run above shows nothing pending anyway. |
| `npm run index:setup` | setup-index.ts | **NOT RUN** | Creates/mutates the Pinecone index. Destructive-ish; index already exists. |
| `npm run normalize:tier2` | normalize-tier2.ts | **NOT RUN** | Writes normalized Tier-2 data files. Not needed for a health check. |
| `npm run eval` / `:verbose` / `:rerank` | eval-embeddings.ts | **NOT RUN** | Embedding bake-off — many embed + rerank calls, real API spend. Skip unless benchmarking. |
| `npm run gold:audit:write` | gold-audit.ts --write | **NOT RUN** | Write variant of the audit above. |
| `npm run gold:apply` / `:dry` | gold-apply.ts | **NOT RUN** | Applies edited gold ticks back into the set. Run only after hand-editing `gold-review.md`. |

---

## What's missing

1. **`DATABASE_URL` — RESOLVED.** Set to the pooled Neon string. All three DB
   scripts now pass; `db:migrate` reports live tables (208 conversations, 4025
   email events, 690 suppressions).

2. **Pinecone rerank quota — RESOLVED (pointed root app at DeepInfra).**
   `bge-reranker-v2-m3` had hit its 500 rerank/month org cap (`429
   RESOURCE_EXHAUSTED`). Root cause was config, not code: `rerank()` already
   selects DeepInfra first (`activeReranker`, pipeline/lib/rerank.ts:312), but
   root `.env` was missing `DEEPINFRA_API_KEY` (the key lives in `pipeline/.env`,
   and the two packages load separate env files). Root scripts fell through the
   selection ladder to Pinecone.
   **Fix:** copied `DEEPINFRA_API_KEY` + `RERANK_PROVIDER=deepinfra` from
   `pipeline/.env` into root `.env` (backup at `.env.bak`), and documented the
   retrieval/rerank keys in `.env.example`. Re-ran `corpus:check-retrieval` →
   132/132, no 429, no dense degradation. Root app now reranks via DeepInfra
   Qwen3-Reranker-4B, same as the pipeline.
   Vector query was never affected — index + dense retrieval worked throughout.

## What's running properly

- All corpus/routing/cache checks green (`npm run check`).
- Lint clean, production build succeeds.
- Pipeline retrieval fully live: Gemini embeddings, Pinecone index (199 vectors,
  in sync), and DeepInfra Qwen3 reranking all working end to end.

## Side effects from this run

Two scripts write files by design (both git-tracked, review before committing):

- `pipeline/eval/gold-review.md` — modified by `gold:review`.
- `pipeline/data/make-today-sheet.md` — (re)written by `make-today`.

## Env keys present (inferred from behavior, not read)

- Gemini / Google GenAI — embeddings + cache work → key present.
- Pinecone — index reachable, sync works → key present (rerank quota aside).
- DeepInfra — Qwen3 reranker works → key present.
- `DATABASE_URL` — **present** (pooled Neon string). DB live: 208 conversations,
  4025 email events, 690 suppressions.

---

## How to access the data behind `DATABASE_URL`

The URL is a standard Postgres connection string to a **Neon** serverless
database. Three ways in, cheapest first. **Never commit the URL** — it carries
the password inline.

### 1. The scripts already do it (no SQL needed)

- `npm run report:usage` — conversation-mirror stats (devices, threads, most-asked).
- `npm run email:report` — launch-email clicks/opens/unsubscribes.
  Add `--tokens` for the per-contact breakdown, `--sent <n>` for the real
  denominator.
- `npm run db:migrate` — creates/verifies tables, prints row counts. Safe to
  re-run (idempotent).

### 2. Raw SQL with `psql`

```bash
psql "postgresql://…pooler…neon.tech/neondb?sslmode=require"
\dt                          -- list tables
SELECT COUNT(*) FROM conversations;
SELECT * FROM email_events ORDER BY id DESC LIMIT 20;
```

Neon requires TLS — append `?sslmode=require` if `psql` complains.

### 3. Neon web console

Log in at console.neon.tech → this project → **SQL Editor** or **Tables**
browser. Same data, point-and-click, no local client.

### What lives there (three tables, no vectors)

| Table | Holds |
|---|---|
| `conversations` | Thread mirror — `data jsonb` per conversation. Device-first, DB-second copy. |
| `email_events` | Launch-email tracking: clicks (`/r`), opens (`/px.gif`), per link + human/automated. |
| `email_suppressions` | Unsubscribed tokens (`/unsubscribe`). |

Vectors are **not** here — those live in Pinecone. This DB is plain Postgres:
JSON + text/hash columns only.

### Connection-string note

Use the **pooled** host (`…-pooler.…neon.tech`) for the app and route handlers —
per-request invocation would otherwise open a fresh connection each time. Use the
**direct** (non-pooled) host only for migrations or long transactions if pooling
ever gets in the way.

> **Security:** the string in `.env` includes the DB password. Keep it out of
> git, logs, screenshots, and any external service. Rotate it in the Neon
> console if it has been exposed.
