import type { NextRequest } from "next/server";

import { track } from "@/lib/analytics";
import { parseCommand } from "@/lib/chat/commands";
import { parseResolved, RESOLUTION, type TurnKind, type TurnMode } from "@/lib/chat/turn";
import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";
import { isDeviceId } from "@/lib/db/conversations";
import { geoProps } from "@/lib/events/geo";
import { normalize } from "@/lib/lang/normalize";
import { replyInstruction } from "@/lib/lang/reply-instruction";
import { renderIndianizationBlock } from "@/lib/indianization";
import { BeatParser, INDIANIZE_BEATS, MarkerParser, type StreamingParser } from "@/lib/model/beats";
import { renderComponentSwaps, renderCorpusBlock, renderRecord } from "@/lib/model/corpus-block";
import { condenseRows } from "@/lib/model/history";
import { auditProse, isClean } from "@/lib/model/guards";
import { lastSentenceEnd, MAX_SENTENCE_HOLD, stripHealthClaims } from "@/lib/model/health";
import { restoreIndianWords } from "@/lib/model/indian-words";
import { plainWords } from "@/lib/model/jargon";
import { stripProvenanceClaims } from "@/lib/model/provenance";
import { findLeak, LEAK_HOLD, LEAK_REFUSAL } from "@/lib/model/leak";
import { dropNarration, dropSelfAsPerson, stripOpener } from "@/lib/model/self-reference";
import { danglingTail, styleProse } from "@/lib/model/punctuation";
import { activeProvider, asQuotaError, MAX_TOKENS, RefusalError } from "@/lib/model/provider";
import { SYSTEM_PROMPT } from "@/lib/model/system-prompt";
import { checkRate, clientKey } from "@/lib/rate-limit";
import { retrieveBySlug, retrieveForDish } from "@/lib/retrieval/retrieve";

/**
 * The conversation endpoint.
 *
 * Retrieval still owns the deterministic half: when BM25 finds a corpus dish,
 * the turn is a RESTORATION, full stop — precise, gated, no model in the loop.
 *
 * The open-ended half is the one retrieval cannot answer with a name list:
 * when nothing matches, is this a follow-up about the dish on screen, a foreign
 * dish to Indianise, a modern Indian dish with no ancient original, or an Indian
 * dish simply not in the corpus yet? That is a world-knowledge question, so on a
 * corpus MISS the model decides — it declares the mode on its first line and we
 * route the rest of the stream accordingly. The corpus-hit path never consults
 * the model, so its precision is untouched.
 *
 * A leading slash command (from the composer pills) is a directive appended to
 * whichever turn the server chose. It narrows the answer; it never changes the
 * turn kind or relaxes the corpus rules.
 */

export const dynamic = "force-dynamic";

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  messages?: ClientMessage[];
  /** Records behind the card currently on screen, carried across follow-ups. */
  activeRecordIds?: string[];
  /** Set when the user arrived on /dish/[slug] — bypasses search entirely. */
  slug?: string;
}

