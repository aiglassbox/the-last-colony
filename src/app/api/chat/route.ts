import type { NextRequest } from "next/server";

import { track } from "@/lib/analytics";
import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";
import { renderIndianizationBlock } from "@/lib/indianization";
import { BeatParser, INDIANIZE_BEATS, MarkerParser, type StreamingParser } from "@/lib/model/beats";
import { renderComponentSwaps, renderCorpusBlock, renderRecord } from "@/lib/model/corpus-block";
import { auditProse, isClean } from "@/lib/model/guards";
import { activeProvider, asQuotaError, MAX_TOKENS, RefusalError } from "@/lib/model/provider";
import { SYSTEM_PROMPT } from "@/lib/model/system-prompt";
import { retrieveBySlug, retrieveForDish } from "@/lib/retrieval/retrieve";

/**
 * The conversation endpoint.
 *
 * Retrieval still owns the deterministic half: when BM25 finds a corpus dish,
 * the turn is a RESTORATION, full stop — precise, gated, no model in the loop.
 *
 * The open-ended half is the one retrieval cannot answer with a name list:
 * when nothing matches, is this a follow-up about the dish on screen, a foreign
 * dish to Indianise, or an Indian dish simply not in the corpus yet? That is a
 * world-knowledge question, so on a corpus MISS the model decides — it declares
 * the mode on its first line and we route the rest of the stream accordingly.
 * The corpus-hit path never consults the model, so its precision is untouched.
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

type Mode = "restoration" | "conversation" | "indianize";
type Resolved = "indianise" | "modern" | "restore" | "reply";

function encodeEvent(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
}

/** The mode the model declared on its first line; defaults safe if it didn't. */
function parseResolved(head: string): Resolved {
  const m = /MODE:\s*(INDIANISE|MODERN|RESTORE|REPLY)/i.exec(head);
  const word = m?.[1].toUpperCase();
  if (word === "INDIANISE") return "indianise";
  if (word === "MODERN") return "modern";
  if (word === "REPLY") return "reply";
  return "restore";
}

/** Prior turns, replayed as plain text. Long threads are trimmed from the front. */
const MAX_HISTORY_TURNS = 20;

