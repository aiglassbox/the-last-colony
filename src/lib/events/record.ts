import { db } from "@/lib/db/client";
// A generic Postgres predicate that happens to live beside the email tables.
// Importing it is better than a second copy that can drift from the first.
import { isMissingTable } from "@/lib/email/schema";

import { ensureEventTables } from "./schema";

/**
 * Write one event down.
 *
 * The contract is the one every logger in this codebase keeps: nothing throws,
 * and nothing a reader is waiting on depends on the write landing. `track()`
 * is called from inside a streaming response and from a beacon handler that
 * answers 204 regardless — an event that cannot be stored costs the row and
 * never the answer.
 *
 * Deliberately not awaited by its caller. `track()` stays synchronous so that
 * none of its call sites change, and the promise this returns is voided there.
 * The one cost is that a request finishing before the insert does can lose the
 * row on a serverless instance being frozen; for a launch dashboard that is the
 * right trade against adding an await to a hot streaming path.
 */

/** Postgres text columns are unbounded; a log's are not. */
const MAX_TEXT = 200;
const MAX_EVENT = 40;

function clip(value: unknown, max = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The markers `attribution.ts` captures, pulled out of the payload.
 *
 * They arrive mixed into `props` because the client attaches them to every
 * beacon without knowing which are campaign markers and which are the event's
 * own. Splitting them here rather than at the client keeps that module's job
 * ("everything the session knows") separate from this one's ("what gets its own
 * column"), and means adding a marker is a change in one file.
 */
const COLUMNS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer_host",
  "landing",
] as const;

/** One click identifier, whichever platform sent it. Which one is not a question anyone asks. */
const CLICK_IDS = ["fbclid", "gclid", "ttclid"] as const;

export async function recordEvent(
  event: string,
  props: Record<string, string | number | boolean | null>,
): Promise<void> {
  const sql = db();
  if (!sql) return;

  try {
    const rest: Record<string, string | number | boolean | null> = { ...props };
    const lifted: Record<string, string | null> = {};

    for (const key of COLUMNS) {
      lifted[key] = clip(rest[key]);
      delete rest[key];
    }

    let clickId: string | null = null;
    for (const key of CLICK_IDS) {
      clickId ??= clip(rest[key]);
      delete rest[key];
    }

    const deviceId = clip(rest.device_id, 64);
    delete rest.device_id;

    const insert = () => sql`
      insert into analytics_events
        (event, device_id, utm_source, utm_medium, utm_campaign, utm_content,
         utm_term, click_id, referrer_host, landing, props)
      values (
        ${event.slice(0, MAX_EVENT)},
        ${deviceId},
        ${lifted.utm_source},
        ${lifted.utm_medium},
        ${lifted.utm_campaign},
        ${lifted.utm_content},
        ${lifted.utm_term},
        ${clickId},
        ${lifted.referrer_host},
        ${lifted.landing},
        ${JSON.stringify(rest)}::jsonb
      )
    `;

    try {
      await insert();
    } catch (error) {
      // A deployment that has not run the migration heals itself on the first
      // event rather than dropping every one until somebody notices.
      if (!isMissingTable(error)) throw error;
      await ensureEventTables(sql);
      await insert();
    }
  } catch (error) {
    console.error("[events] recordEvent failed:", error);
  }
}
