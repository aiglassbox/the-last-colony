# DECISIONS.md

The architectural and product decisions in this codebase worth knowing before
you change something near them — what was chosen, what the alternative was,
and why. Pulled from code comments, README.md, and pipeline/ARCHITECTURE.md.

---

## Retrieval

**Keyword-first (BM25), not vector-first, over the app's 31-record corpus.**
BM25 runs over dish names and aliases only — never ingredients or method.
Mixing them in makes a common ingredient like "coconut" retrieve six unrelated
records. Vectors are the fallback, not the default.
→ `src/lib/retrieval/bm25.ts`, `retrieve.ts`

**Vector hits are always candidates, never direct hits.** Wiring the pipeline's
199-record vector index in as a first-class "hit" caused 18/132 wrong
ancestors in testing (butter chicken → an unrelated 12th-century dish; "asdfgh"
→ watermelon at score 0.57, indistinguishable from a correct match at 0.72).
No score threshold reliably separates good vector matches from bad ones — the
fix was ordering, not thresholding. A vector hit can only become an answer
after a model explicitly issues a `RESTORE` verdict.
→ `src/lib/corpus/load.ts`, `src/lib/retrieval/retrieve.ts`

**Three gates, not a single confidence score.** Score threshold
(`MIN_KEYWORD_SCORE = 1.2`) alone doesn't stop a plausible-but-wrong match, so
retrieval also runs an unknown-token veto (a query with a word matching
nothing in a doc's vocabulary is rejected, unless it owns a full alias phrase)
and an ambiguity gate (half-explained by two records, owned fully by neither —
"vada pav" — declines rather than guessing). A wrong ancestor is considered
worse than no ancestor, so all three gates bias toward declining.
→ `src/lib/retrieval/retrieve.ts`, `tests/retrieval-queries.json`

**Foreign dishes are vetoed before any scoring happens.** A curated list of
~130 non-Indian dish names (`foreign-dishes.ts`) short-circuits retrieval
entirely for queries like "dosa pizza fusion" — otherwise BM25 would cleanly
match "dosa" and attach a real ATTESTED citation to an invented fusion dish.
This list is deliberately separate from `indianization/rules.json`'s `foreign`
arrays, which contain component words (butter, cheese, noodles) that would
wrongly veto legitimate Indian dishes like "butter chicken" if used for this
gate.

**Bare ingredient words are stopwords for dish retrieval.** "rice", "atta",
"oil", "sugar" etc. are excluded from the BM25 vocabulary — they belong to the
swap tool (`/api/swap`), not dish search, otherwise "rice" would resolve to
whichever rice dish happens to score highest.
→ `src/lib/retrieval/normalize.ts`

---

## Multilingual

**Translate-then-retrieve (Path B), not cross-lingual embeddings (Path A).** A
non-English query is translated to English and then run through the unchanged
English keyword engine, rather than embedding the raw multilingual query and
leaning on vector search. The task brief marked cross-lingual embeddings
"recommended", but the retrieval code disagrees: vectors here are a
decline-not-decide fallback (a wrong ancestor is worse than none), and making
them the primary path for a whole language class would move retrieval onto the
seam the three gates exist to distrust. Path A was kept as a benchmark so the
choice was made from data, not asserted — and the data confirms it. The A/B eval
(`eval/multilingual/`, run on the real production surface: `normalize` +
`retrieveForDish` for B, `searchVectors` for A) scores **Path B 41/41** correct
across 41 queries in 8 language buckets, against **Path A 34/41** — the raw-vector
path mis-retrieves poha, kheer and bedhai regardless of language, exactly the
decline-not-decide failure the gates guard against. Gemini embeddings are strongly
cross-lingual (39/41 consistent), so Path A stays recorded as the benchmark to
revisit *if* retrieval ever moves vector-first, but translate-then-BM25 ships.
→ `src/lib/lang/normalize.ts`, `src/lib/retrieval/retrieve.ts`, `eval/multilingual/report.md`

**Detection + translation is one greedy model call, not a JS language library.**
Libraries detect Indic scripts passably but fail on the actual target inputs —
romanized Indic and Hinglish. One `gemini-flash` call handles all of it and
reuses the provider seam already in the app. It runs at `temperature: 0`: the
same dish name must map to the same English token every time, or retrieval
flakes (observed directly — Bengali "দোসা" alternated between hitting and
missing at the default temperature until decoding was made greedy).
→ `src/lib/lang/normalize.ts`, `src/lib/model/provider.ts`

**`english` is the dish name for the search index, not a sentence translation.**
Because the translated string feeds BM25, `normalize` is told to return the dish
name in its common spelling ("dosa", not "dhosa" or "dosai"), so "idli kaise
banti hai" retrieves on "idli" rather than on "how is idli made" — which the
keyword engine would miss.

**`lang` is the sentence's language; a dish name never sets it.** "how to make
taal?" was classed Bengali because taal is a Bengali dish, and the whole card
came back in romanized Bengali. Dish and ingredient names are loanwords in every
language, so the detector judges only the words around them. English in,
English out; romanized Bengali in, romanized Bengali out. The same rule keeps
the dish name as typed: "taal" is never glossed to "palm fruit" or guessed as
"dal", because a guessed name retrieves the wrong record.
→ `src/lib/lang/normalize.ts`, `tests/multilingual-queries.json`

**Detection failure degrades to English, never throws.** An unsupported language
(Urdu, for now), confidence below `CONFIDENCE_THRESHOLD`, malformed JSON, or a
quota/network error all resolve to the English fallback: reply in English,
retrieve on the untranslated string. Retrieval must always have something to run;
a lost translation must never cost the reader an answer.
→ `src/lib/lang/types.ts` (`enFallback`)

**Urdu is deferred, not unsupported in principle.** It is right-to-left and needs
layout work outside this feature's scope, so it is detected but routed to the
English fallback pending a senior review. The eight active languages are Hindi,
Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, English.

**Reply-language mirroring shipped after input handling, deliberately in that
order.** Getting a non-English query to retrieve correctly landed first, at
lowest risk; authoring the reply back in the user's language and register came
second, once retrieval was proven. Mirroring is three parts: the `VOICE`
`## WHICH LANGUAGE` block was rewritten from English-only to reply-in-the-
question's-language-and-register (`BRIEF_PROMPT` untouched, per the freeze);
`reply-instruction.ts` builds the per-turn rule (which language, native/roman/
Hinglish register, or English + a supported-languages line on a fallback),
appended to both turn builders in the chat route like `PLAIN_WORDS`; and the
register is mirrored, never "corrected" — native script in, native script out.
→ `src/lib/model/system-prompt.ts`, `src/lib/lang/reply-instruction.ts`, `src/app/api/chat/route.ts`

**Guards stay English-lexical; non-English coverage is the prompt plus a live
check, not a per-language wordlist.** The health-claim and provenance strippers
are English regex and go blind in Hindi or Tamil. Translating every banned
phrase into seven languages would be an unbounded, low-confidence net that guards
worse than the alternative, so the in-language defence is the prompt rule in
`reply-instruction.ts` ("no health claims … in {lang}"), verified by
`npm run guards:check-multilingual` (a real non-English turn, judged by a second
model call). The highest-stakes leak — a model typing the Latin token `ATTESTED`
— is still caught in any language, because the provenance class tokens are Latin.
→ `src/lib/model/health.ts`, `src/lib/model/provenance.ts`, `scripts/check-guards-multilingual.ts`

**The record-derived card is localized as precomputed data, not a per-turn call.**
The prose beats mirror the reader's language, but the ingredient table, method,
axes and source strip render from the record — English. A record's translation
is deterministic (the idli card in Hindi is always the same bytes), so it is a
build-time artifact: `localize:corpus` translates each searchable record ×
language once into `corpus/localized/<lang>/<slug>.json` (committed, reviewable),
and the route loads the file on a non-English hit with no model call. Chosen over
a per-turn translation because it is free at request time, adds no latency, and —
being committed JSON — is native-speaker-reviewable in the PR, the same trust
model as the corpus. Every field falls back to the English record when a
localization is missing, short, or stale (a content-hash guards staleness).
→ `src/lib/lang/localize.ts`, `src/lib/lang/localized-store.ts`, `scripts/localize-corpus.ts`

**Translation touches only what already renders; rule 1/2 hold.** It is a
reviewed data transform, not the model writing a citation live, so the render-
from-record rule stands. The verified/unverified gate is untouched: an unverified
record's locus/edition are never in the translate payload, exactly as
`renderRecord` withholds them from the model. Source-language terms (`· māṣa`)
and the historical dish name stay as-is — proper nouns. Numeral style is
best-effort and left inconsistent by decision: the prompt asks for Western digits
but the model sometimes returns native numerals (`২`, `১/৪`); making it
consistent is a deterministic card-side digit map if ever wanted, not a prompt
change.
→ `src/lib/lang/localized-card.ts`, `src/lib/model/corpus-block.ts`

---

## Corpus and provenance

**A record's citation is enforced structurally, not by convention.** The
validator (not the UI) enforces: `ATTESTED` requires
`verification.status === "editor_verified"`; an unverified record's
`original_text`/`transliteration`/`translation` must all be `null`; a
`MODERN_DISH` cannot carry a source locus. A record that hasn't been checked
against the printed edition literally cannot present source-language text —
there's no code path that would let it.
→ `src/lib/corpus/validate.ts`

**The model never writes a citation.** Every citational element (ingredient
table, ancient method, source strip, provenance information, Then/Now diff,
nutrition delta, share image) renders directly from the retrieved record. The
model fills four prose markers and is explicitly told that a chapter, verse,
edition, or page it types would be an unsourced claim by definition. This is
enforced two ways: the UI structurally can't render model-authored citation
content (`RestorationCard.tsx` only reads from `records`, never parses a
citation out of `beats`), and the prompt (`system-prompt.ts`) forbids it.

**Provenance class is banned from model prose entirely, not just graded
correctly.** After Gemini's first output on this prompt said "This is an
ATTESTED dish" for an unverified, `RECONSTRUCTED` record — with a badge saying
otherwise a centimetre away — the fix wasn't "tell the model to grade
correctly," it was "the model must never name the provenance class in prose at
all," on the theory that a class the model types is duplication at best and a
contradiction at worst, since the badge already renders the real class from
the record.
→ `src/lib/model/provenance.ts`, `src/lib/model/system-prompt.ts`

**Detection and removal are two separate layers.** `guards.ts` audits and logs
what slipped through (`[provenance-leak]`); `provenance.ts` actually removes
it. This split exists because an earlier version had detection without
removal — the audit logged `provenanceClaims: ["ATTESTED"]` on a card while
the word still shipped to the reader. Detection-only was judged insufficient
after that incident.

**No visual "provenance badge" taxonomy pill.** The UI deliberately doesn't
show a `RECONSTRUCTED`/`ATTESTED`/`MODERN DISH` pill, on the grounds that it
asks readers to learn jargon. Instead, `RECORDLESS_NOTE` gives a plain-English
reason per `TurnKind` (why no older version exists — a `gap` implies one could
be documented later, a `foreign` dish never will), and `SourceStrip`/
`SourceDrawer` show verified-vs-unverified as a factual statement, not a
category label.
→ `src/components/RestorationCard.tsx`

**Ingredient rows with no real content are omitted, not filled with
placeholders.** `EMPTY_MARKERS` (unspecified, not recorded in this source,
n/a) are filtered out of the ingredient table's quantity/function columns
entirely rather than rendered as dashes; a single trailing sentence notes what
the source is silent on. A cut "why" cell in a model-authored recipe row is
left blank rather than filled with a label-only word — a category word alone
("flavour") without an actual clause is treated as no information.
→ `src/lib/model/recipe-beat.ts`, `src/components/RestorationCard.tsx`

**A blank beat/sentence is an acceptable outcome; a fabricated or ungrammatical
one is not.** Every text-cleaning pass in `src/lib/model/` (health claims,
provenance claims, self-reference) follows the same rule: if cutting the
offending clause would leave a grammatical stump, drop the whole sentence
instead. If everything in a beat gets cut, the beat renders empty rather than
patched with invented text. The one exception is the self-reference passes,
which never empty the *whole turn* — a reply that only introduced its speaker
would be worse than the unfixed original.

**`TurnKind` was expanded from two booleans to four explicit states.** The
route originally tracked `empty`/`modern` as independent booleans, which
conflated "we hold no record" (a corpus fact) with "this dish isn't Indian" (a
dish fact) — a pizza query was shown "not in the restored corpus yet," which
falsely implies a record could someday exist. `record`/`modern`/`gap`/
`foreign` now name the real states explicitly; legacy persisted messages are
migrated via `kindOf()`.
→ `src/lib/chat/turn.ts`

---

## Model / prompt engineering

**One system prompt, two output modes, not two prompts.** RESTORATION and
CONVERSATION output formats live in the same `SYSTEM_PROMPT` rather than being
split into separate prompts, because the prompt is the cached prefix — one
frozen block every request shares is worth more than a marginally shorter one
that splits the cache. Which mode applies is stated in the user turn, after
the cache breakpoint, where it costs nothing.

**No worked examples in the prompt for recordless formats.** Placeholder
patterns (like `<ingredient> :: <quantity> :: <why>`) are used instead of
filled example rows, because a filled example got echoed back verbatim — "the
line offered for a burger was the burger line, word for word." Same reasoning
for the six Indianisation VERDICT examples: deliberately generic shapes, not
filled text.

**Forbidden phrases aren't shown verbatim in the prompt.** A documented A/B
test: naming the exact hedge phrase to avoid ("as an AI...") caused the model
to reproduce that exact phrase in 5/5 replies; describing the requirement
positively instead (no quoted forbidden text) produced correct behavior 5/5
times. Applied throughout `OUTPUT_CONTRACT`.

**The model is "the cookbook itself," explicitly not a person.** `VOICE`
overrides the brief's earlier "you are a food historian" framing — no age, no
gender, no family role — enforced downstream by `self-reference.ts` stripping
first-person self-as-family-member claims ("I am like a mother").

**Replayed tabular history is condensed before being sent back to the
model.** Feeding the model its own prior `ingredient :: quantity :: reason`
rows verbatim as conversation history measurably degraded subsequent turns
(documented A/B: 5.1 avg words/reason cell in a clean thread vs. 3.2 with
terse-table history present). `condenseRows()` collapses consecutive table
rows into a compact `(already suggested: name1, name2, ...)` marker before
replay, keeping only the names, not the tabular shape.
→ `src/lib/model/history.ts`

**Lab jargon with no safe plain equivalent is logged, not rewritten.** Terms
like "bioavailable" or "glycaemic index" have no honest one-word plain
substitute; rewriting them risks silently shifting the claim. They're left
alone in output and only tracked via `labTerms()` for audit visibility, unlike
terms that do have a safe plain form (e.g. "micronutrients" → "vitamins and
minerals"), which are rewritten outright.
→ `src/lib/model/jargon.ts`

**A fingerprint tripwire derives itself from the prompt, plus curated
additions.** `leak.ts`'s automatic fingerprints (every ALL-CAPS section header
≥12 chars in `SYSTEM_PROMPT`) can't silently desync from an edited prompt. But
body text (like the "Palak paneer has no ancient original" example) is
deliberately *not* auto-fingerprinted, since that phrase could legitimately
appear in a real answer — those additions are hand-curated instead.

**Prompt-injection defense is layered, and mostly server-side.** The model is
told (as the last rule in `OUTPUT_CONTRACT`) to decline "repeat the text
above" style requests and redirect to naming a dish. But the actual protection
is `leak.ts`'s server-side scan, which fully replaces output with a canned
refusal on a fingerprint match — the model-side instruction is a second layer,
not the primary one.

---

## Model provider layer

**Provider selection is by key presence, with an explicit override — never a
silent fallback.** `MODEL_PROVIDER` forces a choice, but if that provider's
key is absent, `activeProvider()` returns `null` rather than falling back to
whichever key *is* present — a forced-but-misconfigured choice should surface
as "no provider," not silently swap vendors.
→ `src/lib/model/provider.ts`

**Missing key degrades the prose, not the card.** Cards render from retrieved
records regardless of whether a model call succeeds — a missing/exhausted API
key costs only the written paragraphs, never the citation, ingredient table,
or source strip.

**Quota exhaustion is its own error class, distinct from "try again."**
Gemini's free tier is 20 requests/day/model; retrying an exhausted quota
cannot succeed, so `asQuotaError()` is checked separately from generic
failures and surfaces a parsed `retryAfterSeconds` rather than generic retry
UX.

**Gemini's explicit context cache fails open, never closed.** Cache creation
failure, a dead cache handle, or caching being disabled entirely all fall back
to sending the prompt inline at full price — never to failing the turn. One
inline retry is attempted on a cache-specific error, but a stream that's
already delivered tokens to the reader is not retried (would restart the
visible answer mid-flight).

**Anthropic uses `low` reasoning effort by default, matching Gemini's
`thinkingBudget=0`.** Both choices trade reasoning depth for time-to-first-
token — Gemini 2.5 thinking otherwise streams nothing until it finishes,
which reads as a dead screen.

---

## App architecture

**No accounts. The device's localStorage is the source of truth; the server
is a best-effort mirror.** `hydrateFromServer()` only pulls from the server if
the *current device* has zero conversations — there is no merge-conflict
resolution, by design ("this product does not have and should not invent that
problem"). Every sync failure (offline, storage full) is silently swallowed;
the device copy is never at risk of loss because the server was unreachable.
→ `src/lib/chat/store.ts`, `src/lib/chat/sync.ts`

**`db()` returning `null` is a supported state everywhere, not an error
condition.** No `DATABASE_URL` configured means: no conversation sync, no
email tracking writes, no report data — every caller checks for `null` and
degrades to "as if the feature didn't exist" rather than throwing. This one
convention underlies the entire email-tracking system's reliability guarantee
(a tracker must never break a CTA).

**A storage-agnostic repository interface exists even though only one
implementation does.** `CorpusRepository` is the seam a future
Postgres+pgvector backend would satisfy without anything above it changing —
written in now, even with only `fileCorpus` behind it, specifically so that
migration is additive rather than a rewrite.
→ `src/lib/corpus/repository.ts`

**Rate limiting is abuse-prevention, not a security boundary.** The in-memory
limiter keys on `x-forwarded-for`, which is client-controlled and spoofable.
It exists to protect a free-tier model quota from accidental loops and
scripts, explicitly not documented as defense against a determined attacker.
It also resets on process restart and doesn't span multiple instances — an
accepted tradeoff for a single-node deployment.
→ `src/lib/rate-limit.ts`

**Analytics beacons have their own rate-limit budget, separate from chat.**
`/api/track`'s `MAX_BEACONS = 120` per window is its own namespace so a reader
opening several source drawers can't exhaust the quota needed to answer their
next dish query.

---

## Email tracking (launch campaign)

**The destination for `/r` comes only from a fixed server-side map — never
from the query string.** This is described in-code as "the whole security
model" for that route: a URL supplied by the caller is never redirected to,
which is what prevents the route from being an open redirect (and the sending
domain from landing on a blocklist).
→ `src/lib/email/destinations.ts`

**The tracker must never break a CTA.** Every failure mode — unknown code,
missing token, database down or unconfigured — still ends in a 302 to
somewhere real, logged server-side, with nothing visible to the reader. The
write happens in `after()`, after the redirect is already flushed (measured
at ~5ms with the database deliberately broken).

**No email addresses or IPs are stored.** In place of an address, the events
table holds `sha256(salt|ip|user-agent)` truncated to 24 characters — enough
to distinguish one reader's three clicks from three readers' one click each,
which is the only question it's asked. A salt is not optional in substance
(an unsalted IPv4 hash is brute-forceable in minutes — only 4 billion
values), only in configuration: it defaults to a hash of `DATABASE_URL`
(already secret, already stable) rather than requiring a separately-remembered
secret.
→ `src/lib/email/track.ts`

**The email report route fails closed on a missing token, and an unknown
token gets the identical response as "unconfigured."** No `EMAIL_REPORT_TOKEN`
set means every request 404s — a report route that's open by default because
someone forgot a variable is considered worse than no route at all. A wrong
token produces the exact same 404 as no token, via a `timingSafeEqual`
compare, so probing can't even establish that the route exists.
→ `src/app/api/email-report/route.ts`

**Tables self-heal on first write, in addition to an explicit migration
script.** `npm run db:migrate` is still the tidy way to set up, but
`logEvent()`/`suppress()` also auto-create their tables on a missing-table
error, memoized per process so a launch-day traffic spike produces one
`create table` attempt, not one per click. This exists because the credential
needed to run a migration may be write-only in a hosting integration — the
failure mode of skipping the migration step is otherwise silent zero-tracking
with a completely healthy-looking site.

**Bot/proxy traffic is filtered, and the filter's health is reported, not
assumed.** Mail security appliances click every link in an email within
seconds of delivery. `looksAutomated()` excludes that traffic from headline
numbers, and the report prints the automated share with a >70% warning so a
broken filter is caught before anyone quotes a number from it.

**An unsubscribe is processed on a plain GET, with no confirmation step.**
Considered a deliberate asymmetric-cost tradeoff: over-suppressing (a bot
scanner clicks the link) costs one skipped future email; under-processing a
real unsubscribe costs a spam complaint. The costlier failure direction is
avoided even at the cost of the safer-looking confirmation UX.

---

## Pipeline package (`pipeline/`)

**Namespace-per-tier in Pinecone, not one namespace with a tier filter.**
Sync deletes any vector id in its namespace that's absent from its source
JSON file. If Tier 1 and Tier 2 shared a namespace, a Tier-1 sync would see
thousands of Tier-2 ids as "unrecognized" and delete them. Namespacing makes
that structurally impossible rather than merely unlikely — and every vector
also independently carries `tier` in its metadata, so retrieval can assert
what it expects rather than trust the namespace alone.

**Substitution/indianization rules are not embedded, even though they could
be.** They're matched by explicit `triggers`/`role` fields, not semantic
similarity — 26 records totaling ~8KB, loaded from JSON and matched in memory.
A vector store here would add a sync path that can fail and buy nothing.

**Two-stage retrieval (dense recall + cross-encoder rerank), not a better
single embedding.** One recipe is one vector built from the whole record, so a
single ayurvedic-property line competes against nine lines of ingredients and
method in the same vector. Measured: dense-only ingredient-category Recall@3
was 80%; with rerank, 100%. A second field-scoped vector index was considered
and rejected — the cross-encoder alone already closes the gap to 100%, so a
second index/sync path/merge step was judged to buy nothing.

**No similarity-score threshold can reject junk queries — measured, not
assumed, on three separate rerankers.** Negative-control junk ("how do I make
pizza") scored *above* the weakest genuine match on cosine similarity, and the
same overlap was independently reproduced on `jina-reranker-v3` and
`Qwen3-Reranker-4B`'s own scales. Rejection is therefore the grounding
prompt's job ("answer only from the provided sources; if it's not there, say
so"), backed by the fact that every hit carries a citation — not a score
cutoff at either retrieval stage.

**DeepInfra's Qwen3-Reranker-4B is the pinned default reranker, not
Pinecone's bundled bge-reranker.** They score identically on the gold set
(97% R@1), but Pinecone's free tier caps at 500 rerank requests/month
org-wide — a cap that has already been hit once. DeepInfra bills per token
with no monthly ceiling. Jina is kept configured (its free tier unblocked the
evaluation that produced these numbers) but is explicitly documented as a
downgrade in production — its Recall@3 is *below* dense-only, and Devanagari
Recall@1 falls from 100% to 75%.

**The reranker is chosen per process, from whichever `.env` that process
loaded — and the root app and `pipeline/` load different ones.** `activeReranker()`
reads `process.env`, populated by `dotenv/config` from the *root* `.env` when a
root script or the Next.js app runs, and from `pipeline/.env` when a pipeline
script runs. The DeepInfra key lived only in `pipeline/.env`, so the app's vector
fallback fell through the selection ladder to Pinecone/bge and hit the 500/month
cap — even though `pipeline/`'s own scripts were correctly on DeepInfra. The fix
is not code (the ladder already prefers DeepInfra): the root `.env` must carry
`DEEPINFRA_API_KEY` + `RERANK_PROVIDER=deepinfra`, and `.env.example` now
documents the retrieval/rerank keys so the gap is discoverable. In production
(Vercel) the same keys must be set as project env vars.

**A reranker outage degrades to dense-only, loudly logged — never to "no
results."** This exact silent-degradation failure has happened twice in
practice (once from Pinecone's monthly cap, once from Jina rate-limiting 43
queries mid-evaluation). `npm run rerank:check` exists specifically because
the degradation is invisible from the product otherwise — Recall@1 drops from
97% to 88% and nothing on screen changes. The check uses a probe with
deliberately-wrong dense ordering, so a correct top result can only mean a
real rerank call happened; a merely-present API key proves nothing (a key can
stay valid through an entire month its quota was silently exhausted).

**Rate-limit backoff for reranking is measured in tens of seconds, not a
quick retry** — because the observed limit (Jina, 100k tokens/minute) is
per-minute, and a short retry interval just re-hits the same window.

**`data/*.json` is the single source of truth; Pinecone is derived and
disposable.** Deleting the index and re-running `npm run sync` fully rebuilds
it. This is why the JSON files are version-controlled and the index is not
backed up separately — reproducibility from source beats backing up a derived
cache.

**Record ids are permanent.** Sync is keyed on `id`; changing an existing id
reads to the sync process as "delete this record, add an unrelated new one" —
there is no rename operation.

**The gold evaluation set's own bias is measured, not assumed away.** Because
it was built from reviewers looking at each query's top-10 candidates, it can
only contain answers the retriever already ranked well — a risk of
rubber-stamping the system with its own output. `gold:audit` runs 11
objective, retriever-independent predicates (an ingredient the record must
list, an indication its ayurvedic field must state) over the full 199-record
corpus and found the curated gold set holds only 57 of 131 objectively valid
answers (44% complete). The sensitivity check — evaluating against the
expanded 2.3×-larger answer key — returned an **identical** Recall@1 (97%),
which is the actual argument that the headline number is robust despite the
gold set's incompleteness.

**Historical "make today" quantities are never generated, only curated by
hand.** `make-today-sheet.ts` deliberately produces an empty scaffold for a
human to fill, rather than inventing measurements — the historical `quantity`
field is often qualitative ("cut into pieces"), and inventing numbers for it
would be "writing recipes and calling them history." The same restraint
applies in `keepTraditional()`: the safety-relevant filter is a `caution`
flag, not a naive "declined" `direction` value, specifically because a prior
bug filtering on `direction === "down"` silently dropped sugar guidance from
every sweet-dish recipe (76 of them) — and because some transitions with a
"down" direction on one axis (rock salt → iodised salt, solid fuel → LPG) are
real public-health gains that must never be told to "reverse."

---

## Product-level rules (from AGENTS.md, still binding)

1. **The model never writes a citation** — enumerated above, restated here
   because it's the rule every other provenance decision serves.
2. **An unverified record cannot claim `ATTESTED`, carry original-language
   text, or have its locus given to the model.** Structural, in the validator.
3. **Retrieval declines rather than guesses** — below threshold, on an
   unknown token, or on ambiguity, return empty and log the gap.
4. **No health claims anywhere** — comparative nutrition on a named axis only,
   never a verdict on the reader's health.
5. **No communal or ethnic framing** — colonial economic policy is documented
   history; attributing dietary change to a religious or ethnic community is
   not, and the prompt is instructed to decline it outright.

---

## Community submissions (Add Your Recipe) — settled 2026-09-01

**Deterministic tag-match at query time, not embeddings.** The AI pipeline
normalizes each submission's dish name into a canonical tag plus alias
spellings once, at ingestion; retrieval does a token match against those or
nothing. Pinecone embedding of submissions and Atlas Search were considered
and rejected: nearest-neighbour serving is what the retrieval gates exist to
prevent, and Atlas Search is proprietary lock-in ahead of a planned GCP
migration. A missed spelling falls through to the existing AI fallback — the
status quo, not a regression.
→ `docs/superpowers/specs/2026-09-01-add-your-recipe-design.md`

**AI moderates (GREEN/RED), operator outranks it.** No human approval queue —
one structured model call issues the verdict and the dish tag; GREEN goes live
immediately. A separate fail-closed admin route (`/pantry`, `ADMIN_PASSWORD`)
can override per doc and download GREEN submissions as corpus candidates.
RED submissions stay in the DB, rejected but never deleted.

**Atlas free tier is the test home, photos and all.** Photos live base64 on
the document (client-compressed, ~500 KB cap) rather than Vercel Blob —
one store to migrate to GCP later, 512 MB ceiling accepted for the test
phase. Access goes through one thin module so the store swaps behind one file.
Fail-soft when `ATLAS_*` is unset, same posture as `db()`.

**Form location outranks edge geo on the record; edge geo picks at query
time.** The submitter's stated State is what the recipe *is*; the querier's
Vercel region only chooses which GREEN version to serve, and its absence
(localhost) degrades to most-recent.

**Model split by job.** Verdict + tagging on `gemini-3.1-flash-lite`
(classification, lite tier); image extraction on `gemini-3.6-flash`
(handwriting, regional scripts, already the repo default). Names in env vars.

**Extraction is a separate call, and the human confirms before anything is
stored.** `POST /api/submissions/extract` reads the photo on
`gemini-3.6-flash` and returns fields; the form prefills, the submitter
corrects, and `POST /api/submissions` stores their confirmed words as
`submission` with what the model read kept beside it as `extracted`. Nothing
the model read is ever stored as the submitter's words unconfirmed. The
verdict runs over the confirmed text, not the raw reading — and it sees the
photo, in both modes, because a served community card carries it.

**The verdict runs in `after()`, not inline.** The 201 is flushed first; a
verdict that outlives the platform timeout can no longer become a failed
response the form retries as a duplicate. A lost verdict leaves the doc
`pending` for a `/pantry` re-run.

**The pantry wears the kitchen's door.** One gate factory, two instances:
same constant-time compare, same signed 12-hour cookie, same ten-attempt
budget per five minutes, and the same 404 for "no password configured" and
"wrong cookie" alike. The pantry has its own password (`ADMIN_PASSWORD`) and
its own cookie, because it shows submitters' contact details and a kitchen
session must open nothing there. The auth route is a factory too; the kitchen's
route shrank to naming its gate.

**A corpus candidate carries no contact and can never claim ATTESTED.** The
pantry's download is a GREEN submission in the corpus record's shape, for a
human to incorporate by hand: `MODERN_DISH`, `unverified_seed`, no
original-language text (rule 2), no photo, and the submitter's contact left
behind in the store. Humans remain the only writers of corpus files. An
operator's override is final: `verdict.overridden_at` is stamped, and neither a
late verdict callback nor a re-run may write over it.

**The model reports the language; the form stopped asking.** "Language you are
writing in" was a dropdown the submitter answered and nothing trusted. It had
two failure modes with no correct answer: type English, pick Marathi, and the
store believes a lie; write Hinglish, and no option on the list is right.
Neither is a mistake the reader can be blamed for, and both steer Phase 4's
translation — a submission labelled `en` skips the Hindi translation a Hindi
reader needs. The verdict model already reads the whole submission, so it names
the language as part of the same call, gated through `isSupported` so a
hallucinated code cannot reach the store, and `""` when it cannot tell. The
prompt judges language, not script: romanized Hindi is `hi`, romanized Marathi
is `mr`, English carrying borrowed dish names is `en`. It lands in `dish`
beside the tag and aliases, because `dish` is the model's output block and
`submission` is verbatim as submitted. Documents written before this carry
`submission.language`; `candidate.ts` and the pantry read the new field first
and fall back to the old one.

**Published is a view over GREEN, not a fourth status.** The model writes
`status`; a human writes `published_at`. Two authorities, two fields, and a
published recipe still belongs in Green — the Green list just marks it. Serving
reads `status: "green"` **and** `published_at` present, so a submission the
model cleared but nobody reviewed is never on the site. Publishing refuses a
document with no `dish.tag`, because an untagged document matches nothing and
would sit in Published where no reader can reach it. Once published, a document
is closed to the model: `applyVerdict` filters on `published_at: { $exists:
false }` exactly as it already filters on `verdict.overridden_at`, and a re-run
is refused with a 409 telling the operator to unpublish first. A move to RED
unsets `published_at` in the same write — leaving it would keep serving a
recipe an operator just rejected. Unpublish `$unset`s rather than nulls: the
verdict guard tests for absence, and a null would block every future verdict on
that document forever.

**The pantry's buttons follow the document, not the tab.** The action set is
derived from `status` plus `published_at` on the open submission, so marking a
recipe RED from the Green tab changes the buttons on the next render instead of
leaving Mark Published pointing at a rejected document. The store is still the
enforcement — every action re-checks its own preconditions — but a button that
is guaranteed to fail is a bug, not a safety net. Pending deliberately has no
Mark GREEN: that path is what produces an untagged green document. Rejecting
junk needs no tag; approving does.

**Seeded rows are honest about being seeded.** The retrieval path could not be
tested without data, and dummy data proves nothing about matching, so twelve
real regional dishes were researched from the web and run through the real
intake pipeline — validator, verdict model, publish — rather than written
straight into the store. Three rules make them safe to leave in a public
archive. `display_name` is exactly `Arpit's Agent` on all twelve, so agent rows
are one filter away from reader rows forever. `belongs_to` is `my own` and
every story is a sourced regional note, never an invented family memory: this
archive's whole value is that the stories are true, and a fabricated
grandmother would be a false personal claim sitting in public. `contact` is on
`example.invalid`, which RFC 2606 reserves so it can never route anywhere.
Sources live in the seed script beside each entry, not in the submission — the
form has no source field and inventing one for twelve rows would be a schema
change nothing else needs.

**The seed dishes were chosen to be unreachable from `corpus/`.** All eleven
distinct names score 0.00 against the keyword engine, well under
`MIN_KEYWORD_SCORE`, so each falls through to the community step instead of
being answered from a corpus record. This is why the geo scenario is puran poli
rather than the vada pav the earlier spec used: `vada pav` scores 4.02 against
the corpus `Vada` record and never reaches the community lookup at all.
Substituting a dish without re-running that probe silently voids the test.

**The community match scans, it never compiles a regex.** A stored alias is
model output living in a document a member of the public submitted, so
`new RegExp(alias)` would hand that text the regex engine — the one function in
the serving path a hostile submission can reach. `phraseMatches` walks the
normalized query with `indexOf` and checks the boundaries by hand: a phrase
matches when the query equals it, or contains it bounded by string start/end or
a space. `puran poli` matches, `puran` does not, `puranpoli` does not, and
`apuran polix` does not. Both sides go through `normalizeDish` and nothing else,
which is what makes the match deterministic; aliases are re-normalized on read
even though the pipeline stores them normalized, because a document written
before that was true must not slip through.

**Three states carry more than one region code.** `geo.region` is ISO 3166-2 and
`submission.state` is a full name, so a map between them is unavoidable — and
compared directly, the geo rule would never fire and every reader would silently
fall through to recency. That is the failure mode this phase most had to avoid:
it passes every offline test and is still wrong in production. Vendors disagree
on three of the thirty-six, so all spellings are accepted rather than guessed:
Odisha as `OR` or `OD`, Uttarakhand as `UT` or `UK`, and Dadra and Nagar Haveli
and Daman and Diu as `DH`, `DN` or `DD`. Two keys pointing at one name cost a
line and remove a whole class of silent never-match. The raw region value is
logged on `community_served` so the guesses can be confirmed against real
traffic and the losing spellings deleted. A check asserts every value in the map
is a member of `STATES`, because a typo there is otherwise permanent and silent.
