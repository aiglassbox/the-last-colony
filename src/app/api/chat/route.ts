import type { NextRequest } from "next/server";

import { track } from "@/lib/analytics";
import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";
import { BeatParser } from "@/lib/model/beats";
import { renderComponentSwaps, renderCorpusBlock } from "@/lib/model/corpus-block";
import { auditProse, isClean } from "@/lib/model/guards";
import { activeProvider, asQuotaError, MAX_TOKENS, RefusalError } from "@/lib/model/provider";
import { SYSTEM_PROMPT } from "@/lib/model/system-prompt";
import { retrieveBySlug, retrieveForDish } from "@/lib/retrieval/retrieve";

/**
 * The conversation endpoint.
 *
 * A turn is one of two kinds, and the server decides which:
 *
 *   RESTORATION — the latest message names a dish retrieval can find. Renders
 *                 as a card; the model fills four marked beats.
 *   CONVERSATION — everything else, with the records from the dish already on
 *                 screen carried forward. Plain prose.
 *
 * Choosing server-side rather than asking the model to classify keeps the
 * decision in the same place as the threshold and ambiguity gates. "What about
 * the oil?" and "actually, dosa" are different turns because retrieval says so,
 * not because a classifier guessed.
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

type Mode = "restoration" | "conversation";

function encodeEvent(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj) + "\n");
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

  // Carry the current dish forward when the new message names no dish of its
  // own. That is what makes "how long do I ferment it?" answerable.
  let mode: Mode = "restoration";
  let records: CorpusRecord[] = retrieval.records;

  if (retrieval.empty && !slug) {
    const carried = (
      await Promise.all((body.activeRecordIds ?? []).map((id) => fileCorpus.byId(id)))
    ).filter((r): r is CorpusRecord => Boolean(r));

    if (carried.length) {
      mode = "conversation";
      records = carried;
    }
  }

  const label = slug || query;
  const provider = activeProvider();

  track("dish_queried", {
    query: label,
    mode,
    via: slug ? "slug" : "search",
    provider: provider?.vendor ?? "none",
  });
  if (mode === "restoration") {
    if (retrieval.empty) {
      track("no_original_found", { query: label, top_score: retrieval.top_score });
    } else {
      track("dish_restored", {
        query: label,
        slug: retrieval.records[0].slug,
        provenance: retrieval.records[0].provenance_class,
        score: retrieval.top_score,
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeEvent({
          type: "meta",
          mode,
          empty: mode === "restoration" && retrieval.empty,
          top_score: retrieval.top_score,
          // A conversation turn re-sends the same records rather than none, so
          // a reloaded thread can still resolve which dish it was about.
          records,
        }),
      );

      // The record half of a card owes nothing to the model, so a missing key
      // costs the prose and not the card.
      if (!provider) {
        controller.enqueue(
          encodeEvent({
            type: "error",
            message:
              "No model key is set (GEMINI_API_KEY or ANTHROPIC_API_KEY), so there " +
              "is no written reply. Anything rendered from the corpus is unaffected.",
          }),
        );
        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
        return;
      }

      const parser = new BeatParser();

      try {
        const prior = history
          .slice(0, -1)
          .slice(-MAX_HISTORY_TURNS)
          .map((m) => ({ role: m.role, content: m.content }));

        // No record for this dish — hand over the swap table so component
        // restoration is built on real ratios rather than invented ones.
        const swapBlock = records.length ? "" : `\n\n${renderComponentSwaps(await fileCorpus.swaps())}`;

        const instruction =
          mode === "restoration"
            ? records.length
              ? "This is a RESTORATION turn. Emit the four §markers§."
              : "This is a RESTORATION turn with no record. Emit the four §markers§, " +
                "say plainly that the dish is not in the restored corpus, and spend " +
                "the card on COMPONENT RESTORATION using the swaps above."
            : "This is a CONVERSATION turn. Plain prose, no markers. The records " +
              "above are the dish already on screen; answer the question asked.";

        const textStream = provider.streamText(
          {
            system: SYSTEM_PROMPT,
            maxTokens: MAX_TOKENS,
            messages: [
              ...prior,
              {
                role: "user" as const,
                content: `${renderCorpusBlock(records)}${swapBlock}\n\n${instruction}\n\nUser said: ${label}`,
              },
            ],
          },
          request.signal,
        );

        let full = "";

        for await (const text of textStream) {
          full += text;
          if (mode === "conversation") {
            controller.enqueue(encodeEvent({ type: "text", text }));
          } else {
            for (const d of parser.push(text)) {
              controller.enqueue(encodeEvent({ type: "delta", ...d }));
            }
          }
        }

        if (mode === "restoration") {
          for (const d of parser.end()) {
            controller.enqueue(encodeEvent({ type: "delta", ...d }));
          }
        }

        // Tripwire, not a gate. The badge and source strip already come from
        // the record, so the reader is protected either way — this makes a
        // prompt regression visible in the logs rather than in a screenshot.
        const audit = auditProse(full, records);
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

        controller.enqueue(encodeEvent({ type: "done" }));
        controller.close();
      } catch (err) {
        // The reader pressing stop, or navigating away, aborts the upstream
        // request. That is the feature working, not a fault — logging it as an
        // error would fill production monitoring with expected noise, and
        // there is nobody left to receive an error event.
        const aborted =
          request.signal.aborted ||
          (err instanceof Error && (err.name === "AbortError" || err.name === "APIUserAbortError"));

        if (aborted) {
          controller.close();
          return;
        }

        const quota = asQuotaError(err);

        if (quota) {
          // Retrying does not fix a spent quota, so do not suggest it.
          console.warn(`[quota] ${provider.vendor}/${provider.model} exhausted`);
          controller.enqueue(
            encodeEvent({
              type: "error",
              message:
                `The ${provider.vendor} quota for ${provider.model} is used up` +
                (quota.retryAfterSeconds ? `, and resets in about ${quota.retryAfterSeconds}s` : "") +
                ". Everything below is rendered from the corpus and is unaffected.",
            }),
          );
        } else if (err instanceof RefusalError) {
          controller.enqueue(
            encodeEvent({
              type: "error",
              message: "This request was declined. Try naming a dish instead.",
            }),
          );
        } else {
          console.error(`[chat] ${provider.vendor} error`, err);
          controller.enqueue(
            encodeEvent({
              type: "error",
              message: "The reply could not be written just now. Try again.",
            }),
          );
        }
        controller.enqueue(encodeEvent({ type: "done" }));
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
