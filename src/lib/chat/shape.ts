import type { ChatMessage, Conversation } from "./store";

/**
 * The shape of a thread the mirror will accept, in either direction.
 *
 * The device is the source of truth and the server is a copy of it, which is
 * why the route used to cast whatever arrived to `Conversation` and store it.
 * Two things were wrong with that. A body is an array of anything: a request
 * with no messages field threw inside the insert loop, and a request with a
 * few megabytes in one string was stored as-is under any id the caller chose.
 * And on the way back, `hydrateFromServer` put the rows straight into state,
 * so a row nobody's browser ever wrote would render like one it did.
 *
 * Pure and directive-free so the route, the client store and the offline
 * check all run the same function.
 */

/** `MAX_STORED` on the client. The server never holds more than the device does. */
export const MAX_CONVERSATIONS = 30;
/**
 * A thread with two records and their localized cards on every turn is well
 * under this.
 * ponytail: estimated, not measured; measure a heavy thread and tighten if
 * storage gets tight.
 */
export const MAX_CONVERSATION_CHARS = 400_000;
const MAX_ID_CHARS = 64;
const MAX_TITLE_CHARS = 200;
/** The only photo URL the card is ever built with (`community/card.ts`). */
const PHOTO_URL = /^\/api\/community\/photo\/[0-9a-f]{24}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pruneMessage(value: unknown): ChatMessage | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== "string" || typeof value.text !== "string") return null;
  if (value.role !== "user" && value.role !== "assistant") return null;
  const message = value as unknown as ChatMessage;
  // An external photo URL in a stored community card would make the reader's
  // browser fetch it. The card only ever points at the photo route.
  if (
    isObject(value.community) &&
    typeof value.community.photo_url === "string" &&
    !PHOTO_URL.test(value.community.photo_url)
  ) {
    return { ...message, community: { ...message.community!, photo_url: null } };
  }
  return message;
}

/** Threads that are shaped like ours, capped in count and size. Anything else is dropped. */
export function pruneConversations(input: unknown): Conversation[] {
  if (!Array.isArray(input)) return [];
  const out: Conversation[] = [];
  for (const value of input) {
    if (out.length >= MAX_CONVERSATIONS) break;
    if (!isObject(value)) continue;
    if (typeof value.id !== "string" || !value.id || value.id.length > MAX_ID_CHARS) continue;
    if (typeof value.title !== "string" || value.title.length > MAX_TITLE_CHARS) continue;
    if (!Number.isFinite(value.updatedAt) || !Number.isFinite(value.createdAt)) continue;
    if (!Array.isArray(value.messages)) continue;

    const conversation = {
      ...value,
      messages: value.messages.map(pruneMessage).filter((m): m is ChatMessage => m !== null),
      activeRecordIds: Array.isArray(value.activeRecordIds)
        ? value.activeRecordIds.filter((id): id is string => typeof id === "string")
        : [],
    } as unknown as Conversation;
    if (JSON.stringify(conversation).length > MAX_CONVERSATION_CHARS) continue;
    out.push(conversation);
  }
  return out;
}
