import { createHash } from "node:crypto";

import type { NeonQueryFunction } from "@neondatabase/serverless";

import { db } from "@/lib/db/client";
import { clientKeyFromHeaders } from "@/lib/rate-limit";

import { CAMPAIGN, ensureEmailTables, isMissingTable } from "./schema";

/**
 * Logging for the Kranti Cookbook launch email.
 *
 * The one contract every function here keeps: nothing throws, and nothing the
 * reader is waiting on depends on a write succeeding. A tracker that breaks a
 * CTA is worse than no tracker, and the send is two thousand contacts wide.
 *
 * The storage is the database this project already had — Neon over HTTP,
 * through `db()` — rather than the `pg` pool the reference drop assumed. `db()`
 * returns null when there is no connection string, which is not a failure
 * state but a supported one, and it is exactly the posture this needs: no
 * database means no numbers, never a broken link.
 */

/**
 * Mail security appliances and image proxies open and click every link in an
 * email before a human ever sees it, and they do it within seconds of delivery.
 * Without this filter the click rate is fiction — typically several times the
 * real one, weighted entirely toward whichever corporate domains you sent to.
 *
 * Kept verbatim from the reference drop. Note that `curl` is on the list, so
 * acceptance-test traffic lands in the automated bucket by design.
 */
const BOT_PATTERNS = [
  /bot|crawler|spider|slurp/i,
  /GoogleImageProxy/i, // Gmail image proxy — fires on every open
  /YahooMailProxy/i,
  /Microsoft Office|SkypeUriPreview|MSOffice/i,
  /BarracudaCentral|Proofpoint|Mimecast|Symantec|ForcePoint/i,
  /curl|wget|python-requests|axios|node-fetch|HeadlessChrome/i,
  /preview|scanner|validator|monitoring/i,
];

export function looksAutomated(userAgent: string | null): boolean {
  if (!userAgent || userAgent.trim().length < 12) return true;
  return BOT_PATTERNS.some((re) => re.test(userAgent));
}

/**
 * The salt the fingerprint is built on, and why it has a fallback worth having.
 *
 * A hashed IPv4 with no salt is not anonymous: there are only four billion of
 * them, so hashing the whole space and looking the answer up takes minutes on a
 * laptop. Something unguessable has to go into the hash or the column is just a
 * slower way of storing addresses.
 *
 * `TRACK_SALT` is the explicit way to supply that. When it is absent the
 * connection string is used instead — it is already in the environment, it is
 * already secret, and it is stable for the life of the deployment, which is all
 * a salt has to be. That is deliberate rather than clever: the alternative was
 * a public constant sitting in a git repository, and requiring someone to
 * remember one more variable on the day of a send is exactly how the weak
 * version ends up shipping. sha256 is one-way, so a leaked fingerprint does not
 * expose the string it was salted with.
 *
 * The caveat, stated rather than buried: if the connection string is rotated
 * mid-campaign the salt changes with it, and the same reader then counts as two
 * people. Set `TRACK_SALT` explicitly if a rotation is expected.
 */
let cachedSalt: string | null = null;

function salt(): string {
  if (cachedSalt !== null) return cachedSalt;

  const explicit = process.env.TRACK_SALT;
  if (explicit) return (cachedSalt = explicit);

  const connection = process.env.DATABASE_URL || process.env.Last_Colony_DATABASE_URL;
  if (connection) {
    return (cachedSalt = createHash("sha256").update(connection).digest("hex"));
  }

  // No database means nothing is being written anyway.
  return (cachedSalt = "kranti");
}

/**
 * A fingerprint, not an address.
 *
 * Enough to tell one reader's three clicks apart from three readers' one each,
 * not enough to be a personal record sitting in a marketing table.
 */
