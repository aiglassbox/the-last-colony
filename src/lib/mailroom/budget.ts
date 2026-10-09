import { normalizeEmail } from "@/lib/community/schema";

/**
 * The mailroom's share of Resend's free tier, 100 emails a day: 25 here
 * (page sends and the automatic `received`) and 70 for verification codes
 * (`OTP_DAILY_MAX`), so the two together stay under the provider's ceiling and
 * a big list can never starve the codes that let people submit.
 * Read per call so the check can set it. `0` sends nothing; unset or
 * unparseable means the default.
 */
export function mailroomDailyMax(): number {
  const raw = process.env.MAILROOM_DAILY_MAX?.trim();
  const n = raw ? Number(raw) : 25;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 25;
}

/** The UTC day, the boundary the code email counts against too. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** One paste. Bigger lists are several sends, and a day only takes 25 anyway. */
export const MAX_RECIPIENTS = 500;

/**
 * Addresses from a paste: commas, semicolons, spaces or new lines between
 * them, `Name <a@b.c>` brackets tolerated, each normalised the way the
 * submission form normalises a contact, duplicates kept once. Pieces that
 * are not an address come back in `invalid` so the page can show them.
 */
export function parseRecipients(raw: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[\s,;]+/)) {
    if (!piece) continue;
    const email = normalizeEmail(piece.replace(/^<|>$/g, ""));
    if (!email) {
      invalid.push(piece);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid };
}

export interface BatchPlan {
  send: string[];
  optedOut: string[];
  waiting: string[];
}

/**
 * Who gets a list email now, who never does, and who waits for tomorrow's
 * "Send the rest". Opted-out addresses never use up room. Order is kept, so
 * the first addresses pasted are the first sent.
 */
export function planBatch(recipients: readonly string[], optedOut: ReadonlySet<string>, remaining: number): BatchPlan {
  const plan: BatchPlan = { send: [], optedOut: [], waiting: [] };
  let room = Math.max(0, remaining);
  for (const email of recipients) {
    if (optedOut.has(email)) plan.optedOut.push(email);
    else if (room > 0) {
      plan.send.push(email);
      room -= 1;
    } else plan.waiting.push(email);
  }
  return plan;
}
