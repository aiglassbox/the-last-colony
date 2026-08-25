# The Great Indian Food Restoration

A discovery machine, not a recipe app. Name a dish you eat every week and it
shows you what that dish was before colonial-era crop policy, export
agriculture and industrial milling rewrote it — then hands you a version you
can cook tonight.

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY or ANTHROPIC_API_KEY
npm run check          # validate the corpus, then prove retrieval
npm run dev
```

`npm run check` runs before anything else on purpose. The corpus is the
product; the chatbot is the interface.

## Two packages in this repo

The app is at the root. **`pipeline/` is a second, independent npm package** —
the retrieval engine that embeds a 199-recipe corpus into Pinecone and searches
it. Separate dependencies, separate `.env`, separate install:

```bash
cd pipeline
npm install
cp .env.example .env   # PINECONE_API_KEY, GEMINI_API_KEY, and a reranker key
npm run rerank:check   # confirm reranking is live, not silently degraded
npm run search -- "something that helps with digestion"
npm run eval           # measure retrieval quality
```

`npm run search` is the quickest way to see what the index actually holds. It
prints both scores: the dense score found the record, the rerank score ordered
it. When they disagree, the reranker is earning its place.

Neither package imports the other **yet**. The app still keyword-searches its
own 31-record corpus in `corpus/`, while 199 recipes sit indexed next door.
Connecting them is the open piece of work.

`pipeline/ARCHITECTURE.md` is the file to read first: what the invariants are,
how two-stage retrieval works, and every number that has actually been measured
rather than assumed.

### If you are picking this up

The Pinecone index is already populated — **199 vectors in `tier1-ancient`**, so
no sync is needed unless `data/recipes.json` changes. You need the keys, not the
data.

`rerank:check` before anything else. Reranking is worth 88% → 97% Recall@1, and
when its vendor is unreachable the code keeps working on dense results alone.
That failure is invisible from the product and has already gone unnoticed twice:
once when Pinecone's 500-a-month cap ran out, once when Jina throttled and 43
queries degraded silently mid-evaluation.

Reranker options and their ceilings are documented in `pipeline/.env.example`.
DeepInfra is wired and is the only one without a monthly cap, but its account
needs a balance — an unfunded key returns 402 and drops you to dense-only, which
is why `RERANK_PROVIDER` is currently pinned.

---

## How it is put together

Built in the order the brief specifies: corpus → retrieval → model → UI.

```
corpus/            JSON records, one per culinary item (the Part 3 contract)
  ancient/         the originals
  modern/          their modern counterparts, and modern-dish records
  swaps/           ingredient swap records
  localized/       precomputed per-language cards (localize:corpus), <lang>/<slug>.json