export async function POST(request: NextRequest) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim();
  const history = (body.messages ?? []).filter((m) => m.content?.trim());
  const latest = [...history].reverse().find((m) => m.role === "user");
  const query = (latest?.content ?? "").trim();

  if (!query && !slug) {
    return Response.json({ error: "a user message or slug is required" }, { status: 400 });
  }

  const retrieval = slug ? await retrieveBySlug(slug) : await retrieveForDish(query);
  const isResolve = retrieval.empty && !slug;
  const label = slug || query;
  const provider = activeProvider();

  track("dish_queried", {
    query: label,
    via: slug ? "slug" : "search",
    hit: !retrieval.empty,
    provider: provider?.vendor ?? "none",
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (obj: unknown) => controller.enqueue(encodeEvent(obj));

      // The record half of a card owes nothing to the model, so a missing key
      // costs the prose and not the card.
      if (!provider) {
        // Without a model a corpus miss cannot be resolved, so it shows as an
        // empty restoration rather than guessing a turn type.
        emit({
          type: "meta",
          mode: "restoration",
          empty: retrieval.empty,
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

      /** Drains a model stream into card beats or prose; returns the full text. */
      async function pump(
        iter: AsyncIterator<string>,
        first: string | undefined,
        parser: StreamingParser | null,
        asProse: boolean,
      ): Promise<string> {
        let full = "";
        const handle = (text: string) => {
          full += text;
          if (asProse) emit({ type: "text", text });
          else if (parser) for (const d of parser.push(text)) emit({ type: "delta", ...d });
        };
        if (first) handle(first);
        for (;;) {
          const { value, done } = await iter.next();
          if (done) break;
          if (value) handle(value);
        }
        if (!asProse && parser) for (const d of parser.end()) emit({ type: "delta", ...d });
        return full;
      }

      try {
        const prior = history
          .slice(0, -1)
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({ role: m.role, content: m.content }));

        const call = (userContent: string) =>
          provider.streamText(
            {
              system: SYSTEM_PROMPT,
              maxTokens: MAX_TOKENS,
              messages: [...prior, { role: "user" as const, content: userContent }],
            },
            request.signal,
          );

        let full: string;
        let auditRecords: CorpusRecord[];

        if (!isResolve) {
          // ---- Corpus hit (or slug): deterministic restoration -------------
          const records = retrieval.records;
          emit({
            type: "meta",
            mode: "restoration" satisfies Mode,
            empty: !records.length,
            top_score: retrieval.top_score,
            records,
          });
          if (records.length) {
            track("dish_restored", {
              query: label,
              slug: records[0].slug,
              provenance: records[0].provenance_class,
              score: retrieval.top_score,
            });
          }

          const swapBlock = records.length
            ? ""
            : `\n\n${renderComponentSwaps(await fileCorpus.swaps())}`;
          const instruction = records.length
            ? "This is a RESTORATION turn. Emit the four §markers§."
            : "This is a RESTORATION turn with no record. Emit the four §markers§, " +
              "say plainly that the dish is not in the restored corpus, and spend the " +
              "card on COMPONENT RESTORATION using the swaps above.";

          const iter = call(
            `${renderCorpusBlock(records)}${swapBlock}\n\n${instruction}\n\nUser said: ${label}`,
          )[Symbol.asyncIterator]();
          auditRecords = records;
          full = await pump(iter, undefined, new BeatParser(), false);
        } else {
          // ---- Corpus miss: the model decides the turn ----------------------
          const carried = (
            await Promise.all((body.activeRecordIds ?? []).map((id) => fileCorpus.byId(id)))
          ).filter((r): r is CorpusRecord => Boolean(r));

          const onScreen = carried.length
            ? `<on_screen>\n${carried.map(renderRecord).join("\n\n")}\n</on_screen>`
            : "<on_screen>none</on_screen>";

          const resolvePrompt =
            `${onScreen}\n\n${renderComponentSwaps(await fileCorpus.swaps())}\n\n` +
            `${renderIndianizationBlock()}\n\n` +
            "This message is not in the restored corpus. Put the mode on the FIRST " +
            "line, exactly one of: MODE: REPLY | MODE: INDIANISE | MODE: MODERN | " +
            "MODE: RESTORE, then the reply on the following lines.\n" +
            "- MODE: REPLY — a follow-up about the dish in <on_screen>; then plain " +
            "prose, no markers. Never choose REPLY when <on_screen> is none.\n" +
            "- MODE: INDIANISE — the user named a dish that is NOT Indian in origin " +
            "(pizza, pasta, sushi, ice cream, ramen, a burger, and the like); then the " +
            "four §VERDICT§ §REBUILD§ §SWAPS§ §PLATE§ markers from the INDIANISATION " +
            "TURNS section, built from the <indianization_map>.\n" +
            "- MODE: MODERN — the user named a MODERN Indian dish that has no ancient " +
            "original (biryani, butter chicken, pav bhaji, gobi manchurian, samosa, most " +
            "restaurant food, anything defined by potato, tomato, chilli or cauliflower). " +
            "Then the four §VERDICT§ §THEN§ §WHAT_CHANGED§ §RESTORE_TODAY§ markers: " +
            "§VERDICT§ states plainly it is a modern dish, not ancient; §THEN§ gives its " +
            "short honest history and names which defining ingredients are Columbian-" +
            "exchange arrivals; §WHAT_CHANGED§ the nutrition shift on a named axis; " +
            "§RESTORE_TODAY§ a healthier version built from <component_swaps> and older " +
            "cooking principles. Do not invent an ancient text or verse.\n" +
            "- MODE: RESTORE — an Indian dish that likely had an older form we simply " +
            "have not documented yet (not obviously modern); then the same four markers, " +
            "framed as a corpus gap, doing COMPONENT RESTORATION from <component_swaps>.\n" +
            "For MODERN and RESTORE, format the §RESTORE_TODAY§ section as: one short " +
            "opening line, then a line reading INGREDIENTS with each ingredient on its " +
            "own line beginning with '- ' and a kirana quantity, then a line reading " +
            "METHOD with the steps numbered 1., 2., 3. Plain text only, no other " +
            "markdown.\n\n" +
            `User said: ${label}`;

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
          const m = /MODE:\s*(INDIANISE|RESTORE|REPLY)/i.exec(buf);
          const remainder = m
            ? buf.slice(m.index + m[0].length).replace(/^[^\n]*\n?/, "")
            : buf;

          const mode: Mode =
            resolved === "indianise"
              ? "indianize"
              : resolved === "reply"
                ? "conversation"
                : "restoration";
          const outRecords = resolved === "reply" ? carried : [];
          // MODERN and RESTORE both render as an empty restoration card; the only
          // difference the reader sees is the framing — a modern dish is stated
          // as modern, a gap is stated as not-yet-documented.
          const restorationLike = resolved === "modern" || resolved === "restore";

          emit({
            type: "meta",
            mode,
            empty: restorationLike,
            modern: resolved === "modern",
            top_score: retrieval.top_score,
            records: outRecords,
          });
          // A genuine Indian-dish gap goes to the corpus-roadmap log; foreign
          // dishes, modern dishes and follow-ups are not gaps to fill.
          track(resolved === "restore" ? "no_original_found" : "turn_resolved", {
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
          full = await pump(iter, remainder, parser, resolved === "reply");
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
