import type { Conversation } from "@/lib/chat/store";
import { isDeviceId, listConversations, syncConversations } from "@/lib/db/conversations";

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

/** A thread carries whole corpus records, so the ceiling has to be generous. */
const MAX_BODY_BYTES = 4_000_000;

function deviceIdFrom(request: Request): string | null {
  const id = request.headers.get("x-device-id");
  return isDeviceId(id) ? id : null;
}

export async function GET(request: Request) {
  const deviceId = deviceIdFrom(request);
  if (!deviceId) return Response.json({ error: "missing or malformed device id" }, { status: 400 });

  try {
    return Response.json({ conversations: await listConversations(deviceId) });
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

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }

  let conversations: Conversation[];
  try {
    const body = JSON.parse(raw) as { conversations?: unknown };
    if (!Array.isArray(body.conversations)) throw new Error("conversations must be an array");
    conversations = body.conversations as Conversation[];
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