src/lib/corpus/    types, validator, file-backed repository
src/lib/lang/      normalize, reply-instruction, and the localized-card store
src/lib/retrieval/ normalisation, BM25, the threshold and ambiguity gates
src/lib/model/     system prompt, corpus block, streaming beat parser
src/lib/chat/      conversation state as an external store, localStorage-backed
src/app/           chat surface, /dish/[slug], API routes, 1080×1350 share card
tests/             132 hand-checked retrieval queries + multilingual query set
eval/multilingual/ Path A vs Path B language-retrieval benchmark + recorded report
```

### Two kinds of turn

It is a thread, not a card feed. Every turn is one of two kinds, and the
**server** decides which — the same place the retrieval gates live, rather than
a classifier guessing:

| Turn | When | Renders as |
|---|---|---|
| **Restoration** | the message names a dish retrieval can find | the four-beat card |
| **Conversation** | anything else, with the current dish carried forward | plain prose |

So "kheer" opens a card, "why did the jaggery go?" is answered against the
kheer records already on screen, and "what about dosa" swaps the card to dosa.
Prior turns are replayed to the model, capped at the last 20.

Threads persist in localStorage and are listed in the history drawer. There is
no account, and the product does not need one.

### The shell

Built on the supplied chat component — full-bleed backdrop, hook centred over
it, glass composer, quick-action pills. That design is an empty state, so it is
used as one: once a thread starts the backdrop and composer carry over and the
middle becomes the conversation. `Button` and `Textarea` are shadcn-shaped
(same `variant`/`size`/`asChild` API) but resolve to this product's tokens
rather than shadcn's theme, so there is only one colour system in the sheet.

The background is a solid fill from `--paper`. There is no image — the earlier
backdrop was a 5.6 MB PNG on a third-party bucket, which for a QR code opened
on phone data was the heaviest thing on the page.

### Light and dark

Every piece of chrome resolves through the tokens, so a theme is one attribute
flip on `<html>` rather than two sets of hardcoded classes. The toggle is in
the header.

- `:root` holds light, `:root[data-theme="dark"]` holds dark.
- The `prefers-color-scheme` block is scoped to `:root:not([data-theme])`, so
  it is a no-JS fallback only and an explicit choice always beats the OS.
- `THEME_INIT_SCRIPT` runs inline in `<head>` **before first paint**, so there
  is no flash of the wrong theme on load. `<html>` carries
  `suppressHydrationWarning` because that script writes the attribute before
  React hydrates, which is the whole point of it.
- The choice persists in localStorage; first visit follows the OS.

The background colour lives on `html`, not `body` — `html`'s background
propagates to the canvas, so it also covers overscroll.

### The line that keeps red line #1 closed

The model writes prose. It does not write citations — because it does not write
the part of the card citations live in.

Every citational element (ingredient table, ancient method, source strip,
provenance badge, contested points, Then/Now diff, nutrition delta, share
image) is rendered directly from the retrieved record. The model receives four
markers to fill with prose and an explicit instruction that a chapter, verse,
edition or page typed into that prose would be an unsourced claim by
definition. A record whose citation has not been verified has its locus
**withheld from the model entirely** — it cannot leak a page number it was
never given.

### Verification state

The Part 3 schema is implemented as specified, with one addition: every record
carries a `verification` block declaring whether a human has checked its locus
against the printed edition.

The validator enforces the consequences:

- `ATTESTED` requires `verification.status: "editor_verified"`. An unchecked
  citation cannot present itself as attested.
- An unverified record must have `original_text`, `transliteration` and
  `translation` set to `null`. Source-language text may only be entered by an
  editor reading the edition.
- A `MODERN_DISH` may not carry a source locus at all.

Nine records come from the editorial extraction *Recipes: Before British*
(`scripts/import-pdf-corpus.mjs`) and carry located, rendered passages — six
of them `ATTESTED`. Bedhai has the full Devanagari from *Pāka Śāstra* p. 169;
idli, dosa, dal, payasa and the kṣīra sweet have translations from the
Mānasollāsa dated 1129 CE.

**Five hand-authored seeds remain** — khichdi, roti, vada, poha, laddu. They
claim a text and a period but no verse or page, render a visible "unchecked"
mark on the badge, and the drawer says plainly that nobody has opened the
edition. Promoting one means filling in the locus and the passage and flipping
`verification.status`.

The extraction corrected three things the seeds had wrong, which is the
argument for doing the corpus first:

| | Seed said | Extraction shows |
|---|---|---|
| **Upma** | a modern dish (rava needs a roller mill) | predates the Raj as *arisi upma*; rava is the 1942 substitution |
| **Kheer** | jaggery was the ancient sweetener | *Pāyasa* was barely sweet — sugar went on at the table, not in the pot |
| **Dosa** | a rice-and-dal batter, `INFERRED` | split **chickpea**, no rice at all, `ATTESTED` at 1129 CE |

One thing deliberately not carried across: the *Pāka Śāstra* passage makes
Ayurvedic claims about what the dish cures. Those are recorded as part of what
the text says and never as a claim of this product's own.

### Multilingual queries: normalize before retrieval

The keyword engine is English, so a non-English query is translated to English
before it ever reaches BM25. `src/lib/lang/normalize.ts` makes one cheap,
greedy-decoded (`temperature: 0`) model call that detects the language and
returns the dish name in its common English spelling — `இட்லி`, `इडली` and
`idli kaise banti hai` all become `idli`. It runs on the eight active languages
(Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, English); anything
unsupported (Urdu, for now) or detected too weakly falls back to English and the
untranslated string, so retrieval always has something to run and never blocks
on the model. The echoed query keeps the user's own words; only retrieval reads
the translation. `npm run corpus:check-multilingual` exercises this end to end
(it calls the model, so it is a live check, kept out of `npm run check`).

This is the translate-then-retrieve path. It deliberately reuses the English
keyword engine below unchanged rather than leaning on cross-lingual vector
search — a wrong ancestor is worse than no ancestor, and the keyword gates are
where that discipline lives. That choice is measured, not asserted: the A/B eval
in `eval/multilingual/` runs both approaches on the real retrieval surface and
scores translate-then-BM25 at 41/41 against raw-vector's 34/41 (the vector path
mis-retrieves several dishes regardless of language). `npm run eval:multilingual`
regenerates `eval/multilingual/report.md`.

The reply is authored back in the user's language and register. `normalize` also
reports the language and register, and `src/lib/lang/reply-instruction.ts` turns
that into a per-turn instruction appended to the model turn — reply in Tamil in
its native script, or in Hinglish in Latin letters, mirroring exactly what the
reader typed and never "correcting" the script. An unsupported or weakly-detected
language replies in English and names, in one line, the languages that are
supported. The English health-claim and provenance strippers cannot see an
in-language violation, so that defence moves into the prompt rule and is verified
live by `npm run guards:check-multilingual`; the Latin provenance tokens
(`ATTESTED` and friends) are still stripped in any language.

The card itself is localized too — the ingredient table, method, axes, source
strip and labels, not just the prose. Those render from the record (rule 1), so
they are translated **ahead of time**, not by the model at request time: `npm run
localize:corpus` translates each searchable record into every active language
once and writes `corpus/localized/<lang>/<slug>.json` (committed, so a native
speaker reviews it in the PR). On a non-English hit the route loads that file
with no model call, and each field falls back to the English record if a
localization is missing. Source-language terms (`· māṣa`) stay as themselves.
`salt` becomes `नमक`/`উপ্পু`; the whole card reads in one language.

### Retrieval

Keyword-first, exactly as the brief requires. BM25 over dish names and aliases
only — ingredients and method belong to the vector index, and mixing them in
makes "coconut" retrieve six records. Vectors are the fallback (`searchVectors`,
wired to the 199-record index and on by default since the ordering fix): on a
keyword miss they ride along as *candidates* on a still-empty result, for the
model to promote only on a RESTORE verdict — never a retrieval decision on their
own. Set `VECTOR_FALLBACK=off` to disable.

Three gates decide when to decline, because a wrong ancestor is worse than no
ancestor:

| Gate | What it stops |
|---|---|
| Score threshold (`MIN_KEYWORD_SCORE`) | coincidental matches |
| Unknown-token veto | `misal pav` resolving to pav bhaji; `paneer tikka` to palak paneer |
| Ambiguity gate | `vada pav` — half-explained by two records, fully by neither |

Anything that declines is logged as `no_original_found` with a `[corpus-gap]`
prefix. That log is the roadmap for corpus expansion.

### When the dish isn't in the corpus

Declining is not the end of the answer. On an empty retrieval the route injects
the whole swap table as `<component_swaps>`, and the card becomes a component
restoration rather than an apology — ask for palak paneer and you are told its
cream can be hung curd or a ground kabuli chana paste, with the ratio attached.

The ratios come from the swap records, never from generation. A fabricated
quantity is the same class of failure as a fabricated verse, just quieter, so
the prompt requires quoting the block verbatim and saying "no ratio for that"
rather than estimating. Each entry also names the axis it wins on — protein,
fibre, glycaemic load — because "healthier" on its own is not a claim this
project makes, and some entries say outright that they win on flavour and
nothing else.

`tests/retrieval-queries.json` holds 132 hand-checked queries covering Hinglish
spellings, Devanagari and Tamil, and the traps above. The harness fails the
build on any **wrong** answer and on more misses than `ALLOWED_MISSES` (zero).

`tests/multilingual-queries.json` is the other set: the same dishes in native
scripts across the active languages, exercised end to end through the normalize
step by `npm run corpus:check-multilingual`. Because it makes model calls it is
a live check, not part of `npm run check`; the deterministic parsing logic has
its own keyless check at `npm run lang:check`.

### Model layer

Provider-agnostic behind `src/lib/model/provider.ts`. Everything above it — the
four-beat contract, the corpus block, turn-mode routing, the beat parser — is
just prose generation, so swapping vendors is one implementation rather than a
rewrite of the route.

Selection is by whichever key is present, with `MODEL_PROVIDER` as the override
when both are:

| Provider | Default model | Notes |
|---|---|---|
| **Gemini** | `gemini-2.5-flash` | The Gemini 3 models list as available and then 429 without quota. `GEMINI_THINKING_BUDGET=0` by default — thinking is on for 2.5 and nothing streams until it finishes, which reads as a dead screen. |

> ⚠️ **The current key is on the Gemini free tier: 20 requests per day, per
> model.** An afternoon of testing spends it. Quota exhaustion is reported as
> its own error rather than "try again", because retrying cannot fix it. The
> daily budget is per model, so `GEMINI_MODEL=gemini-2.5-flash-lite` buys a
> fresh 20; a billed key removes the ceiling.
| **Anthropic** | `claude-opus-5` | Frozen system prompt in a cached block, volatile content after the breakpoint. `RESTORATION_EFFORT=low` for the same latency reason. |

Prompt caching is Anthropic-specific here; Gemini 2.5 does implicit caching on
its own and needs no breakpoint.

#### The provenance tripwire

Gemini's first output on this prompt ended `§THEN§` with *"This is an ATTESTED
dish"* — for a record that is `RECONSTRUCTED` and not yet verified, with a
badge saying exactly that a centimetre above. That is red line #1 arriving by
accident.

Two changes came out of it. The prompt now forbids naming the provenance class
in prose at all, on the same grounds as citations: the badge renders the real
class from the record, so a class the model types is duplication at best and a
contradiction on the same screen at worst. And `src/lib/model/guards.ts` audits
every completion for provenance words, certainty claims against unverified
records, and chapter/verse shapes, logging `[provenance-leak]` when it finds
one.

The tripwire is not the protection — the reader is protected because the badge
and source strip come from the corpus regardless of what the model says. It
exists so a prompt regression shows up in the logs rather than in a screenshot
on X.

Responses are streamed as NDJSON: one `meta` event carrying the turn mode and
the records, then either `delta` events tagged by beat (restoration) or `text`
events (conversation), then `done`. The card renders its record half the moment
`meta` lands, before the model has written a word. A missing API key costs the
prose, not the card.

Both output formats live in one system prompt rather than two, because the
prompt is the cached prefix — one frozen block every request shares is worth
more than a marginally shorter one that splits the cache. Which mode applies is
stated in the user turn, after the breakpoint, where it costs nothing.

---

## Working on the corpus

Add a record under `corpus/ancient/` or `corpus/modern/`, then:

```bash
npm run check
```

Rules the validator will hold you to, beyond the schema: ancient records need a
`modern_counterpart_id` (the diff is the product), aliases may not collide
across records, and slugs are public URLs so they must be kebab-case. Write a
`share_verdict` on anything that ships — it is the share image's headline and
the card's fallback verdict, and it is deliberately editorial rather than
generated.

When you add a dish, add its query variants to `tests/retrieval-queries.json`
too — including at least one near-miss that must **not** match it.

---

## Launch email tracking

The Kranti Cookbook launch email is a single hosted image with three clickable
regions, sent from Outlook as a VBA mail merge rather than through an ESP. There
is no click data unless this site produces it, and these routes are that. They
exist for one campaign and answer one question — how many people clicked each
CTA.

| Route | What it does |
|---|---|
| `GET /r?c=<code>&t=<tid>` | Records the click, 302s to the destination for `<code>` |
| `GET /px.gif?t=<tid>` | 43-byte transparent GIF, records an open |
| `GET /unsubscribe?t=<tid>` | Records a suppression, says so in one line |
| `GET /api/email-report` | The numbers, behind `EMAIL_REPORT_TOKEN` |

The email itself is a single image sliced into bands — `public/email-assets/` —
with the three button rows split into left/button/right cells so each CTA is
its own link. An image map would be one line, but Outlook renders mail through
Word and ignores `<area>`, which would silently break the CTAs for a large share
of a 2,000-contact list. The assembled, mail-merge-ready HTML is
`docs/kranti-launch-email.html`; substitute each contact's token for `{{TID}}`.

The three codes, in `src/lib/email/destinations.ts`:

| code | CTA in the image | goes to |
|---|---|---|
| `ai` | DISCOVER THE KRANTI COOKBOOK AI | this site, UTM-tagged |
| `film` | WATCH THE FILM | the YouTube film |
| `post` | READ THE POST | the Instagram account |

### The two rules

**The destination only ever comes from the server-side map**, looked up by a
short code. A URL arriving in the query string is never redirected to. That is
an open redirect, and it is how a sending domain ends up on a blocklist a week
before it matters.

**The tracker is never allowed to break a CTA.** An unknown code, a missing
token, a database that is down or was never configured — every one of them ends
in a 302 to somewhere real, with the failure in the log and nothing on the
reader's screen. `db()` returning null is a supported state here, the same as it
is for the conversation mirror. The write runs in `after()`, so the redirect is
flushed before the database is touched at all; measured at ~5ms with the
database deliberately broken.

### What is stored, and what is not

No email addresses. `tid` is the opaque per-contact token from the mail-merge
sheet, and the mapping back to a person lives in the campaign's spreadsheet,
deliberately not on the server. In place of an IP address the events table holds
a salted sha256 of address and user agent, truncated to 24 characters — enough
to tell one reader's three clicks from three readers' one each, which is the
only question it is asked.

The salt is not optional in substance, only in configuration: an unsalted hash
of an IPv4 address is reversible by brute force in minutes, because there are
only four billion of them. `TRACK_SALT` supplies one explicitly; unset, the
connection string is used, which is already secret, already present and stable
for the life of the deployment. Set it explicitly only if the connection string
might be rotated mid-campaign — the salt would change with it and the same
reader would then count as two people.

### The bot filter is not optional

Mail security appliances and image proxies click every link in an email before a
human sees it, within seconds of delivery. `looksAutomated()` in
`src/lib/email/track.ts` flags them, every reported number excludes them, and
the report prints the automated share so the filter can be sanity-checked before
anyone quotes a figure. Without it the click rate is fiction — typically several
times the real one and weighted entirely toward whichever corporate domains were
on the list.

### The tables create themselves

`npm run db:migrate` creates `email_events` and `email_suppressions` ahead of
time, and that is still the tidy way to do it. But the tracker also creates them
on its own the first time a write finds them missing, and that is not belt and
braces — it is the difference between a campaign that reports and one that does
not. The migration is a step somebody has to remember on the day of the send,
the credential needed to run it may be write-only in Vercel, and the failure
mode if it is skipped is the worst available: every click dropped, the site
completely healthy, and nothing saying so until someone asks for the numbers and
gets zero.

The recovery is memoised per process, so a launch-day spike produces one
`create table` attempt rather than one per click, and is cleared on failure so a
database that was briefly unreachable is retried rather than written off.

### Reading the numbers

With a connection string:

```bash
npm run email:report -- --sent 2000             # clickers per link, CTR, bot/human split
npm run email:report -- --sent 2000 --tokens    # adds the per-contact hot list
```

Without one — the Vercel integration can store the Neon credential write-only,
so the people running the campaign may be able to deploy the site but not read
the database it is already talking to:

```
/api/email-report?token=<EMAIL_REPORT_TOKEN>&sent=2000[&tokens=1]
```

`EMAIL_REPORT_TOKEN` is a new variable, chosen by whoever sets it up, so it can
be created without being able to read anything that already exists. Unset, the
route 404s; a wrong token gets the same 404, so probing cannot establish that a
report exists. Both surfaces share `src/lib/email/report.ts` — one set of
queries, one formatter — so they cannot disagree.

The per-token breakdown is opt-in on both (`--tokens`, `&tokens=1`). It is the
closest thing here to personal data and should be asked for on purpose.

---

## Known gaps

- **The share image renders in a fallback sans-serif.** Satori needs an
  embedded font file and none is shipped, so the card loses the serif display
  face the rest of the product uses. Drop a `.ttf`/`.otf` in and pass it via
  the `fonts` option in `src/app/api/share/[slug]/route.tsx`.
- **Vector retrieval is a stub.** The interface is in place and threshold
  discipline is written to cover it; the pgvector implementation is not.
- **Multilingual: input and reply both live.** A query in any of the eight
  active languages (Hindi, Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada,
  English), in native script or Hinglish, is detected and translated to English
  before retrieval (`src/lib/lang/`), and the reply is authored back in the
  reader's own language and register (`reply-instruction.ts`). There is no UI
  language toggle: detection is automatic from the message. The choice of
  translate-then-retrieve over cross-lingual embeddings is backed by the A/B eval
  in `eval/multilingual/`. Urdu is deferred (right-to-left layout is out of scope
  pending review); it is detected but answered in English, with a line naming the
  supported languages.
- **Analytics goes to the console.** `track()` is a one-function shim over a
  real sink.
- **Eight ancient records await editorial verification** — see above. This is
  a state, not a bug, and the product says so out loud on every card.