function encodeEvent(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

/** Prior turns, replayed as plain text. Long threads are trimmed from the front. */
const MAX_HISTORY_TURNS = 20;

/**
 * Markers only an Indianisation card has. `VERDICT` is shared with a
 * restoration and says nothing about which turn this is, so it is not here.
 */
const INDIANISE_ONLY = /§\s*(REBUILD|SWAPS|PLATE)\s*§/i;

/**
 * How much of any one turn is read.
 *
 * The limiter bounds how many requests arrive and never how large they are, so
 * twelve requests could still be half a million tokens: a forty-thousand
 * character query was accepted and forwarded to the model in full. Twenty
 * replayed turns multiply it.
 *
 * Truncated rather than refused. Somebody pasting a recipe in to ask about it
 * should get an answer, not a 400, and the answerable part of an over-long
 * message is at the front of it. Generous enough that no real question reaches
 * it — a dish name is three words and a follow-up is a sentence.
 */
const MAX_TURN_CHARS = 2000;

/**
 * The vocabulary ban, restated in the turn instruction.
 *
 * It is already in the output contract, and the contract lost. The brief above
 * it demonstrates the phrase in a worked example ("Palak paneer has no ancient
 * original"), and a demonstration outranks a rule — the same lesson the
 * replayed-history fix taught, arriving from the other direction. The brief is
 * verbatim campaign copy and is not ours to edit, so the correction goes where
 * it can win: the user turn, last thing before the model writes.
 *
 * Measured across four dishes, the three that took the resolve path had this
 * in their turn and stayed clean, while the one that hit the corpus did not
 * and opened on "Pav bhaji has no ancient original". Same contract, same
 * model, different last instruction. So both paths now carry it, from one
 * constant, because two copies of a rule is how the next drift starts.
 */
const PLAIN_WORDS =
  "\nDo not write \"ancient original\", \"not a restoration\", \"the corpus\" or " +
  "\"provenance\" anywhere in your prose. Those are our filing words, not the " +
  "reader's, and the brief above uses them only to explain itself to you. Say it " +
  "plainly instead: there is no older version of this dish, or we do not have " +
  "this one written down. And do not open §VERDICT§ on the dish's age at all " +
  "when the card states that itself, directly beneath your text: open on what is " +
  "specific to THIS dish.\n" +
  "The worked examples above use palak paneer. They show a shape, not a sentence " +
  "to hand back. If the reader has named palak paneer, that is the one dish whose " +
  "verdict you must write from scratch.";

export async function POST(request: NextRequest) {
  // Ahead of the body read: a turn that will be refused should not spend the
  // work, and this endpoint is the one that spends model quota.
  const rate = checkRate(clientKey(request));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests just now. Wait a moment and try again." },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  const history = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => typeof m?.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: m.content.slice(0, MAX_TURN_CHARS),
    }));
  const latest = [...history].reverse().find((m) => m.role === "user");
  const raw = (latest?.content ?? "").trim();

  if (!raw && !slug) {
    return Response.json({ error: "a user message or slug is required" }, { status: 400 });
  }

  // A leading slash command is a directive, not part of the dish name — it is
  // stripped before retrieval sees the text. Parsed here rather than trusted
  // from a request field, so typing `/oil-match dosa` by hand behaves exactly
  // like tapping the pill.
  const { command, rest } = parseCommand(raw);
  const query = rest;

  // A slug is already canonical, so it is not normalized. A typed query may be
  // in any of the eight languages, so detect and translate it to English before
  // the (English) keyword engine sees it. The echoed `label` stays the user's
  // own words; only retrieval reads the translation.
  const normalized = slug ? null : await normalize(query);
  const retrieval = slug
    ? await retrieveBySlug(slug)
    : await retrieveForDish(normalized!.english);

  // Authored in the user's language, appended after the turn instruction the
  // same way PLAIN_WORDS is. A slug entry has no detected language, so it
  // replies in English.
  const langRule = normalized ? replyInstruction(normalized) : "";

  // A slug names a record directly, so an empty result means the slug is not
  // one. Asking the model about it invites an answer about some other dish
  // entirely: `does-not-exist` has come back as a confident card about palak
  // paneer, which is the prompt's own worked example resurfacing as an answer.
  // The page route already refuses an unknown slug; the API has to as well.
  if (slug && retrieval.empty) {
    return Response.json({ error: "not in the restored corpus" }, { status: 404 });
  }

  const isResolve = retrieval.empty && !slug;
  const label = slug || query;
  const provider = activeProvider();

  /* Whose turn this is, as far as anything here can know. The client sends the
     same id it files threads under, so every event below can be joined to the
     conversation it produced — which is what makes "of the people who arrived,
     how many got an answer" a computable number rather than two unrelated
     counts. Absent when the browser has storage switched off, and the events
     are still worth logging without it. */
  const device = isDeviceId(request.headers.get("x-device-id"))
    ? request.headers.get("x-device-id")
    : null;

  /* Where the request came from, as the edge resolved it. Read once here and
     attached to every event this turn writes — see `lib/events/geo.ts` for why
     this is a country rather than an address. */
  const geo = geoProps(request.headers);

  track("dish_queried", {
    ...geo,
    device_id: device,
    query: label,
    via: slug ? "slug" : "search",
    hit: !retrieval.empty,
    command: command?.slug ?? null,
    provider: provider?.vendor ?? "none",
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encodeEvent(obj));

      // A slash command with no dish behind it. There is nothing to retrieve
      // and nothing to restore, so this is not a card at all — it used to fall
      // through to the resolver, which rendered the model's hook question
      // inside an empty restoration card and stamped "not in the restored
      // corpus yet" onto a dish the reader had not named. Ask for the dish as
      // prose, and never involve the model: the answer is known here.
      if (!slug && !query) {
        emit({
          type: "meta",
          mode: "conversation" satisfies TurnMode,
          kind: null,
          top_score: 0,
          records: [],
        });
        emit({
          type: "text",
          text:
            command?.ask ??
            "Name one Indian dish you eat almost every week, and I will show you " +
              "what it used to be.",
        });
        emit({ type: "done" });
        controller.close();
        return;
      }

      // The record half of a card owes nothing to the model, so a missing key
      // costs the prose and not the card.
      if (!provider) {
        // Without a model, a corpus miss cannot be resolved at all — and a card
        // is exactly the wrong guess, because every reason a card could state
        // is one the model was going to decide. Retrieval either found a record
        // or it did not, so say only that.
        emit({
          type: "meta",
          mode: (retrieval.empty ? "conversation" : "restoration") satisfies TurnMode,
          kind: retrieval.empty ? null : ("record" satisfies TurnKind),
          top_score: retrieval.top_score,
          records: retrieval.records,
        });
        emit({
          type: "error",
          message:
            "No model key is set (GEMINI_API_KEY or ANTHROPIC_API_KEY), so there " +
            "is no written reply. Anything rendered from the corpus is unaffected.",
        });
        emit({ type: "done" });
        controller.close();
        return;
      }

      // Characters that actually reached the reader. Not the same as what the
      // model wrote: a restoration turn is parsed for §markers§, and prose that
      // never emits one is dropped on the floor by the parser.
      let emitted = 0;
      /** Set when the completion started reproducing the prompt. */
      let leaked: string | null = null;

      /** Drains a model stream into card beats or prose; returns the full text. */
      async function pump(
        iter: AsyncIterator<string>,
        first: string | undefined,
        parser: StreamingParser | null,
        asProse: boolean,
        /**
         * Called when a restoration turn's completion turns out to be an
         * Indianisation. Returns the parser to switch to; everything read so
         * far is re-parsed through it and whatever was already on screen is
         * redacted first.
         */
        onFrameRefused?: () => StreamingParser,
      ): Promise<string> {
        let full = "";
        let carry = "";
        // Nothing is emitted until the opening of the completion has been read.
        // A prompt dump begins at the first token, so holding briefly catches it
        // with the card still blank; text already on screen cannot be recalled.
        let pending = "";
        let released = false;
        /** Whether anything the reader will keep has been emitted yet. */
        let opened = false;
        /** Whether the turn has already been re-declared as an Indianisation. */
        let refused = false;

        const release = (text: string) => {
          if (!text) return;
          if (asProse) {
            // The concession the conversation rules ban, taken off the front of
            // the turn. Only the front: `opened` stays false while everything
            // released so far has been stripped away, so a reply that opens on
            // two of them loses both, and never runs again after real text.
            const out = opened ? text : stripOpener(text);
            if (!out.trim() && !opened) return;
            opened = true;
            emitted += out.length;
            emit({ type: "text", text: out });
          } else if (parser) {
            for (const d of parser.push(text)) {
              emitted += d.text.length;
              emit({ type: "delta", ...d });
            }
          }
        };

        const push = (text: string) => {
          if (!text || leaked) return;
          full += text;

          // The model was handed a record and told RESTORATION, and wrote an
          // Indianisation anyway. It is right often enough that the frame is
          // what gives way: a fusion under a provenance badge and a source
          // strip is the one thing this project must not render, and the
          // markers it wrote would otherwise reach the reader as literal text
          // in the verdict headline. So the turn becomes what the completion
          // actually is, and the record leaves the screen with the badge.
          if (onFrameRefused && !refused && INDIANISE_ONLY.test(full)) {
            refused = true;
            parser = onFrameRefused();
            if (emitted) emit({ type: "redact" });
            emitted = 0;
            released = true;
            pending = "";
            release(full);
            return;
          }

          if (!released) {
            pending += text;
            leaked = findLeak(pending);
            if (leaked || pending.length < LEAK_HOLD) return;
            released = true;
            release(pending);
            pending = "";
            return;
          }

          // Past the opening, a fingerprint can still appear, and it can span a
          // chunk boundary, so the tail of what came before is checked with it.
          leaked = findLeak(full.slice(-(LEAK_HOLD + text.length)));
          if (leaked) return;
          release(text);
        };

        const flushPending = () => {
          if (leaked || released || !pending) return;
          released = true;
          release(pending);
          pending = "";
        };

        // A rewrite can land on a chunk boundary, so the trailing fragment it
        // might be part of is held back until the next chunk shows what follows.
        //
        // The unit is a sentence, not a character, because a health claim can
        // only be judged against the whole sentence: the adjective is cut where
        // the sentence survives without it and the sentence is dropped where it
        // does not. Half a sentence cannot be told apart from either.
        //
        // A conversation turn gets one rewrite the card turns do not: a
        // sentence describing the last answer is throat-clearing in prose, and
        // on a card there is no last answer to describe.
        const clean = (text: string) => {
          const styled = dropSelfAsPerson(
            restoreIndianWords(
              plainWords(stripProvenanceClaims(stripHealthClaims(styleProse(text)))),
            ),
          );
          return asProse ? dropNarration(styled) : styled;
        };

        const handle = (chunk: string) => {
          const merged = carry + chunk;
          const boundary = lastSentenceEnd(merged);
          if (!boundary && merged.length < MAX_SENTENCE_HOLD) {
            carry = merged;
            return;
          }
          // A passage with no sentence end in it at all is released anyway
          // rather than held forever; only the punctuation rules apply to it.
          const cut = boundary || merged.length - danglingTail(merged);
          carry = merged.slice(cut);
          push(clean(merged.slice(0, cut)));
        };
        if (first) handle(first);
        for (;;) {
          if (leaked) break;
          const { value, done } = await iter.next();
          if (done) break;
          if (value) handle(value);
        }
        // The stream is over, so whatever is left is a complete thought.
        push(clean(carry));
        // A reply shorter than the hold is the common case, not an edge one.
        flushPending();
        if (!asProse && parser)
          for (const d of parser.end()) {
            emitted += d.text.length;
            emit({ type: "delta", ...d });
          }
        return full;
      }

      try {
        const prior = history
          .slice(0, -1)
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({
            role: m.role,
            content: m.role === "assistant" ? condenseRows(m.content) : m.content,
          }));

        const call = (userContent: string) =>
          provider.streamText(
            {
              system: SYSTEM_PROMPT,
              maxTokens: MAX_TOKENS,
              messages: [...prior, { role: "user" as const, content: userContent }],
            },
            request.signal,
          );

        // The command narrows what the turn emphasises. It never relaxes the
        // corpus rules and never changes which turn kind this is — just appended
        // after the turn instruction, whatever the turn turns out to be.
        const directive = command ? `\n\n${command.instruction}` : "";

        let full: string;
        let auditRecords: CorpusRecord[];
        // Which channel a fallback would have to go down, if the model returns
        // nothing usable. Set alongside every pump call.
        let proseTurn = false;

        if (!isResolve) {
          // ---- Corpus hit (or slug): deterministic restoration -------------
          // Retrieval was non-empty to get here: an empty slug lookup already
          // returned 404, and an empty search set `isResolve`. So this branch
          // always has records, and the no-record variants it used to carry
          // were unreachable.
          const records = retrieval.records;
          /**
           * A hit is not automatically a dish with a past.
           *
           * Seventeen records in the corpus are classed MODERN_DISH, and three
           * of them lead a card of their own — pav bhaji among them, whose own
           * verdict reads "Bombay, not antiquity". Emitting "record" for every
           * hit put those under the record headings, so the card printed "Then"
           * above a dish that has no then and listed its ingredients as though
           * they were the older version. The record was honest; the turn kind
           * was not. `modern` selects headings that claim only what is true —
           * "What's in it", "Where its parts came from".
           */
          const modernDish = records[0].provenance_class === "MODERN_DISH";
          const kind: TurnKind = modernDish ? "modern" : "record";
          emit({
            type: "meta",
            mode: "restoration" satisfies TurnMode,
            kind,
            top_score: retrieval.top_score,
            records,
          });
          track("dish_restored", {
            ...geo,
            device_id: device,
            query: label,
            slug: records[0].slug,
            provenance: records[0].provenance_class,
            score: retrieval.top_score,
          });

          // A record that carries its own tested `restore_today` has the card
          // draw the ingredients and steps from it, and the beat is the prose
          // above that list. A record without one leaves the beat as the only
          // recipe on the card, and the card parses it — so it has to arrive in
          // the shape the parser reads, or it renders as a paragraph nobody can
          // cook from.
          const ownRecipe = records.some((r) => r.restore_today);
          const shape = ownRecipe
            ? "\n§RESTORE_TODAY§ is two or three sentences of prose only. The card " +
              "already prints the tested ingredients and numbered method from the " +
              "record directly beneath your text, so a second list there is the same " +
              "recipe twice. Say why this version is worth cooking, not what is in it."
            : "\nFormat §RESTORE_TODAY§ as: one short opening line, then a line " +
              "reading INGREDIENTS with each ingredient on its own line as " +
              "'ingredient :: kirana quantity :: why this one', then a line reading " +
              "METHOD with the steps numbered 1., 2., 3., one per line. The card " +
              "renders those three fields as a table, the same one it draws from a " +
              "record. The third field is why that ingredient and not the modern " +
              "default, as a clause of eight to twenty words: what it does in the pot " +
              "and what the dish loses without it. A single word like 'flavour', " +
              "'heat' or 'texture' names a category and teaches nothing, so it is not " +
              "an answer here. Draw it from the record above and nothing else, and " +
              "leave it empty rather than inventing a reason or padding a real one " +
              "with history you were not given. Plain text only, no other markdown.";

          /**
           * The headings are only half of it. Relabelling §THEN§ stops the card
           * asserting a past, but the model is still writing that beat, and on
           * a MODERN_DISH record it has no older version to write about — so it
           * reaches for one. The same wording the corpus-miss branch already
           * uses for MODERN is applied here, against the record instead of the
           * swap table.
           */
          const noPast = modernDish
            ? "\nThis record is classed MODERN_DISH: the dish has NO older version. Emit " +
              "TWO markers only, §VERDICT§ and §RESTORE_TODAY§, and do not write §THEN§ " +
              "or §WHAT_CHANGED§ at all — the card does not draw them for this kind of " +
              "dish, so anything you put there is written for nobody. There is no past " +
              "to narrate here and the reader came for the cooking: §VERDICT§ is what is " +
              "specific to THIS dish in a line or two, and §RESTORE_TODAY§ is the whole " +
              "answer. Build it from the record's substitution story and the swap table, " +
              "putting back the component each swap names. Do not invent an ancient " +
              "text, a verse, a century for the dish, or an older form of it under " +
              "another name. Do not call the result healthy, healthier or good for " +
              "anyone: say what the swap puts back and what it does to the dish."
            : "";

          const iter = call(
            `${renderCorpusBlock(records)}\n\nThis is a RESTORATION turn. Emit the four ` +
              `§markers§.${noPast}${shape}${PLAIN_WORDS}${directive}${langRule}\n\nUser said: ${label}`,
          )[Symbol.asyncIterator]();
          auditRecords = records;
          proseTurn = false;
          full = await pump(iter, undefined, new BeatParser(), false, () => {
            // The record is withdrawn along with the badge and the source
            // strip: nothing on this card is evidence for what the model went
            // on to write, and the audit below must not treat it as such.
            auditRecords = [];
            console.warn(
              `[frame-refused] ${JSON.stringify({
                query: label,
                slug: records[0].slug,
                vendor: provider.vendor,
                model: provider.model,
              })}`,
            );
            track("turn_resolved", {
              ...geo,
              device_id: device,
              query: label,
              resolved: "indianise",
              top_score: 0,
            });
            emit({
              type: "meta",
              mode: "indianize" satisfies TurnMode,
              kind: "foreign" satisfies TurnKind,
              top_score: retrieval.top_score,
              records: [],
            });
            return new MarkerParser(INDIANIZE_BEATS);
          });
        } else {
          // ---- Corpus miss: the model decides the turn ----------------------
          const carried = (
            await Promise.all((body.activeRecordIds ?? []).map((id) => fileCorpus.byId(id)))
          ).filter((r): r is CorpusRecord => Boolean(r));

          const onScreen = carried.length
            ? `<on_screen>\n${carried.map(renderRecord).join("\n\n")}\n</on_screen>`
            : "<on_screen>none</on_screen>";

          // Semantic neighbours from the index. Offered, never assumed: they are
          // whatever the vector search found nearest, which for a modern or
          // foreign dish is a coincidence wearing a citation. Only a RESTORE
          // verdict below turns one into a record on screen.
          const candidates = retrieval.candidates ?? [];
          const candidateBlock = candidates.length
            ? `<semantic_candidates>\nThese records are the closest matches in the ` +
              `restored corpus by meaning. They are NOT confirmed to be this dish's ` +
              `ancestor — vector search always returns its nearest neighbour, even ` +
              `for a modern dish, a foreign dish, or a word that is not a dish at ` +
              `all. Use one ONLY if you declare MODE: RESTORE, and only if it is ` +
              `genuinely an older form of what the user named. If the dish is modern ` +
              `or foreign, ignore these entirely.\n` +
              `${candidates.map(renderRecord).join("\n\n")}\n</semantic_candidates>\n\n`
            : "";

          const resolvePrompt =
            `${onScreen}\n\n${renderComponentSwaps(await fileCorpus.swaps())}\n\n` +
            `${renderIndianizationBlock()}\n\n` +
            candidateBlock +
            "This message is not in the restored corpus. Put the mode on the FIRST " +
            "line, exactly one of: MODE: REPLY | MODE: INDIANISE | MODE: MODERN | " +
            "MODE: RESTORE, then the reply on the following lines.\n" +
            "- MODE: REPLY — the message is a follow-up you can answer from the dish " +
            "in <on_screen> or from the conversation so far (the turns above): an " +
            "alternative ingredient, a method question, a challenge, a request to go " +
            "deeper. Then plain prose, no markers. Answer with the change itself: the " +
            "ingredient, the quantity, the step, the heat or the order of work that " +
            "differs. Open on a verb the reader can act on, never on a modal, and put " +
            "no placeholder where an ingredient belongs — a sentence about what could " +
            "be done is not an answer. If you cannot name the concrete thing, say what " +
            "you would need to know. When the message names no new dish " +
            "of its own, prefer REPLY over inventing a dish to restore. A message " +
            "that DOES name a dish is not a REPLY, even when the only record for it " +
            "is in <semantic_candidates>.\n" +
            "  When the reader asks to SEE a comparison — a table, a side by side, " +
            "'what changed from then to now', 'show me the difference' — answer in " +
            "rows rather than paragraphs. Write a line reading 'Aspect :: Then :: Now' " +
            "and then one row per line in the same three-field shape, and the card " +
            "renders them as a table. Keep every cell to a few words. One row per " +
            "thing that actually changed, taken from the record on screen and the " +
            "swap table; do not pad the table to look complete, and do not add a row " +
            "for anything neither of them records. A sentence before the rows is " +
            "fine, and where the comparison does not fit rows, stay in prose.\n" +
            "- MODE: INDIANISE — the user named a dish that is NOT Indian in origin " +
            "(pizza, pasta, sushi, ice cream, ramen, a burger, and the like); then the " +
            "four §VERDICT§ §REBUILD§ §SWAPS§ §PLATE§ markers from the INDIANISATION " +
            "TURNS section, built from the <indianization_map>. Two or more foreign " +
            "dishes named together are one INDIANISE turn, not several: build the " +
            "single hybrid they describe, as ONE CARD IS ONE DISH sets out.\n" +
            "  At least one dish named must be foreign. The word 'fusion' does not " +
            "make a turn INDIANISE, and neither does 'mix', 'combo', 'hybrid' or " +
            "'mashup': what makes it INDIANISE is that something on the plate came " +
            "from outside India. A fusion of two INDIAN dishes (dosa and idli, " +
            "khichdi and pulao, dhokla and handvo) has no foreign part to swap out, " +
            "so the §SWAPS§ table would have nothing true to put in its first column " +
            "and the card would tell the reader an Indian dish is not Indian.\n" +
            "  Answer it anyway, as REPLY. This is not a refusal and must never read " +
            "as one: two Indian dishes put together is an ordinary thing to want for " +
            "dinner, and you know how both are made. Give them the dish in prose — " +
            "what the batter or dough does, the one step where the two methods meet, " +
            "and what to watch. Do not tell the reader which of our modes their " +
            "question did or did not qualify for, do not name a tool, and do not " +
            "explain that something is for foreign dishes. They asked about food. " +
            "Use RESTORE instead where one of the two clearly anchors the answer and " +
            "the older form of it is the real story.\n" +
            "- MODE: MODERN — the user named a MODERN Indian dish with no older version " +
            "behind it (biryani, butter chicken, pav bhaji, gobi manchurian, samosa, most " +
            "restaurant food, anything defined by potato, tomato, chilli or cauliflower). " +
            "Then the four §VERDICT§ §THEN§ §WHAT_CHANGED§ §RESTORE_TODAY§ markers: " +
            "§VERDICT§ opens on what is specific to THIS dish rather than on its age, " +
            "because the card states the age itself in a line beneath your text and a " +
            "verdict that repeats it wastes the one line the reader is certain to " +
            "read; §THEN§ names " +
            "which of its defining ingredients are Columbian-exchange arrivals and what " +
            "its components were before, drawn from where_it_went in <component_swaps> " +
            "and nothing else — do not narrate the dish's history from your own " +
            "knowledge; §WHAT_CHANGED§ the nutrition shift on an axis <component_swaps> " +
            "actually names; " +
            // Not "a healthier version": the model echoes the brief's own
            // wording back onto the card, and that word is a health claim.
            "§RESTORE_TODAY§ a version built from <component_swaps> and older " +
            "cooking principles. Do not invent an ancient text or verse.\n" +
            "- MODE: RESTORE — a dish you are confident is INDIAN in origin and not " +
            "obviously modern. Two cases fall under it:\n" +
            "  (a) <semantic_candidates> above contains a record that genuinely IS an " +
            "older form of the dish the user named — the same dish, or its direct " +
            "ancestor under another name. Declare RESTORE and write the four markers " +
            "about THAT record; it will be shown beside your prose. Judge this on the " +
            "dish, not on the fact that a candidate was offered: the search returns " +
            "its nearest neighbour whether or not one is right, so a chicken dish " +
            "surfacing for butter chicken means nothing.\n" +
            "  (b) no candidate fits, but the dish plausibly had an older form nobody " +
            "has documented here; then the same four markers, doing COMPONENT " +
            "RESTORATION from <component_swaps>.\n" +
            "  RESTORE asserts two things: that the dish is Indian, and that an older " +
            "form plausibly existed. Do not reach for it because nothing else fits. If " +
            "you cannot name the region or tradition the dish belongs to, you are not " +
            "confident it is Indian: use INDIANISE if it is foreign, and REPLY if you " +
            "genuinely do not know. An honest 'I do not know what this is' is a better " +
            "answer than a card about a dish nobody can place.\n" +
            "For MODERN and RESTORE, format the §RESTORE_TODAY§ section as: one short " +
            "opening line, then a line reading INGREDIENTS with each ingredient on its " +
            "own line as 'ingredient :: kirana quantity :: why this one', then a line " +
            "reading METHOD with the steps numbered 1., 2., 3. The card renders those " +
            "three fields as a table. The third is why that ingredient and not the " +
            "modern default: the component it puts back, what it does to the dish, or " +
            "an axis <component_swaps> actually names. Write it as a clause of eight " +
            "to twenty words, never a one-word label: 'flavour', 'heat', 'seasoning' " +
            "and 'texture' are categories, and a column of them is a form nobody " +
            "learns anything from. A preposition does not rescue one — 'for heat', " +
            "'for its flavour', 'for its aroma' are the same empty cell with a word " +
            "in front. Say which flavour, what it does to the other ingredients, or " +
            "what it stands in for. Take the substance from that block and leave the " +
            "cell empty where it records no reason. Most ingredients are not in that " +
            "block at all, because nothing displaced them: for those, say what the " +
            "ingredient does in the cooking (binds, sours, tempers, browns first, " +
            "carries the fat), which describes the dish in front of you and needs no " +
            "source. Never turn that into the ingredient's history or its century. " +
            "Length must come from saying the recorded thing properly, " +
            "never from a century, a region or an origin story you were not given. " +
            "The room is also where a health claim gets reached for: this column " +
            "describes the dish, never the reader's body — no digestion, gut, " +
            "immunity, detox or energy, and no 'aids', 'helps' or 'good for'. Name " +
            "the axis and compare instead. Plain text only, no other markdown." +
            PLAIN_WORDS +
            directive +
            langRule +
            `\n\nUser said: ${label}`;

          const iter = call(resolvePrompt)[Symbol.asyncIterator]();

          // Read the first line — the mode declaration — before rendering.
          let buf = "";
          for (;;) {
            const { value, done } = await iter.next();
            if (done) break;
            buf += value;
            if (buf.includes("\n") || buf.length > 60) break;
          }
          const resolved = parseResolved(buf);
          const m = /MODE:\s*(INDIANISE|MODERN|RESTORE|REPLY)/i.exec(buf);
          const remainder = m
            ? buf.slice(m.index + m[0].length).replace(/^[^\n]*\n?/, "")
            : buf;

          const base = RESOLUTION[resolved];
          const { mode } = base;
          // A RESTORE verdict is the model saying "this dish is Indian and did
          // have an older form". Only then does a candidate become the record
          // the card renders from — and the card is a real restoration, not the
          // corpus-gap framing, because we have the record after all.
          const promoted = resolved === "restore" ? candidates : [];
          const outRecords = resolved === "reply" ? carried : promoted;
          // MODERN and RESTORE both render a recordless restoration card. The
          // reader tells them apart by the reason the card states, which is now
          // `kind` rather than a pair of booleans the card had to decode.
          const restorationLike = resolved === "modern" || resolved === "restore";

          // `gap` says "we hold no record for this". With a promoted candidate
          // that is no longer true, so the card must not say it.
          const kind = promoted.length ? ("record" satisfies TurnKind) : base.kind;

          emit({
            type: "meta",
            mode,
            kind,
            top_score: retrieval.top_score,
            records: outRecords,
          });
          // A genuine Indian-dish gap goes to the corpus-roadmap log; foreign
          // dishes, modern dishes and follow-ups are not gaps to fill.
          track(resolved === "restore" ? "no_original_found" : "turn_resolved", {
            ...geo,
            device_id: device,
            query: label,
            resolved,
            top_score: retrieval.top_score,
          });

          const parser: StreamingParser | null =
            resolved === "indianise"
              ? new MarkerParser(INDIANIZE_BEATS)
              : restorationLike
                ? new BeatParser()
                : null;
          auditRecords = outRecords;
          proseTurn = resolved === "reply";
          full = await pump(iter, remainder, parser, proseTurn);
        }

        // The completion started reproducing the prompt. Whatever it was going
        // to say next is not worth the rest of the rule list, so the turn ends
        // here and the reader gets a refusal instead of a document.
        if (leaked) {
          console.warn(
            `[prompt-leak] ${JSON.stringify({
              query: label,
              vendor: provider.vendor,
              model: provider.model,
              fingerprint: leaked,
              emitted,
            })}`,
          );
          // Caught after the hold released, so some of the dump is already on
          // screen. Tell the client to throw away what it has rendered for this
          // turn before the refusal replaces it.
          if (emitted) emit({ type: "redact" });
          emit(
            proseTurn
              ? { type: "text", text: LEAK_REFUSAL }
              : { type: "delta", beat: "VERDICT", text: LEAK_REFUSAL },
          );
          emit({ type: "done" });
          controller.close();
          return;
        }

        // Nothing reached the reader. Either the model wrote prose and never a
        // §marker§, so the parser dropped all of it, or it wrote nothing at all
        // — retrieval declining is correct and common, `rice` is ambiguous
        // rather than a dish. Both want the same treatment, and it is not the
        // verdict beat.
        //
        // This used to put the recovered text into §VERDICT§, which is a display
        // headline (clamp to 1.75rem, weight 700) sized for one line under
        // twelve words. A paragraph landed there as a banner, under a card whose
        // "not in the restored corpus yet" note described a dish the reader had
        // never named. Since `emitted` is zero, nothing has painted yet, so the
        // turn can still be moved: re-declare it as conversation and let the
        // words render as what they actually are.
        if (!emitted) {
          const text =
            full.trim() ||
            "I could not match that to a dish. Name one dish on its own, " +
              "the way you would say it at home, and I will show you what it was.";
          if (!proseTurn) {
            emit({
              type: "meta",
              mode: "conversation" satisfies TurnMode,
              kind: null,
              top_score: retrieval.top_score,
              // The dish on screen is unchanged by a turn that rendered nothing,
              // so the carried records stay carried.
              records: auditRecords,
            });
          }
          emit({ type: "text", text });
        }

        // Tripwire, not a gate. The badge and source strip already come from the
        // record, so this only surfaces a prompt regression in the logs.
        const audit = auditProse(full, auditRecords);
        if (!isClean(audit)) {
          console.warn(
            `[provenance-leak] ${JSON.stringify({
              query: label,
              vendor: provider.vendor,
              model: provider.model,
              ...audit,
            })}`,
          );
        }

        emit({ type: "done" });
        controller.close();
      } catch (err) {
        // The reader pressing stop, or navigating away, aborts the upstream
        // request. That is the feature working, not a fault.
        const aborted =
          request.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError"));

        if (aborted) {
          controller.close();
          return;
        }

        const quota = asQuotaError(err);

        if (quota) {
          console.warn(`[quota] ${provider.vendor}/${provider.model} exhausted`);
          emit({
            type: "error",
            message:
              `The ${provider.vendor} quota for ${provider.model} is used up` +
              (quota.retryAfterSeconds ? `, and resets in about ${quota.retryAfterSeconds}s` : "") +
              ". Everything below is rendered from the corpus and is unaffected.",
          });
        } else if (err instanceof RefusalError) {
          emit({
            type: "error",
            message: "This request was declined. Try naming a dish instead.",
          });
        } else {
          console.error(`[chat] ${provider.vendor} error`, err);
          emit({
            type: "error",
            message: "The reply could not be written just now. Try again.",
          });
        }
        emit({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
