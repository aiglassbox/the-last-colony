import type { NeonQueryFunction } from "@neondatabase/serverless";

/**
 * The mailroom's four tables. `npm run db:migrate` creates them ahead of time
 * and the store creates them on first use. Every statement is
 * `if not exists`, so either order is safe.
 *
 * Addresses are stored here, deliberately: the operator asked to see who was
 * sent what. The launch campaign's tracker stores none, because it sits
 * behind a public redirect; this sits behind `MAILROOM_PASSWORD`.
 */
export async function ensureMailTables(sql: NeonQueryFunction<false, false>): Promise<void> {
  /* A list send's form, kept so "Send the rest" repeats it exactly. The
     pasted addresses are not in it: they are the batch's mail_sends rows. */
  await sql`
    create table if not exists mail_batches (
      id          text primary key,
      template    text not null,
      draft       jsonb not null,
      created_at  timestamptz not null default now()
    )
  `;

  /* One row per attempted send. `waiting` rows are a batch's queue for
     "Send the rest", and are updated in place when they go. */
  await sql`
    create table if not exists mail_sends (
      id          bigserial primary key,
      batch_id    text references mail_batches (id),
      template    text not null,
      to_email    text not null,
      subject     text not null,
      status      text not null check (status in ('sent', 'opted_out', 'waiting', 'failed', 'over_limit')),
      source      text not null check (source in ('mailroom', 'auto')),
      resend_id   text,
      error       text,
      created_at  timestamptz not null default now(),
      sent_at     timestamptz
    )
  `;
  await sql`create index if not exists mail_sends_sent_idx on mail_sends (sent_at) where status = 'sent'`;
  await sql`create index if not exists mail_sends_created_idx on mail_sends (created_at desc)`;
  await sql`create index if not exists mail_sends_batch_idx on mail_sends (batch_id, status)`;

  /* An address's permanent unsubscribe token, and its opt-out. A standing
     instruction, not a log row: keyed by the address so it is answered by
     primary key and survives anything done to mail_sends. */
  await sql`
    create table if not exists mail_contacts (
      email           text primary key,
      token           text not null unique,
      opted_out_at    timestamptz,
      opt_out_source  text check (opt_out_source in ('link', 'one-click', 'launch-import')),
      created_at      timestamptz not null default now()
    )
  `;

  /* The automatic `received` email's saved text and switch. */
  await sql`
    create table if not exists mail_settings (
      key         text primary key,
      value       jsonb not null,
      updated_at  timestamptz not null default now()
    )
  `;
}
