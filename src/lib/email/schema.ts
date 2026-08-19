import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The campaign these rows belong to.
 *
 * It lives here, beside the tables, rather than in `track.ts` — the reporting
 * script reaches this file directly, and `track.ts` imports through the "@/"
 * alias that only the bundler resolves. Putting a shared constant behind that
 * alias is how a working script breaks the first time somebody reuses it.
 */
export const CAMPAIGN = "kranti-launch";

/**
 * The email tracker's tables, in one place.
 *
 * Defined here rather than inside the migration script because two callers
 * need them and they must not drift: `npm run db:migrate` creates them ahead of
 * time, and `logEvent` creates them on demand if it finds them missing. Every
 * statement is `if not exists`, so running this against a database that already
 * has them costs a few catalogue lookups and changes nothing.
 */
export async function ensureEmailTables(
  sql: NeonQueryFunction<false, false>,
): Promise<void> {
  /**
   * One row per click on `/r` and per open of `/px.gif`.
   *
   * `tid` is the opaque per-contact token from the mail-merge sheet and is the
   * only handle on a person here. The mapping back to a name and an address
   * lives in the spreadsheet the campaign holds; putting it in this table would
   * turn a click log into a contact database, which is not what anybody
   * consented to and not what should sit behind an unauthenticated redirect.
   *
   * `fingerprint` is a salted hash of address and user agent, never the address
   * itself. It exists to tell one reader's three clicks from three readers' one
   * each, which is the only question it is asked.
   */
  await sql`
    create table if not exists email_events (
      id            bigserial primary key,
      campaign      text        not null,
      kind          text        not null check (kind in ('click', 'open')),
      tid           text,
      code          text,
      is_automated  boolean     not null default false,
      fingerprint   text,
      user_agent    text,
      occurred_at   timestamptz not null default now()
    )
  `;

  await sql`create index if not exists email_events_campaign_kind_idx on email_events (campaign, kind)`;
  await sql`create index if not exists email_events_tid_idx on email_events (tid)`;
  await sql`create index if not exists email_events_code_idx on email_events (code)`;
  await sql`create index if not exists email_events_occurred_idx on email_events (occurred_at)`;

  /**
   * Unsubscribes, kept apart from the event log on purpose.
   *
   * A suppression is a standing instruction with legal weight behind it, not an
   * analytics row: it has to survive anyone truncating the events table after
   * the campaign is reported on, and it has to be answerable by primary key
   * rather than by scanning a log. `tid` is the primary key, so clicking
   * unsubscribe twice is not an error.
   */
  await sql`
    create table if not exists email_suppressions (
      tid          text primary key,
      campaign     text not null,
      occurred_at  timestamptz not null default now()
    )
  `;
}

/** Postgres `undefined_table`. What a missing migration looks like at runtime. */
const UNDEFINED_TABLE = "42P01";

export function isMissingTable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === UNDEFINED_TABLE) return true;
  // Neon wraps the driver error; fall back to the message when it does.
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /relation .* does not exist/i.test(message);
}
