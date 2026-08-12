import type { Conversation } from "@/lib/chat/store";

import { db } from "./client";

/**
 * The conversation mirror.
 *
 * The client owns its threads and sends the whole set it holds. That is what
 * makes this idempotent and what makes deletes work without a second endpoint:
 * anything this device had that is not in the set it just sent has been
 * deleted, so the row goes with it. A per-thread PUT plus a DELETE would need
 * the two to arrive in order, and they would not.
 */

/** Matches what the client generates. Anything else is not ours to write. */
const DEVICE_ID = /^[0-9a-f-]{16,64}$/i;

export function isDeviceId(value: string | null | undefined): value is string {
  return typeof value === "string" && DEVICE_ID.test(value);
}

export async function listConversations(deviceId: string): Promise<Conversation[]> {
  const sql = db();
  if (!sql) return [];

  const rows = await sql`
    select data
      from conversations
     where device_id = ${deviceId}
     order by updated_at desc
  `;

  return rows.map((row) => row.data as Conversation);
}

/**
 * Replace this device's threads with the set given.
 *
 * An empty thread is not worth a row: a new conversation is created the moment
 * the app opens, and storing it would give every visitor a blank record.
 */
export async function syncConversations(
  deviceId: string,
  conversations: Conversation[],
): Promise<{ stored: number; removed: number }> {
  const sql = db();
  if (!sql) return { stored: 0, removed: 0 };

  const worth = conversations.filter((c) => c.messages.length > 0);

  for (const conversation of worth) {
    await sql`
      insert into conversations (id, device_id, title, message_count, data, updated_at)
      values (
        ${conversation.id},
        ${deviceId},
        ${conversation.title},
        ${conversation.messages.length},
        ${JSON.stringify(conversation)}::jsonb,
        to_timestamp(${conversation.updatedAt} / 1000.0)
      )
      on conflict (id) do update set
        title         = excluded.title,
        message_count = excluded.message_count,
        data          = excluded.data,
        updated_at    = excluded.updated_at
      where conversations.device_id = ${deviceId}
    `;
  }

  const keep = worth.map((c) => c.id);
  const removed = keep.length
    ? await sql`
        delete from conversations
         where device_id = ${deviceId}
           and id <> all(${keep}::text[])
        returning id
      `
    : await sql`delete from conversations where device_id = ${deviceId} returning id`;

  return { stored: worth.length, removed: removed.length };
}
