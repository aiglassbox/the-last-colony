import type { NeonQueryFunction } from "@neondatabase/serverless";

import { db } from "@/lib/db/client";

import { utcDayStart } from "./budget";
import { TOKEN_PATTERN } from "./links";
import { ensureMailTables } from "./schema";
import { newToken } from "./token";

/**
 * The mailroom's Neon layer: the send log, list batches, addresses with their
 * opt-outs, and the automatic `received` settings. Thin on purpose. Every
 * decision is in the pure core or in `send.ts`; this only reads and writes.
 *
 * Throws when there is no database: unlike the chat mirror, the mailroom
 * cannot do its job without a log, and pretending would let a list go out
 * with nothing recorded and nobody's opt-out checked.
 */

type Sql = NeonQueryFunction<false, false>;
let ready: Promise<void> | null = null;

async function sql(): Promise<Sql> {
  const s = db();
  if (!s) throw new Error("no DATABASE_URL: the mailroom needs its log");
  ready ??= ensureMailTables(s).catch((error: unknown) => {
    ready = null;
    throw error;
  });
  await ready;
  return s;
}

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

export type SendStatus = "sent" | "opted_out" | "waiting" | "failed" | "over_limit";
export type SendSource = "mailroom" | "auto";
export type OptOutSource = "link" | "one-click" | "launch-import";

export interface SendRow {
  batchId?: string | null;
  template: string;
  to: string;
  subject: string;
  status: SendStatus;
  source: SendSource;
  resendId?: string | null;
  error?: string | null;
}

export interface SendLogRow {
  id: number;
  created_at: string;
  template: string;
  to: string;
  subject: string;
  status: SendStatus;
  source: SendSource;
  error: string | null;
  batch_id: string | null;
}

export interface AutoReceived {
  enabled: boolean;
  subject: string;
  preheader: string;
  heading: string;
  message: string;
}

/**
 * Emails actually handed to Resend since midnight UTC, from the page and
 * automatically: the number the daily allowance is spent against.
 * ponytail: the allowance is re-read before every Resend call, so two sends
 * racing overshoot by at most the calls in flight; the allowance sits 5 under
 * Resend's ceiling for that reason.
 */
export async function sentToday(now: Date = new Date()): Promise<number> {
  const s = await sql();
  const rows = await s`
    select count(*)::int as n from mail_sends
    where status = 'sent' and sent_at >= ${utcDayStart(now).toISOString()}
  `;
  return Number(rows[0]?.n ?? 0);
}

export async function logSend(row: SendRow): Promise<number> {
  const s = await sql();
  const sentAt = row.status === "sent" ? new Date().toISOString() : null;
  const rows = await s`
    insert into mail_sends (batch_id, template, to_email, subject, status, source, resend_id, error, sent_at)
    values (${row.batchId ?? null}, ${row.template}, ${row.to}, ${row.subject}, ${row.status}, ${row.source},
            ${row.resendId ?? null}, ${row.error ?? null}, ${sentAt})
    returning id
  `;
  return Number(rows[0].id);
}

export async function updateSend(id: number, status: SendStatus, resendId: string | null, error: string | null): Promise<void> {
  const s = await sql();
  const sentAt = status === "sent" ? new Date().toISOString() : null;
  await s`
    update mail_sends set status = ${status}, resend_id = ${resendId}, error = ${error}, sent_at = ${sentAt}
    where id = ${id}
  `;
}

/**
 * One row per address, in the order given, in a single round trip. A list send
 * logs every address as `waiting` or `opted_out` before anything goes to
 * Resend, so a send cut off part-way leaves each unreached address a row that
 * "Send the rest" can find.
 */
export async function logQueued(
  row: { batchId: string; template: string; subject: string; source: SendSource },
  emails: readonly string[],
  status: "waiting" | "opted_out",
  error: string | null,
): Promise<void> {
  if (emails.length === 0) return;
  const s = await sql();
  await s`
    insert into mail_sends (batch_id, template, to_email, subject, status, source, error)
    select ${row.batchId}, ${row.template}, e, ${row.subject}, ${status}, ${row.source}, ${error}
    from unnest(${[...emails]}::text[]) with ordinality as t(e, n) order by n
  `;
}

/**
 * Takes one waiting row for this send, atomically, so two overlapping sends
 * cannot both deliver it. The row then reads as failed with that reason: if the
 * function dies before Resend answers, an operator sees it and decides, and it
 * is never silently sent again. `updateSend` overwrites it with the real outcome.
 */
export async function claimWaiting(id: number): Promise<boolean> {
  const s = await sql();
  const rows = await s`
    update mail_sends set status = 'failed', error = 'interrupted before Resend answered'
    where id = ${id} and status = 'waiting'
    returning id
  `;
  return rows.length === 1;
}

export async function createBatch(template: string, draft: unknown): Promise<string> {
  const s = await sql();
  const id = newToken();
  await s`insert into mail_batches (id, template, draft) values (${id}, ${template}, ${JSON.stringify(draft)}::jsonb)`;
  return id;
}

export async function getBatch(id: string): Promise<{ id: string; template: string; draft: unknown } | null> {
  if (!TOKEN_PATTERN.test(id)) return null;
  const s = await sql();
  const rows = await s`select id, template, draft from mail_batches where id = ${id}`;
  const row = rows[0];
  return row ? { id: String(row.id), template: String(row.template), draft: row.draft } : null;
}

export async function waitingInBatch(batchId: string): Promise<{ id: number; to: string }[]> {
  const s = await sql();
  const rows = await s`
    select id, to_email from mail_sends where batch_id = ${batchId} and status = 'waiting' order by id
  `;
  return rows.map((r) => ({ id: Number(r.id), to: String(r.to_email) }));
}

