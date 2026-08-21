import type { NeonQueryFunction } from "@neondatabase/serverless";

import { addGeoColumns } from "../db/geo-columns";

/**
 * The event log.
 *
 * `track()` wrote to stdout and nowhere else, and a deployment's stdout is a
 * live tail rather than a store — whatever scrolled past is gone. That was
 * survivable while `conversations` answered every question worth asking, and it
 * stopped being survivable the moment anyone asked how many people *visited*:
 * a reader who lands, reads the hero and leaves writes no conversation row, so
 * the one durable table counts only the people who typed. Everything that
 * happens before the first keystroke — the arrival, the placement that paid for
 * it, the reader who bounced — was being written to a file nobody keeps.
 *
 * Defined here rather than in the migration script for the same reason the
 * email tables are: two callers need them and they must not drift. Every
 * statement is `if not exists`.
 */

/**
 * The campaign markers are columns, not `props` keys.
 *
 * They are what every attribution question groups by, and a `group by
 * props->>'utm_source'` over a growing log is a sequential scan that no
 * ordinary index helps. Lifting the eight that the attribution module actually
 * captures costs eight nullable columns and buys a plain b-tree on each. The
 * rest of an event's payload stays in `props`, where its shape is the event's
 * own business.
 */
/**
 * `device_id` is the column the whole thing turns on.
 *
 * It is the same id `conversations.device_id` carries, when the client knows
 * one. Without it a visit and the thread it led to are two unrelated rows and
 * the conversion rate between them is unknowable — which was the entire reason
 * for adding a table rather than pointing a log drain somewhere. Null is
 * normal: a server-side event fired before the client identified itself has no
 * device, and a browser with storage switched off never generates one.
 *
 * (Said here rather than inside the statement below. A comment in there would
 * live inside a template literal, and the backticks this file needs to name a
 * column would end the literal early — which is exactly how the first version
 * of this file failed to compile.)
 */
export async function ensureEventTables(sql: NeonQueryFunction<false, false>): Promise<void> {
  await sql`
    create table if not exists analytics_events (
      id            bigserial   primary key,
      event         text        not null,
      device_id     text,
      utm_source    text,
      utm_medium    text,
      utm_campaign  text,
      utm_content   text,
      utm_term      text,
      click_id      text,
      referrer_host text,
      landing       text,
      props         jsonb       not null default '{}'::jsonb,
      occurred_at   timestamptz not null default now()
    )
  `;

  // Every dashboard panel is "this event, over this window", so the composite
  // leads with the event and orders by time inside it.
  await sql`
    create index if not exists analytics_events_event_time_idx
      on analytics_events (event, occurred_at desc)
  `;
  // The all-events timeline, which the composite above cannot serve.
  await sql`
    create index if not exists analytics_events_time_idx
      on analytics_events (occurred_at desc)
  `;
  // The visit-to-conversation join, and the per-device funnel.
  await sql`
    create index if not exists analytics_events_device_idx
      on analytics_events (device_id) where device_id is not null
  `;
  // Attribution roll-ups.
  await sql`
    create index if not exists analytics_events_source_idx
      on analytics_events (utm_source) where utm_source is not null
  `;

  // Defined in `db/geo-columns.ts`; `email_events` gains the identical set.
  await addGeoColumns(sql, "analytics_events");

  await sql`
    create index if not exists analytics_events_country_idx
      on analytics_events (country) where country is not null
  `;
}

