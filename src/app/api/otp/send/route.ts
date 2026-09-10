// src/app/api/otp/send/route.ts
import type { NextRequest } from "next/server";

import { sendCode } from "@/lib/community/otp";
import { normalizeEmail } from "@/lib/community/schema";
import { checkRate, clientKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
/** A store read, a Resend call with an 8 s timeout, and possibly a rollback. */
export const maxDuration = 30;

/**
 * Three code emails per IP per window: one person verifying an address or
 * two with a resend each, not a script spending Resend's hundred a day.
 * The limiter runs first because it is the cheapest check; the spec lists
 * the fail-closed check first, and the outcome is the same either way.
 */
const MAX_SENDS = 3;
/** The body is one short string; anything bigger is not the form. */
const MAX_BODY_BYTES = 1024;

export async function POST(request: NextRequest) {
  const rate = checkRate(`otp-send:${clientKey(request)}`, Date.now(), MAX_SENDS);
  if (!rate.ok) {
    return Response.json(
      { error: "rate_limited", retryAfter: rate.retryAfter },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  const length = Number(request.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) {
    return Response.json({ errors: ["body too large"] }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ errors: ["body must be JSON"] }, { status: 400 });
  }

  const email = normalizeEmail((body as { email?: unknown } | null)?.email);
  if (!email) return Response.json({ errors: ["email must be an email address"] }, { status: 400 });

  // The answer is the same whether or not the address exists anywhere; the
  // route never learns that and never says it.
  const result = await sendCode(email);
  if (!result.ok) {
    if (result.status === 429) {
      return Response.json(
        { error: result.reason, retryAfter: result.retryAfter },
        { status: 429, headers: { "retry-after": String(result.retryAfter) } },
      );
    }
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  return Response.json({ ok: true, expiresIn: result.expiresIn, resendIn: result.resendIn });
}
