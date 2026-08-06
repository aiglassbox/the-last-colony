import type { NextRequest } from "next/server";

import { track } from "@/lib/analytics";
import { fileCorpus } from "@/lib/corpus/load";
import type { SwapRecord } from "@/lib/corpus/types";
import { renderSwapBlock } from "@/lib/model/corpus-block";
import { activeProvider } from "@/lib/model/provider";
import { sanitiseCompletion } from "@/lib/model/sanitise";
import { SWAP_SYSTEM_PROMPT } from "@/lib/model/system-prompt";
import { checkRate, clientKey } from "@/lib/rate-limit";

/**
 * The ingredient swap endpoint. Handles both the single-item swap and the
 * "read my pantry" list — a pantry is just several lookups, and the swap
 * records themselves are what the panel renders, so the model is only ever
 * writing the connective prose.
 */

export const dynamic = "force-dynamic";

/** The pantry sheet's own maximum. Anything past it is not a pantry. */
const MAX_ITEMS = 15;
/** A pantry item is a few words. Longer is a paste, and costs model tokens. */
const MAX_ITEM_CHARS = 80;

interface SwapRequest {
  /** One modern pantry item, or 5–15 of them for the pantry sheet. */
  items?: string[];
  item?: string;
}

export interface SwapResponse {
  results: Array<{ query: string; record: SwapRecord | null }>;
  note: string | null;
}

export async function POST(request: NextRequest) {
  const rate = checkRate(clientKey(request));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests. Wait a moment and try again." },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  let body: SwapRequest;
  try {
    body = (await request.json()) as SwapRequest;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // `body` is a cast over parsed JSON, not a guarantee about it. The declared
  // string[] was taken at its word and `.trim()` called on whatever arrived, so
  // {"items":[1]}, {"items":[null]}, {"items":{}} and {"items":"besan"} each
  // returned a 500 from an unhandled TypeError. Anything that is not a string
  // is dropped rather than rejected: a request carrying one bad entry among
  // good ones is still answerable, and this endpoint is a convenience.
  const raw = Array.isArray(body.items)
    ? body.items
    : typeof body.item === "string"
      ? [body.item]
      : [];
  const items = raw
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, MAX_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);

  if (!items.length) {
    return Response.json({ error: "items is required" }, { status: 400 });
  }

  const results = await Promise.all(
    items.map(async (query) => ({ query, record: await fileCorpus.findSwap(query) })),
  );

  for (const r of results) {
    track("swap_requested", { item: r.query, matched: Boolean(r.record) });
    if (!r.record) track("no_original_found", { query: r.query, kind: "swap" });
  }

  // The panel renders the ratios and rationale straight from the records. The
  // model is only asked for a short framing line, and only when a key exists.
  let note: string | null = null;
  const provider = activeProvider();
  if (provider) {
    try {
      const raw = await provider.completeText({
        system: SWAP_SYSTEM_PROMPT,
        maxTokens: 700,
        messages: [
          {
            role: "user",
            content:
              results.map((r) => renderSwapBlock(r.query, r.record)).join("\n\n") +
              "\n\nWrite one short paragraph tying these swaps together for this " +
              "cook. No headings, no lists, no restating the ratios.",
          },
        ],
      });
      // Swap records are not corpus records, so the audit runs with no records
      // behind it — which is the stricter reading, and the right one: a
      // sourceless attribution in this note has nothing on screen to check it.
      note = sanitiseCompletion(raw, [], {
        where: "swap",
        vendor: provider.vendor,
        model: provider.model,
        query: items.join(", "),
      });
    } catch (err) {
      console.error(`[swap] ${provider.vendor} error`, err);
      // The swap sheet is useful without the prose. Degrade, do not fail.
    }
  }

  return Response.json({ results, note } satisfies SwapResponse);
}

export async function GET() {
  // Powers the panel's browse state — every pantry item we can speak to.
  const swaps = await fileCorpus.swaps();
  return Response.json({ items: swaps.map((s) => s.modern_item) });
}