export async function optedOutAmong(emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const s = await sql();
  const rows = await s`
    select email from mail_contacts where opted_out_at is not null and email = any(${[...emails]}::text[])
  `;
  return new Set(rows.map((r) => String(r.email)));
}

/** The address's permanent token, made the first time it is sent a list email. */
export async function tokenFor(email: string): Promise<string> {
  const s = await sql();
  const rows = await s`
    insert into mail_contacts (email, token) values (${email}, ${newToken()})
    on conflict (email) do update set email = excluded.email
    returning token
  `;
  return String(rows[0].token);
}

/** True when the token is one of ours. Opting out twice keeps the first time and the first way. */
export async function optOutByToken(token: string, source: "link" | "one-click"): Promise<boolean> {
  if (!TOKEN_PATTERN.test(token)) return false;
  const s = await sql();
  const rows = await s`
    update mail_contacts
    set opted_out_at = coalesce(opted_out_at, now()), opt_out_source = coalesce(opt_out_source, ${source})
    where token = ${token}
    returning email
  `;
  return rows.length === 1;
}

/**
 * The launch campaign's opt-outs, pasted once. Addresses already opted out
 * keep their original date and source. One statement for the whole paste, so
 * thousands of addresses fit inside the route's time limit. The list is
 * deduped first, because `on conflict do update` cannot touch one row twice.
 */
export async function importOptOuts(emails: readonly string[]): Promise<{ added: number; already: number }> {
  const unique = [...new Set(emails)];
  const already = await optedOutAmong(unique);
  const fresh = unique.filter((e) => !already.has(e));
  if (fresh.length > 0) {
    const s = await sql();
    await s`
      insert into mail_contacts (email, token, opted_out_at, opt_out_source)
      select e, tok, now(), 'launch-import' from unnest(${fresh}::text[], ${fresh.map(() => newToken())}::text[]) as t(e, tok)
      on conflict (email) do update
        set opted_out_at = coalesce(mail_contacts.opted_out_at, now()),
            opt_out_source = coalesce(mail_contacts.opt_out_source, 'launch-import')
    `;
  }
  return { added: fresh.length, already: already.size };
}

export async function listOptOuts(limit = 1000): Promise<{ email: string; opted_out_at: string; source: OptOutSource }[]> {
  const s = await sql();
  const rows = await s`
    select email, opted_out_at, opt_out_source from mail_contacts
    where opted_out_at is not null order by opted_out_at desc limit ${limit}
  `;
  return rows.map((r) => ({ email: String(r.email), opted_out_at: iso(r.opted_out_at), source: r.opt_out_source as OptOutSource }));
}

export async function listSends(since: Date | null, search: string, limit = 200): Promise<SendLogRow[]> {
  const s = await sql();
  const from = since ? since.toISOString() : null;
  const term = search.trim().toLowerCase();
  const like = `%${term}%`;
  const rows = await s`
    select id, created_at, template, to_email, subject, status, source, error, batch_id from mail_sends
    where (${from}::timestamptz is null or created_at >= ${from}::timestamptz)
      and (${term} = '' or lower(to_email) like ${like} or lower(subject) like ${like} or template like ${like})
    order by id desc
    limit ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    created_at: iso(r.created_at),
    template: String(r.template),
    to: String(r.to_email),
    subject: String(r.subject),
    status: r.status as SendStatus,
    source: r.source as SendSource,
    error: r.error === null ? null : String(r.error),
    batch_id: r.batch_id === null ? null : String(r.batch_id),
  }));
}

export async function sendTotals(since: Date | null): Promise<{ template: string; status: SendStatus; n: number }[]> {
  const s = await sql();
  const from = since ? since.toISOString() : null;
  const rows = await s`
    select template, status, count(*)::int as n from mail_sends
    where (${from}::timestamptz is null or created_at >= ${from}::timestamptz)
    group by template, status order by template, status
  `;
  return rows.map((r) => ({ template: String(r.template), status: r.status as SendStatus, n: Number(r.n) }));
}

export async function waitingBatches(): Promise<{ batch_id: string; template: string; waiting: number; created_at: string }[]> {
  const s = await sql();
  const rows = await s`
    select s.batch_id, b.template, count(*)::int as waiting, b.created_at
    from mail_sends s join mail_batches b on b.id = s.batch_id
    where s.status = 'waiting'
    group by s.batch_id, b.template, b.created_at
    order by b.created_at
  `;
  return rows.map((r) => ({ batch_id: String(r.batch_id), template: String(r.template), waiting: Number(r.waiting), created_at: iso(r.created_at) }));
}

const AUTO_KEY = "auto_received";

export async function getAutoReceived(): Promise<AutoReceived | null> {
  const s = await sql();
  const rows = await s`select value from mail_settings where key = ${AUTO_KEY}`;
  const v = rows[0]?.value as Partial<AutoReceived> | undefined;
  if (!v) return null;
  return {
    enabled: v.enabled === true,
    subject: String(v.subject ?? ""),
    preheader: String(v.preheader ?? ""),
    heading: String(v.heading ?? ""),
    message: String(v.message ?? ""),
  };
}

export async function saveAutoReceived(value: AutoReceived): Promise<void> {
  const s = await sql();
  await s`
    insert into mail_settings (key, value, updated_at) values (${AUTO_KEY}, ${JSON.stringify(value)}::jsonb, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

/**
 * Different readers chat showed this recipe to: devices on `community_served`
 * for its dish and state. The milestone email's pre-filled count.
 */
export async function servedReaders(tag: string, state: string): Promise<number> {
  const s = await sql();
  const rows = await s`
    select count(distinct device_id)::int as n from analytics_events
    where event = 'community_served' and props->>'dish_tag' = ${tag} and props->>'served_state' = ${state}
  `;
  return Number(rows[0]?.n ?? 0);
}