function fingerprint(ip: string | null, userAgent: string | null): string {
  return createHash("sha256")
    .update(`${salt()}|${ip ?? ""}|${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Creates the tracker's tables the first time a write finds them missing.
 *
 * The migration is meant to be run ahead of the send, but "meant to" is doing a
 * lot of work on a campaign that goes out the same day it is built, and the
 * failure mode is the worst one available: every click is dropped and the site
 * looks completely healthy while it happens. Nothing would say the database was
 * never written to until somebody asked for the numbers and got zero.
 *
 * So a missing table is treated as a condition to fix rather than an error to
 * report. The recovery runs once per process — the promise is memoised, so a
 * hundred simultaneous clicks on send day produce one attempt, not a hundred
 * racing `create table` statements — and is cleared on failure so a database
 * that was merely unreachable at the time can be retried rather than written
 * off for the life of the process.
 */
let schemaReady: Promise<void> | null = null;

async function healSchema(sql: NeonQueryFunction<false, false>): Promise<void> {
  schemaReady ??= ensureEmailTables(sql).then(
    () => console.warn("[email-track] tables were missing and have been created"),
    (error: unknown) => {
      schemaReady = null;
      throw error;
    },
  );
  await schemaReady;
}



interface EventInput {
  kind: "click" | "open";
  /**
   * The per-contact token from the mail-merge sheet. Opaque here by design.
   *
   * Empty is normalised to null on the way in, not left as `''`. The
   * view-in-browser page serves the email with its `{{TID}}` placeholders
   * stripped, so every link on it arrives as `t=` — and an empty string is not
   * null, so it would have survived the `tid is not null` filter and counted
   * as one more person who clicked everything.
   */
  tid: string | null;
  /** Link code. Null for opens. */
  code: string | null;
  headers: Headers;
}

/**
 * Record one click or open. Resolves rather than rejects, always.
 *
 * `clientKeyFromHeaders` is the same header reader the rate limiter uses, so
 * there is one place in this codebase that decides what the caller's address is
 * rather than two that can drift apart. It returns a sentinel string when no
 * forwarding header is present, which hashes as readily as an address does.
 */
export async function logEvent({ kind, tid, code, headers }: EventInput): Promise<void> {
  try {
    const sql = db();
    if (!sql) return;

    const userAgent = headers.get("user-agent");
    const ip = clientKeyFromHeaders(headers);

    const insert = () => sql`
      insert into email_events
        (campaign, kind, tid, code, is_automated, fingerprint, user_agent)
      values (
        ${CAMPAIGN},
        ${kind},
        ${tid?.slice(0, 64) || null},
        ${code?.slice(0, 32) || null},
        ${looksAutomated(userAgent)},
        ${fingerprint(ip, userAgent)},
        ${userAgent?.slice(0, 400) ?? null}
      )
    `;

    try {
      await insert();
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      await healSchema(sql);
      await insert();
    }
  } catch (error) {
    // Never let a logging failure reach the person clicking. This is the whole
    // reliability requirement in one catch block: a database that is down, a
    // migration that has not run, a connection string that has rotated — all of
    // them cost the row and none of them cost the redirect.
    console.error("[email-track] logEvent failed:", error);
  }
}

/**
 * Record an unsubscribe.
 *
 * Unlike `logEvent` this one reports whether it stored anything, because the
 * page has to be honest with the reader: telling somebody they are unsubscribed
 * when the write failed is the one lie in this system with a legal edge to it.
 */
export async function suppress(tid: string | null): Promise<boolean> {
  if (!tid) return false;
  try {
    const sql = db();
    if (!sql) return false;

    const insert = () => sql`
      insert into email_suppressions (tid, campaign)
      values (${tid.slice(0, 64)}, ${CAMPAIGN})
      on conflict (tid) do nothing
    `;

    try {
      await insert();
    } catch (error) {
      if (!isMissingTable(error)) throw error;
      await healSchema(sql);
      await insert();
    }
    return true;
  } catch (error) {
    console.error("[email-track] suppress failed:", error);
    return false;
  }
}
