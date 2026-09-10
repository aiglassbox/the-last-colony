import type { Conversation } from "@/lib/chat/store";
import { MAX_CONVERSATION_CHARS, MAX_CONVERSATIONS, pruneConversations } from "@/lib/chat/shape";
import { fileCorpus } from "@/lib/corpus/load";
import type { CorpusRecord } from "@/lib/corpus/types";
import { isDeviceId, listConversations, syncConversations } from "@/lib/db/conversations";
import { loadLocalized } from "@/lib/lang/localized-store";
import { isSupported } from "@/lib/lang/types";
import { checkRate, clientKey } from "@/lib/rate-limit";

/**
 * The conversation mirror.
 *
 * GET  — this device's threads, for a browser that has lost its localStorage.
 * POST — the whole set this device holds, which is also how deletes land.
 *
 * There are no accounts here, so a thread belongs to a device id the client
 * generates and keeps. That is the honest limit of it: the id is not proof of
 * anything, and anyone holding one can read the threads filed under it. It is
 * enough to keep one visitor's history apart from another's and is not a
 * security boundary, so nothing that needs one should be filed here.
 */
export const dynamic = "force-dynamic";

/** The device's whole set at the per-thread ceiling. `pruneConversations` holds the rest. */
const MAX_BODY_BYTES = MAX_CONVERSATIONS * MAX_CONVERSATION_CHARS;
/** Pushes coalesce on a 1.2 s timer, so an active reader sends a few per turn. */
const MAX_SYNCS = 60;

function deviceIdFrom(request: Request): string | null {
  const id = request.headers.get("x-device-id");
  return isDeviceId(id) ? id : null;
}

/**
 * A row is what a device once posted, so its records and localized cards are
 * that device's claim, not the corpus's. Rebuilt from the corpus by slug before
 * the client hydrates from them: a stored record that says `editor_verified`
 * and carries a locus renders exactly what the corpus holds for that slug, or
 * nothing.
 */
async function canonical(conversations: Conversation[]): Promise<Conversation[]> {
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (!message.records?.length) continue;
      const records = (
        await Promise.all(
          message.records.map((r) => (typeof r?.slug === "string" ? fileCorpus.bySlug(r.slug) : null)),
        )
      ).filter((r): r is CorpusRecord => r !== null);
      message.records = records;

      const lang = message.lang;
      if (message.localized && typeof lang === "string" && isSupported(lang)) {
        message.localized = Object.fromEntries(
          records.flatMap((r) => {
            const card = loadLocalized(r, lang);
            return card ? [[r.slug, card] as const] : [];
          }),
        );
      } else {
        delete message.localized;
      }
    }
  }
  return conversations;
}

export async function GET(request: Request) {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) return Response.json({ error: "missing or malformed device id" }, { status: 400 });

  const rate = checkRate(`mirror:${clientKey(request)}`, Date.now(), MAX_SYNCS);
  if (!rate.ok) return Response.json({ conversations: [], error: "slow down" }, { status: 429 });

  try {
    const stored = pruneConversations(await listConversations(deviceId));
    return Response.json({ conversations: await canonical(stored) });
  } catch (error) {
    console.error("[conversations] read failed", error);
    // The device still has its own copy, so this is a degraded mirror and not
    // a broken page. Say so with a body the client can read rather than a 500
    // it has to guess at.
    return Response.json({ conversations: [], error: "unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) return Response.json({ error: "missing or malformed device id" }, { status: 400 });

  const rate = checkRate(`mirror:${clientKey(request)}`, Date.now(), MAX_SYNCS);
  if (!rate.ok) return Response.json({ error: "slow down" }, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let conversations: Conversation[];
  try {
    const body = JSON.parse(raw) as { conversations?: unknown };
    if (!Array.isArray(body.conversations)) throw new Error("conversations must be an array");
    conversations = pruneConversations(body.conversations);
  } catch {
    return Response.json({ error: "malformed body" }, { status: 400 });
  }

  try {
    const result = await syncConversations(deviceId, conversations);
    return Response.json(result);
  } catch (error) {
    console.error("[conversations] sync failed", error);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
