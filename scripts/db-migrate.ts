/**
 * Creates the tables the app writes to.
 *
 *   npm run db:migrate
 *
 * Idempotent, so it is safe to run against a database that already has them.
 * There is no migration framework here and four `create table if not exists`
 * statements do not justify adding one; if one of them ever needs altering
 * rather than creating, that is the moment to reach for one.
 */
import "dotenv/config";

import { neon } from "@neondatabase/serverless";

import { ensureEmailTables } from "../src/lib/email/schema";
import { ensureEventTables } from "../src/lib/events/schema";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.Last_Colony_DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }

  const sql = neon(url);

  /**
   * A conversation is stored whole, as the JSON the client already holds.
   *
   * The alternative is a messages table, and it would buy nothing here: a
   * thread is only ever read or written in full, never queried across, and the
   * shape of a message is the client's business — `records` alone is a nested
   * corpus record whose columns would have to track the corpus schema forever.
   * `title` and `message_count` are lifted out because the History list wants
   * them without parsing every blob.
   */
  await sql`
    create table if not exists conversations (
      id            text primary key,
      device_id     text not null,
      title         text not null,
      message_count integer not null default 0,
      data          jsonb not null,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    )
  `;

  // The only query the app makes: this device's threads, newest first.
  await sql`
    create index if not exists conversations_device_updated_idx
      on conversations (device_id, updated_at desc)
  `;

  // Same definitions the tracker creates on demand, so the two cannot drift.
  await ensureEmailTables(sql);

  // Same again for the event log, which `recordEvent` also heals on demand.
  await ensureEventTables(sql);

  const [{ count }] = await sql`select count(*)::int as count from conversations`;
  console.log(`conversations table ready — ${count} row${count === 1 ? "" : "s"}`);

  const [{ events }] = await sql`select count(*)::int as events from email_events`;
  const [{ suppressed }] = await sql`select count(*)::int as suppressed from email_suppressions`;
  const [{ tracked }] = await sql`select count(*)::int as tracked from analytics_events`;
  console.log(`email_events table ready — ${events} row${events === 1 ? "" : "s"}`);
  console.log(`email_suppressions table ready — ${suppressed} row${suppressed === 1 ? "" : "s"}`);
  console.log(`analytics_events table ready — ${tracked} row${tracked === 1 ? "" : "s"}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
